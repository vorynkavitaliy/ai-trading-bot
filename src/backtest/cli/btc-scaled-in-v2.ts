/**
 * V2 of scaled-in simulator — corrected risk model per operator.
 *
 * Risk allocation:
 *   - Total risk per trade = 1R (same as baseline S1, expressed as multiple of R)
 *   - Split across 3 entry buckets: each bucket = 1/3 R
 *   - Per entry i: qty_i = (1/3 R) / |entry_i - SL|
 *     → deeper entries (smaller dist to SL) get MORE qty per slot
 *
 * Behavior:
 *   - Entry #1 fills immediately at signal price.
 *   - Entries #2 and #3 are limit orders below (for long) / above (for short) #1.
 *   - SL is at SAME absolute price as baseline S1 (entry - 1.5*ATR for long).
 *   - TP = avg_entry + 2.0*ATR (recomputed on each new fill).
 *   - Walk 1m bars within max_hold = 48h.
 *
 * Outcomes:
 *   - If SL hits after only #1 filled → loss = 1/3 R
 *   - If SL hits after #1 and #2 filled → loss = 2/3 R
 *   - If SL hits after all 3 filled → loss = 1 R
 *   - If TP hits with avg < first_entry → win amplified (more qty, more R)
 *
 * Operator's intuition: this should INCREASE WR (better avg entry → TP easier
 * to hit) and DECREASE the SL pain (partial losses).
 */
import { readFileSync } from 'node:fs';
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { Bar } from '../types';

interface Trade {
  entryTs: number;
  side: 'long' | 'short';
  entry: number;
  sl: number;
  pnlR: number;
  win: boolean;
}

const MS_2D = 2 * 24 * 3600_000;
const TP_ATR_MULT = 2.0;
const SL_ATR_MULT = 1.5;
const N_ENTRIES = 3;

