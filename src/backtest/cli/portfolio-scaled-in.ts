/**
 * Portfolio-level scaled-in simulation across all 7 Tier-1 pairs.
 *
 * For each pair:
 *   1. Read /tmp/<PAIR>-trades.json (baseline S1/S2/S3/S4 trades)
 *   2. Load 1m bars for that pair (period covers all baseline trades)
 *   3. Simulate sp0.6 TP0.8 scaled-in on each trade
 *
 * Then merge ALL trades across pairs into a single chronological stream by
 * exitTs and compute portfolio compounding equity from a $200k base with 0.5%
 * risk per trade. Report:
 *   - Total return%
 *   - MaxDD% / MaxDD$
 *   - Longest DD period (days from peak to recovery)
 *   - Top 5 DD periods
 *   - Monthly P&L vs baseline
 *
 * Mirror the same computation for BASELINE (no scaled-in) to compare apples to apples.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { Bar } from '../types';

interface TradeRaw {
  entryTs: number; exitTs: number;
  side: 'long' | 'short';
  entry: number; sl: number;
  pnlR: number; win: boolean;
  exitReason: string;
}

interface SimResult { pair: string; entryTs: number; exitTs: number; pnlR_baseline: number; pnlR_scaled: number; }

const N_ENTRIES = 3;
const SL_ATR_MULT = 1.5;
const RISK_PER_SLOT = 1 / N_ENTRIES;
const SP = 0.6;
const TP_ATR_MULT = 0.8;
const MAX_HOLD_MS = 48 * 3600_000;

const PAIRS = ['BTCUSDT', 'TAOUSDT', 'INJUSDT', 'ATOMUSDT', 'ARBUSDT', 'XRPUSDT', 'LTCUSDT'];
const START_EQUITY = 200_000;
const RISK_PCT = 0.5;

function simOne(t: TradeRaw, bars1m: Bar[]): number {
  const isLong = t.side === 'long';
  const direction = isLong ? -1 : +1;
  const atr = Math.abs(t.entry - t.sl) / SL_ATR_MULT;
  const slPrice = t.sl;

  const entryPrices: number[] = [];
  for (let i = 0; i < N_ENTRIES; i++) entryPrices.push(t.entry + direction * i * SP * atr);

  const startTs = t.entryTs;
  const endTs = startTs + MAX_HOLD_MS;
  const cycleBars = bars1m.filter(b => b.ts >= startTs && b.ts <= endTs);
  if (cycleBars.length === 0) return t.pnlR;

  const filled: boolean[] = new Array(N_ENTRIES).fill(false);
  let cumQty = 0, cumNotional = 0;
  const dist1 = Math.abs(entryPrices[0] - slPrice);
  filled[0] = true;
  cumQty += RISK_PER_SLOT / dist1;
  cumNotional += (RISK_PER_SLOT / dist1) * entryPrices[0];

  for (const b of cycleBars) {
    const avgEntry = cumNotional / cumQty;
    const tpPrice = isLong ? avgEntry + TP_ATR_MULT * atr : avgEntry - TP_ATR_MULT * atr;

    if (isLong && b.low <= slPrice) {
      const pnl = (slPrice - avgEntry) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return pnl / totalR;
    }
    if (!isLong && b.high >= slPrice) {
      const pnl = (avgEntry - slPrice) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return pnl / totalR;
    }
    if (isLong && b.high >= tpPrice) {
      const pnl = (tpPrice - avgEntry) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return pnl / totalR;
    }
    if (!isLong && b.low <= tpPrice) {
      const pnl = (avgEntry - tpPrice) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return pnl / totalR;
    }

    for (let i = 1; i < N_ENTRIES; i++) {
      if (filled[i]) continue;
      const ep = entryPrices[i];
      const dist = Math.abs(ep - slPrice);
      if (dist <= 0) continue;
      const shouldFill = isLong ? (b.low <= ep) : (b.high >= ep);
      if (shouldFill) {
        const q = RISK_PER_SLOT / dist;
        filled[i] = true;
        cumQty += q;
        cumNotional += q * ep;
      }
    }
  }

  const lastBar = cycleBars[cycleBars.length - 1];
  const avgEntry = cumNotional / cumQty;
  const pnl = isLong ? (lastBar.close - avgEntry) * cumQty : (avgEntry - lastBar.close) * cumQty;
  const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
  return pnl / totalR;
}

interface PortfolioStats {
  equity: number;
  peak: number;
  maxDDUsd: number;
  maxDDPct: number;
  maxDDStartTs: number;
  maxDDBottomTs: number;
  maxDDRecoveryTs: number | null;
  ddPeriods: { startTs: number; bottomTs: number; recoveryTs: number | null; ddUsd: number; ddPct: number; durationDays: number }[];
}

function computePortfolio(trades: { exitTs: number; pnlR: number }[], usePnlField: 'baseline' | 'scaled', rawTrades: SimResult[]): PortfolioStats & { equityCurve: { ts: number; equity: number }[]; monthly: Record<string, number> } {
  const sorted = [...rawTrades].sort((a, b) => a.exitTs - b.exitTs);
  let equity = START_EQUITY;
  let peak = equity;
  let curPeakTs = sorted[0]?.exitTs ?? 0;
  let curDDBottom = equity;
  let curDDBottomTs = 0;
  let inDD = false;

  let maxDDUsd = 0, maxDDPct = 0, maxDDStartTs = 0, maxDDBottomTs = 0, maxDDRecoveryTs: number | null = null;
  const ddPeriods: PortfolioStats['ddPeriods'] = [];
  const equityCurve: { ts: number; equity: number }[] = [{ ts: 0, equity: START_EQUITY }];
  const monthly: Record<string, number> = {};

  for (const t of sorted) {
    const pnlR = usePnlField === 'baseline' ? t.pnlR_baseline : t.pnlR_scaled;
    const riskUsd = equity * RISK_PCT / 100;
    const pnlUsd = pnlR * riskUsd;
    equity += pnlUsd;

    if (equity > peak) {
      // We just made a new peak. Close any open DD.
      if (inDD) {
        const dur = (t.exitTs - curPeakTs) / 86400_000;
        ddPeriods.push({ startTs: curPeakTs, bottomTs: curDDBottomTs, recoveryTs: t.exitTs, ddUsd: peak - curDDBottom, ddPct: (peak - curDDBottom) / peak * 100, durationDays: dur });
      }
      peak = equity;
      curPeakTs = t.exitTs;
      inDD = false;
      curDDBottom = equity;
    } else {
      // In a drawdown
      if (!inDD) { curPeakTs = curPeakTs || t.exitTs; inDD = true; curDDBottom = equity; curDDBottomTs = t.exitTs; }
      if (equity < curDDBottom) { curDDBottom = equity; curDDBottomTs = t.exitTs; }
    }

    const dd = peak - equity;
    const ddPct = dd / peak * 100;
    if (dd > maxDDUsd) { maxDDUsd = dd; maxDDPct = ddPct; maxDDStartTs = curPeakTs; maxDDBottomTs = t.exitTs; }

    equityCurve.push({ ts: t.exitTs, equity });

    const m = new Date(t.exitTs).toISOString().slice(0, 7);
    monthly[m] = (monthly[m] ?? 0) + pnlUsd;
  }
  // Close last DD if still open
  if (inDD) {
    ddPeriods.push({ startTs: curPeakTs, bottomTs: curDDBottomTs, recoveryTs: null, ddUsd: peak - curDDBottom, ddPct: (peak - curDDBottom) / peak * 100, durationDays: (sorted[sorted.length - 1].exitTs - curPeakTs) / 86400_000 });
  }

  return { equity, peak, maxDDUsd, maxDDPct, maxDDStartTs, maxDDBottomTs, maxDDRecoveryTs, ddPeriods, equityCurve, monthly };
}

async function main() {
  console.log('Loading trade files and 1m bars for 7 pairs…');
  const allSims: SimResult[] = [];
  const perPairStats: Record<string, { baseline: { n: number; wr: number; sumR: number; pf: number }, scaled: { n: number; wr: number; sumR: number; pf: number } }> = {};

  for (const pair of PAIRS) {
    const path = `/tmp/${pair}-trades.json`;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const trades: TradeRaw[] = raw.trades;
    if (trades.length === 0) continue;

    const firstTs = trades.reduce((m, t) => Math.min(m, t.entryTs), Infinity) - 24 * 3600_000;
    const lastTs = trades.reduce((m, t) => Math.max(m, t.entryTs), 0) + 4 * 24 * 3600_000;
    const bars1m = await loadBars(pair, '1m', { fromTs: firstTs, toTs: lastTs });

    const sims: SimResult[] = [];
    for (const t of trades) {
      const pnlR_scaled = simOne(t, bars1m);
      sims.push({ pair, entryTs: t.entryTs, exitTs: t.exitTs, pnlR_baseline: t.pnlR, pnlR_scaled });
    }
    allSims.push(...sims);

    const bWins = sims.filter(s => s.pnlR_baseline > 0.05).length;
    const sWins = sims.filter(s => s.pnlR_scaled > 0.05).length;
    const bSumR = sims.reduce((s, x) => s + x.pnlR_baseline, 0);
    const sSumR = sims.reduce((s, x) => s + x.pnlR_scaled, 0);
    const bWinR = sims.filter(s => s.pnlR_baseline > 0).reduce((s, x) => s + x.pnlR_baseline, 0);
    const bLossR = Math.abs(sims.filter(s => s.pnlR_baseline < 0).reduce((s, x) => s + x.pnlR_baseline, 0));
    const sWinR = sims.filter(s => s.pnlR_scaled > 0).reduce((s, x) => s + x.pnlR_scaled, 0);
    const sLossR = Math.abs(sims.filter(s => s.pnlR_scaled < 0).reduce((s, x) => s + x.pnlR_scaled, 0));

    perPairStats[pair] = {
      baseline: { n: sims.length, wr: bWins / sims.length * 100, sumR: bSumR, pf: bLossR > 0 ? bWinR / bLossR : Infinity },
      scaled: { n: sims.length, wr: sWins / sims.length * 100, sumR: sSumR, pf: sLossR > 0 ? sWinR / sLossR : Infinity },
    };
    console.log(`  ${pair}: baseline WR ${perPairStats[pair].baseline.wr.toFixed(1)}% / sumR ${bSumR.toFixed(2)} / PF ${perPairStats[pair].baseline.pf.toFixed(2)}  →  scaled WR ${perPairStats[pair].scaled.wr.toFixed(1)}% / sumR ${sSumR.toFixed(2)} / PF ${perPairStats[pair].scaled.pf.toFixed(2)}`);
  }

  console.log(`\nTotal trades: ${allSims.length}`);

  // Per-pair table
  console.log('\n=== PER-PAIR comparison ===');
  console.log('pair      | baseline:   n   WR    sumR   PF    |  scaled:   n   WR    sumR   PF    | Δ WR    Δ sumR  Δ PF');
  for (const pair of PAIRS) {
    if (!perPairStats[pair]) { console.log(`${pair}: no trades`); continue; }
    const b = perPairStats[pair].baseline, s = perPairStats[pair].scaled;
    console.log(`${pair.padEnd(10)}|         ${String(b.n).padStart(3)}  ${b.wr.toFixed(1).padStart(4)}%  ${b.sumR.toFixed(2).padStart(6)}  ${b.pf.toFixed(2).padStart(4)}  |        ${String(s.n).padStart(3)}  ${s.wr.toFixed(1).padStart(4)}%  ${s.sumR.toFixed(2).padStart(6)}  ${s.pf.toFixed(2).padStart(4)}  |  ${(s.wr - b.wr).toFixed(1).padStart(5)}  ${(s.sumR - b.sumR).toFixed(2).padStart(6)}  ${(s.pf - b.pf).toFixed(2).padStart(5)}`);
  }

  // Portfolio
  const baselinePort = computePortfolio([], 'baseline', allSims);
  const scaledPort = computePortfolio([], 'scaled', allSims);

  console.log('\n=== PORTFOLIO comparison ===');
  console.log(`baseline:  final $${baselinePort.equity.toFixed(0)}  return ${((baselinePort.equity - START_EQUITY) / START_EQUITY * 100).toFixed(2)}%  MaxDD ${baselinePort.maxDDPct.toFixed(2)}% ($${baselinePort.maxDDUsd.toFixed(0)})`);
  console.log(`scaled-in: final $${scaledPort.equity.toFixed(0)}  return ${((scaledPort.equity - START_EQUITY) / START_EQUITY * 100).toFixed(2)}%  MaxDD ${scaledPort.maxDDPct.toFixed(2)}% ($${scaledPort.maxDDUsd.toFixed(0)})`);

  // DD periods top-5
  console.log('\n=== TOP-5 DRAWDOWN PERIODS — BASELINE ===');
  baselinePort.ddPeriods.sort((a, b) => b.ddUsd - a.ddUsd);
  for (const dd of baselinePort.ddPeriods.slice(0, 5)) {
    console.log(`  $${dd.ddUsd.toFixed(0)} (${dd.ddPct.toFixed(2)}%)  ${new Date(dd.startTs).toISOString().slice(0,10)} → ${new Date(dd.bottomTs).toISOString().slice(0,10)} → ${dd.recoveryTs ? new Date(dd.recoveryTs).toISOString().slice(0,10) : 'OPEN'}  ${dd.durationDays.toFixed(1)}d`);
  }

  console.log('\n=== TOP-5 DRAWDOWN PERIODS — SCALED-IN ===');
  scaledPort.ddPeriods.sort((a, b) => b.ddUsd - a.ddUsd);
  for (const dd of scaledPort.ddPeriods.slice(0, 5)) {
    console.log(`  $${dd.ddUsd.toFixed(0)} (${dd.ddPct.toFixed(2)}%)  ${new Date(dd.startTs).toISOString().slice(0,10)} → ${new Date(dd.bottomTs).toISOString().slice(0,10)} → ${dd.recoveryTs ? new Date(dd.recoveryTs).toISOString().slice(0,10) : 'OPEN'}  ${dd.durationDays.toFixed(1)}d`);
  }

  // Monthly P&L
  console.log('\n=== MONTHLY P&L ===');
  const months = Array.from(new Set([...Object.keys(baselinePort.monthly), ...Object.keys(scaledPort.monthly)])).sort();
  console.log('month    | baseline P&L | scaled P&L | Δ');
  for (const m of months) {
    const b = baselinePort.monthly[m] ?? 0;
    const s = scaledPort.monthly[m] ?? 0;
    console.log(`  ${m}  | $${b.toFixed(0).padStart(7)}    | $${s.toFixed(0).padStart(7)}  | $${(s - b).toFixed(0).padStart(7)}`);
  }

  // HyroTrader compliance
  console.log('\n=== HYROTRADER COMPLIANCE ===');
  console.log(`Daily DD limit -5% trailing: $${(START_EQUITY * 0.05).toFixed(0)}`);
  console.log(`Total DD limit -10% static:  $${(START_EQUITY * 0.10).toFixed(0)}`);
  console.log(`Baseline MaxDD:    $${baselinePort.maxDDUsd.toFixed(0)} (${baselinePort.maxDDPct.toFixed(2)}% of peak)`);
  console.log(`Scaled-in MaxDD:   $${scaledPort.maxDDUsd.toFixed(0)} (${scaledPort.maxDDPct.toFixed(2)}% of peak)`);

  // Save equity curves
  writeFileSync('/tmp/portfolio-equity-curves.json', JSON.stringify({
    baseline: baselinePort.equityCurve,
    scaled: scaledPort.equityCurve,
    perPair: perPairStats,
    ddPeriodsBaseline: baselinePort.ddPeriods,
    ddPeriodsScaled: scaledPort.ddPeriods,
  }, null, 2));
  console.log('\nwrote /tmp/portfolio-equity-curves.json');

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
