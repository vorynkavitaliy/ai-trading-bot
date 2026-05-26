/**
 * Step 11 of BTC research (2026-05-24) — operator's idea.
 *
 * Take the 107 baseline S1 BTC trades (already extracted to /tmp/btc-trades.json)
 * and simulate a "scaled-in entry" modification:
 *
 *   Instead of 1 limit order at entry, place 3 limit orders:
 *     #1 at entry           (1/3 of total qty)
 *     #2 at entry - 1*ATR   (1/3 of total qty)
 *     #3 at entry - 2*ATR   (1/3 of total qty)
 *   Total qty equals the original — so total risk in USD equals the original.
 *
 *   SL stays at the SAME ABSOLUTE PRICE as the original (entry - 1.5*ATR).
 *   But because avg entry is lower (if #2/#3 fill), the SL is FURTHER from avg →
 *   the effective R-distance grows (sl_dist_from_avg > sl_dist_from_first_entry).
 *
 *   TP is recomputed from avg entry: avg + 2*ATR (same ATR multiple).
 *   Because avg is lower, TP is also lower in absolute price → easier to hit.
 *
 *   IMPORTANT: For SHORT trades, mirror: #1 at entry, #2 at entry + 1*ATR, #3 at entry + 2*ATR.
 *
 * Walk through every 1m bar from entryTs to (entryTs + 12*4h = 48h) or until SL/TP hit.
 *
 * Output: WR, sumR, avgR comparison to baseline. Also break down by:
 *   - how many entries filled (1/2/3)
 *   - bucketed by which kind of trade benefited most
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { Bar } from '../types';

interface Trade {
  entryTs: number;
  entryIso: string;
  exitTs: number;
  exitIso: string;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  pnlR: number;
  pnlUsd: number;
  feesUsd: number;
  exitReason: string;
  rationale: string;
  win: boolean;
}

const MS_24H = 24 * 3600_000;
const MS_2D = 2 * MS_24H;

// Operator's risk budget: total risk per trade = 0.5% of equity (same as S1).
// Split into 3 equal qty buckets.
const N_ENTRIES = 3;
const SPACING_ATR = 1.0;     // entry #2 at entry ± 1.0*ATR, entry #3 at entry ± 2.0*ATR

interface SimResult {
  entriesFilled: number;
  avgEntry: number;
  totalQty: number;
  exitPrice: number;
  exitReason: 'sl' | 'tp' | 'timeout';
  exitTs: number;
  riskedUsd: number;        // total $ risked = |first_entry - SL| * (qty_per_entry × N_ENTRIES) / 3 — i.e. sized so SL distance from first entry = same risk
  pnlR: number;
}

function atrFromCandles(bars1m: Bar[], entryTs: number): number {
  // We need an ATR(14) on 4H bars at entryTs. Cheap path: take 14 × 4h = 56h of 1m bars
  // immediately before entryTs, group into 4h buckets, compute TR.
  const tfMs = 4 * 3600_000;
  const buckets: Bar[] = [];
  for (let bucketStart = entryTs - 14 * tfMs; bucketStart < entryTs; bucketStart += tfMs) {
    const bbars = bars1m.filter(b => b.ts >= bucketStart && b.ts < bucketStart + tfMs);
    if (bbars.length === 0) continue;
    let high = bbars[0].high, low = bbars[0].low;
    const open = bbars[0].open, close = bbars[bbars.length - 1].close;
    for (const b of bbars) { if (b.high > high) high = b.high; if (b.low < low) low = b.low; }
    buckets.push({ ts: bucketStart, open, high, low, close, volume: 0 });
  }
  if (buckets.length < 2) return 0;
  let sumTR = 0;
  for (let i = 1; i < buckets.length; i++) {
    const tr = Math.max(
      buckets[i].high - buckets[i].low,
      Math.abs(buckets[i].high - buckets[i - 1].close),
      Math.abs(buckets[i].low - buckets[i - 1].close),
    );
    sumTR += tr;
  }
  return sumTR / (buckets.length - 1);
}

function simulateScaledIn(trade: Trade, bars1m: Bar[]): SimResult {
  const isLong = trade.side === 'long';
  const direction = isLong ? -1 : +1;  // entries are placed BELOW for long, ABOVE for short

  // Use the original ATR-equivalent from the SL distance.
  // Original: SL = entry - 1.5*ATR (long) → ATR = |entry - SL| / 1.5.
  const atr = Math.abs(trade.entry - trade.sl) / 1.5;

  // 3 entry levels
  const entryPrices: number[] = [];
  for (let i = 0; i < N_ENTRIES; i++) {
    entryPrices.push(trade.entry + direction * i * SPACING_ATR * atr);
  }

  // SL kept at SAME price as original (worst-case entry was at entry-2*ATR; SL is at entry-1.5*ATR …
  // wait — original SL is at entry-1.5*ATR for long. Entry #3 would be at entry-2*ATR, which is BELOW the SL!
  // That means in original config, #3 would never fill before SL. So spacing must be < 1.5*ATR / (N-1) = 0.75.
  // Let's enforce SPACING_ATR ≤ 0.5 to leave headroom.
  // For now, allow SPACING_ATR = anything, but if SL is between entries, treat #3 as un-fillable
  // (price hit SL before reaching entry #3, so trade SL'd with only #1 and possibly #2 filled).
  const slPrice = trade.sl;

  // Walk 1m bars from entryTs to entryTs + 48h (max hold)
  const startTs = trade.entryTs;
  const endTs = startTs + MS_2D;
  const cycleBars = bars1m.filter(b => b.ts >= startTs && b.ts <= endTs);
  if (cycleBars.length === 0) {
    // No data — treat as no-fill
    return { entriesFilled: 0, avgEntry: 0, totalQty: 0, exitPrice: 0, exitReason: 'timeout', exitTs: endTs, riskedUsd: 0, pnlR: 0 };
  }

  // State
  const filledEntries: boolean[] = new Array(N_ENTRIES).fill(false);
  const qtyPerEntry = 1;   // unit qty; we work in R-multiples not USD
  let cumQty = 0;
  let cumNotional = 0;

  // Fill entry #1 at market on the first bar
  filledEntries[0] = true;
  cumQty += qtyPerEntry;
  cumNotional += qtyPerEntry * entryPrices[0];

  for (const b of cycleBars) {
    const avgEntry = cumQty > 0 ? cumNotional / cumQty : trade.entry;
    const tpPrice = isLong
      ? avgEntry + 2.0 * atr      // 2*ATR from avg (same multiplier as original)
      : avgEntry - 2.0 * atr;

    // Check SL first
    if (isLong && b.low <= slPrice) {
      const exitPrice = slPrice;
      const slDist = Math.abs(entryPrices[0] - slPrice);
      const riskedPerQty = slDist;
      const pnlPerQty = exitPrice - avgEntry;
      const pnlR = (pnlPerQty * cumQty) / (riskedPerQty * N_ENTRIES);
      return { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice, exitReason: 'sl', exitTs: b.ts, riskedUsd: riskedPerQty * N_ENTRIES, pnlR };
    }
    if (!isLong && b.high >= slPrice) {
      const exitPrice = slPrice;
      const slDist = Math.abs(entryPrices[0] - slPrice);
      const riskedPerQty = slDist;
      const pnlPerQty = avgEntry - exitPrice;
      const pnlR = (pnlPerQty * cumQty) / (riskedPerQty * N_ENTRIES);
      return { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice, exitReason: 'sl', exitTs: b.ts, riskedUsd: riskedPerQty * N_ENTRIES, pnlR };
    }

    // Check TP
    if (isLong && b.high >= tpPrice) {
      const slDist = Math.abs(entryPrices[0] - slPrice);
      const riskedPerQty = slDist;
      const pnlPerQty = tpPrice - avgEntry;
      const pnlR = (pnlPerQty * cumQty) / (riskedPerQty * N_ENTRIES);
      return { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: tpPrice, exitReason: 'tp', exitTs: b.ts, riskedUsd: riskedPerQty * N_ENTRIES, pnlR };
    }
    if (!isLong && b.low <= tpPrice) {
      const slDist = Math.abs(entryPrices[0] - slPrice);
      const riskedPerQty = slDist;
      const pnlPerQty = avgEntry - tpPrice;
      const pnlR = (pnlPerQty * cumQty) / (riskedPerQty * N_ENTRIES);
      return { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: tpPrice, exitReason: 'tp', exitTs: b.ts, riskedUsd: riskedPerQty * N_ENTRIES, pnlR };
    }

    // Check entries #2 and #3 (lower for long, higher for short)
    for (let i = 1; i < N_ENTRIES; i++) {
      if (filledEntries[i]) continue;
      const ep = entryPrices[i];
      const shouldFill = isLong ? (b.low <= ep) : (b.high >= ep);
      if (shouldFill) {
        filledEntries[i] = true;
        cumQty += qtyPerEntry;
        cumNotional += qtyPerEntry * ep;
      }
    }
  }

  // Timeout — close at last bar's close
  const lastBar = cycleBars[cycleBars.length - 1];
  const avgEntry = cumNotional / cumQty;
  const slDist = Math.abs(entryPrices[0] - slPrice);
  const riskedPerQty = slDist;
  const pnlPerQty = isLong ? (lastBar.close - avgEntry) : (avgEntry - lastBar.close);
  const pnlR = (pnlPerQty * cumQty) / (riskedPerQty * N_ENTRIES);
  return { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: lastBar.close, exitReason: 'timeout', exitTs: lastBar.ts, riskedUsd: riskedPerQty * N_ENTRIES, pnlR };
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades.json', 'utf8'));
  const trades: Trade[] = raw.trades;

  console.log(`Loaded ${trades.length} S1 baseline trades. Loading 1m bars…`);
  const firstTs = Math.min(...trades.map(t => t.entryTs)) - MS_24H;
  const lastTs = Math.max(...trades.map(t => t.entryTs)) + MS_2D + MS_24H;
  const bars1m = await loadBars('BTCUSDT', '1m', { fromTs: firstTs, toTs: lastTs });
  console.log(`Loaded ${bars1m.length} 1m bars`);

  // Sweep over spacing
  const spacings = [0.3, 0.5, 0.7, 1.0];
  console.log(`\nSweeping SPACING_ATR over ${spacings.join(', ')}…`);
  console.log('Note: BASELINE S1 = 107 trades, WR 57.0%, sumR 31.15');

  for (const sp of spacings) {
    // Hack: mutate the constant via re-implementation
    const SP = sp;
    const sims: SimResult[] = [];
    for (const t of trades) {
      const isLong = t.side === 'long';
      const direction = isLong ? -1 : +1;
      const atr = Math.abs(t.entry - t.sl) / 1.5;
      const entryPrices: number[] = [];
      for (let i = 0; i < N_ENTRIES; i++) entryPrices.push(t.entry + direction * i * SP * atr);
      const slPrice = t.sl;
      const startTs = t.entryTs;
      const endTs = startTs + MS_2D;
      const cycleBars = bars1m.filter(b => b.ts >= startTs && b.ts <= endTs);
      if (cycleBars.length === 0) { sims.push({ entriesFilled: 0, avgEntry: 0, totalQty: 0, exitPrice: 0, exitReason: 'timeout', exitTs: endTs, riskedUsd: 0, pnlR: 0 }); continue; }

      const filledEntries: boolean[] = new Array(N_ENTRIES).fill(false);
      let cumQty = 0, cumNotional = 0;
      filledEntries[0] = true; cumQty += 1; cumNotional += entryPrices[0];

      const slDist = Math.abs(entryPrices[0] - slPrice);
      const riskedPerSlot = slDist;
      const totalRisked = riskedPerSlot * N_ENTRIES;
      let result: SimResult | null = null;

      for (const b of cycleBars) {
        const avgEntry = cumNotional / cumQty;
        const tpPrice = isLong ? avgEntry + 2.0 * atr : avgEntry - 2.0 * atr;

        if (isLong && b.low <= slPrice) {
          const pnlPerQty = slPrice - avgEntry;
          const pnlR = (pnlPerQty * cumQty) / totalRisked;
          result = { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: slPrice, exitReason: 'sl', exitTs: b.ts, riskedUsd: totalRisked, pnlR };
          break;
        }
        if (!isLong && b.high >= slPrice) {
          const pnlPerQty = avgEntry - slPrice;
          const pnlR = (pnlPerQty * cumQty) / totalRisked;
          result = { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: slPrice, exitReason: 'sl', exitTs: b.ts, riskedUsd: totalRisked, pnlR };
          break;
        }
        if (isLong && b.high >= tpPrice) {
          const pnlPerQty = tpPrice - avgEntry;
          const pnlR = (pnlPerQty * cumQty) / totalRisked;
          result = { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: tpPrice, exitReason: 'tp', exitTs: b.ts, riskedUsd: totalRisked, pnlR };
          break;
        }
        if (!isLong && b.low <= tpPrice) {
          const pnlPerQty = avgEntry - tpPrice;
          const pnlR = (pnlPerQty * cumQty) / totalRisked;
          result = { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: tpPrice, exitReason: 'tp', exitTs: b.ts, riskedUsd: totalRisked, pnlR };
          break;
        }
        for (let i = 1; i < N_ENTRIES; i++) {
          if (filledEntries[i]) continue;
          const ep = entryPrices[i];
          const shouldFill = isLong ? (b.low <= ep) : (b.high >= ep);
          if (shouldFill) {
            filledEntries[i] = true;
            cumQty += 1;
            cumNotional += ep;
          }
        }
      }

      if (!result) {
        const lastBar = cycleBars[cycleBars.length - 1];
        const avgEntry = cumNotional / cumQty;
        const pnlPerQty = isLong ? (lastBar.close - avgEntry) : (avgEntry - lastBar.close);
        const pnlR = (pnlPerQty * cumQty) / totalRisked;
        result = { entriesFilled: filledEntries.filter(x => x).length, avgEntry, totalQty: cumQty, exitPrice: lastBar.close, exitReason: 'timeout', exitTs: lastBar.ts, riskedUsd: totalRisked, pnlR };
      }
      sims.push(result);
    }

    const wins = sims.filter(s => s.pnlR > 0.05).length;
    const losses = sims.filter(s => s.pnlR < -0.05).length;
    const n = sims.length;
    const wr = wins / n * 100;
    const sumR = sims.reduce((s, x) => s + x.pnlR, 0);
    const winR = sims.filter(s => s.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(sims.filter(s => s.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : Infinity;
    const filledDist = [0, 0, 0, 0];
    for (const s of sims) filledDist[s.entriesFilled]++;
    const tpCount = sims.filter(s => s.exitReason === 'tp').length;
    const slCount = sims.filter(s => s.exitReason === 'sl').length;
    const toCount = sims.filter(s => s.exitReason === 'timeout').length;

    console.log(`\n  spacing=${SP}*ATR:`);
    console.log(`    n=${n}  WR=${wr.toFixed(1)}%  sumR=${sumR.toFixed(2)}  PF=${pf.toFixed(2)}`);
    console.log(`    exit: tp=${tpCount}  sl=${slCount}  timeout=${toCount}`);
    console.log(`    entries filled: 1=${filledDist[1]}  2=${filledDist[2]}  3=${filledDist[3]}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