function simOne(t: Trade, bars1m: Bar[], spacingAtr: number, riskPerSlotR: number) {
  const isLong = t.side === 'long';
  const direction = isLong ? -1 : +1;
  const atr = Math.abs(t.entry - t.sl) / SL_ATR_MULT;
  const slPrice = t.sl;

  // 3 entry prices
  const entryPrices: number[] = [];
  for (let i = 0; i < N_ENTRIES; i++) entryPrices.push(t.entry + direction * i * spacingAtr * atr);

  // SL must be reachable from all entries on the correct side:
  // For long: slPrice < entryPrices[2]. If not, entry #3 is below SL → unreachable.
  // We'll let the sim handle that naturally (price would hit SL before reaching #3).

  const startTs = t.entryTs;
  const endTs = startTs + MS_2D;
  const cycleBars = bars1m.filter(b => b.ts >= startTs && b.ts <= endTs);
  if (cycleBars.length === 0) return { result: 'no_data' as const, pnlR: 0, entriesFilled: 0 };

  // Quantities per slot, computed at fill time.
  // qty_i (in arbitrary qty units) = riskPerSlotR / |entry_i - slPrice|
  // We use "R-units" so a $1 movement on qty=1 = 1R/$1risk (no need for USD).
  const filled: boolean[] = new Array(N_ENTRIES).fill(false);
  let cumQty = 0;          // sum of qty per filled entries
  let cumNotional = 0;     // sum of qty × entry price
  let cumRiskAtSL = 0;     // cumulative R if SL hits now: sum_i qty_i × |entry_i - SL|

  // Fill entry #1
  const dist1 = Math.abs(entryPrices[0] - slPrice);
  const qty1 = riskPerSlotR / dist1;
  filled[0] = true;
  cumQty += qty1;
  cumNotional += qty1 * entryPrices[0];
  cumRiskAtSL += qty1 * dist1;

  for (const b of cycleBars) {
    const avgEntry = cumNotional / cumQty;
    const tpPrice = isLong ? avgEntry + TP_ATR_MULT * atr : avgEntry - TP_ATR_MULT * atr;

    // SL first
    if (isLong && b.low <= slPrice) {
      const pnlPerQty = slPrice - avgEntry;
      // Total pnl in absolute "units"; total risk = cumRiskAtSL (in R-equivalent)
      const pnlR = (pnlPerQty * cumQty) / cumRiskAtSL * cumRiskAtSL  // simplify: pnl in R = total_pnl_abs / (1R worth of qty*dist)
      ;
      // pnlR_correct = total_pnl_abs / (riskPerSlotR worth of "1R") where riskPerSlotR per slot is 1/3
      // Total R risked = sum of slots filled × riskPerSlotR
      const totalRRisked = riskPerSlotR * filled.filter(x => x).length;
      const pnlR2 = (pnlPerQty * cumQty) / totalRRisked;
      return { result: 'sl' as const, pnlR: pnlR2, entriesFilled: filled.filter(x => x).length };
    }
    if (!isLong && b.high >= slPrice) {
      const pnlPerQty = avgEntry - slPrice;
      const totalRRisked = riskPerSlotR * filled.filter(x => x).length;
      const pnlR2 = (pnlPerQty * cumQty) / totalRRisked;
      return { result: 'sl' as const, pnlR: pnlR2, entriesFilled: filled.filter(x => x).length };
    }

    // TP
    if (isLong && b.high >= tpPrice) {
      const pnlPerQty = tpPrice - avgEntry;
      const totalRRisked = riskPerSlotR * filled.filter(x => x).length;
      const pnlR2 = (pnlPerQty * cumQty) / totalRRisked;
      return { result: 'tp' as const, pnlR: pnlR2, entriesFilled: filled.filter(x => x).length };
    }
    if (!isLong && b.low <= tpPrice) {
      const pnlPerQty = avgEntry - tpPrice;
      const totalRRisked = riskPerSlotR * filled.filter(x => x).length;
      const pnlR2 = (pnlPerQty * cumQty) / totalRRisked;
      return { result: 'tp' as const, pnlR: pnlR2, entriesFilled: filled.filter(x => x).length };
    }

    // Try to fill entries #2 and #3
    for (let i = 1; i < N_ENTRIES; i++) {
      if (filled[i]) continue;
      const ep = entryPrices[i];
      const dist = Math.abs(ep - slPrice);
      if (dist <= 0) continue;  // entry below SL — skip
      const shouldFill = isLong ? (b.low <= ep) : (b.high >= ep);
      if (shouldFill) {
        const q = riskPerSlotR / dist;
        filled[i] = true;
        cumQty += q;
        cumNotional += q * ep;
        cumRiskAtSL += q * dist;
      }
    }
  }

  // Timeout
  const lastBar = cycleBars[cycleBars.length - 1];
  const avgEntry = cumNotional / cumQty;
  const pnlPerQty = isLong ? (lastBar.close - avgEntry) : (avgEntry - lastBar.close);
  const totalRRisked = riskPerSlotR * filled.filter(x => x).length;
  const pnlR2 = (pnlPerQty * cumQty) / totalRRisked;
  return { result: 'timeout' as const, pnlR: pnlR2, entriesFilled: filled.filter(x => x).length };
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades.json', 'utf8'));
  const trades: Trade[] = raw.trades;
  const firstTs = trades.reduce((m, t) => Math.min(m, t.entryTs), Infinity) - 24 * 3600_000;
  const lastTs = trades.reduce((m, t) => Math.max(m, t.entryTs), 0) + MS_2D + 24 * 3600_000;
  console.log(`Loading 1m bars for ${trades.length} trades…`);
  const bars1m = await loadBars('BTCUSDT', '1m', { fromTs: firstTs, toTs: lastTs });
  console.log(`Loaded ${bars1m.length} 1m bars\n`);

  const riskPerSlot = 1 / N_ENTRIES;   // 1/3 R per slot

  console.log('Baseline S1 (single entry):  n=107  WR=57.0%  sumR=31.15  PF=1.63\n');
  console.log('Modified: 3 limit entries, equal risk per slot (1/3 R each), TP recalc from avg, SL same as S1\n');

  for (const sp of [0.25, 0.4, 0.5, 0.6, 0.75]) {
    const sims = trades.map(t => simOne(t, bars1m, sp, riskPerSlot));
    const valid = sims.filter(s => s.result !== 'no_data');
    const wins = valid.filter(s => s.pnlR > 0.05).length;
    const losses = valid.filter(s => s.pnlR < -0.05).length;
    const wr = valid.length ? wins / valid.length * 100 : 0;
    const sumR = valid.reduce((s, x) => s + x.pnlR, 0);
    const winR = valid.filter(s => s.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(valid.filter(s => s.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : Infinity;
    const tp = valid.filter(s => s.result === 'tp').length;
    const sl = valid.filter(s => s.result === 'sl').length;
    const to = valid.filter(s => s.result === 'timeout').length;
    const f1 = valid.filter(s => s.entriesFilled === 1).length;
    const f2 = valid.filter(s => s.entriesFilled === 2).length;
    const f3 = valid.filter(s => s.entriesFilled === 3).length;

    console.log(`spacing=${sp}*ATR:`);
    console.log(`  n=${valid.length}  WR=${wr.toFixed(1)}%  sumR=${sumR.toFixed(2)}  PF=${pf.toFixed(2)}`);
    console.log(`  exits: tp=${tp}  sl=${sl}  timeout=${to}`);
    console.log(`  filled: 1=${f1}  2=${f2}  3=${f3}\n`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
