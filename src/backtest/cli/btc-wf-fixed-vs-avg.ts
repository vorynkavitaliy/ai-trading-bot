/**
 * Walk-forward 50/50 for TP fixed vs avg mode on BTC.
 * Tests top-3 candidates from full-period sweep.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade } from '../../strategies/cg-fade';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';
import { Strategy } from '../types';

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  slippagePct: 0.05,
  riskPctBase: 0.5,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

const BASE = {
  pctHi: 0.85, pctLo: 0.15,
  usePairTrend: true, useBtcTrend: false,
  slAtrMult: 1.5, tpAtrMult: 2.0,
  maxHoldBars: 12, riskPct: 0.5,
};

interface Cand { label: string; strategy: Strategy; }

async function runHalf(c: Cand, startTs: number, endTs: number, label: string) {
  const r = await runBacktest(c.strategy, { symbol: 'BTCUSDT', startTs, endTs, ...COMMON });
  const m = r.metrics;
  console.log(`  ${label}: n=${m.trades}  WR=${(m.winRate*100).toFixed(1)}%  PF=${m.profitFactor.toFixed(2)}  sumR=${m.totalR.toFixed(2)}  MaxDD=${m.maxDDPct.toFixed(2)}%  return=${m.netPnlPct.toFixed(2)}%`);
  return m;
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const fullStart = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log(`Split @ ${new Date(splitTs).toISOString().slice(0, 10)}`);

  const cands: Cand[] = [
    { label: 'BASELINE                            ', strategy: lsTopPositionFade(BASE) },
    // Top fixed candidates
    { label: 'TP2 cd0h decay0.5 FIXED             ', strategy: lsTopPositionFade({ ...BASE, cooldownAfterTpHours: 0, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0, sizingMode: 'dca_boost', dcaBoostDecay: 0.5, tpRecomputeOnFill: false } }) },
    { label: 'TP2 cd0h decay0.7 FIXED             ', strategy: lsTopPositionFade({ ...BASE, cooldownAfterTpHours: 0, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0, sizingMode: 'dca_boost', dcaBoostDecay: 0.7, tpRecomputeOnFill: false } }) },
    { label: 'TP2.5 cd0h decay0.5 FIXED           ', strategy: lsTopPositionFade({ ...BASE, cooldownAfterTpHours: 0, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.5, sizingMode: 'dca_boost', dcaBoostDecay: 0.5, tpRecomputeOnFill: false } }) },
    // For comparison: corresponding avg-mode candidates
    { label: 'TP2 cd0h decay0.5 avg (compare)     ', strategy: lsTopPositionFade({ ...BASE, cooldownAfterTpHours: 0, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0, sizingMode: 'dca_boost', dcaBoostDecay: 0.5 } }) },
  ];

  for (const c of cands) {
    console.log(`\n========== ${c.label.trim()} ==========`);
    const tr = await runHalf(c, fullStart, splitTs, 'TRAIN');
    const te = await runHalf(c, splitTs, now, 'TEST ');
    const dWR = te.winRate * 100 - tr.winRate * 100;
    const dPF = te.profitFactor - tr.profitFactor;
    const dSumR = te.totalR - tr.totalR;
    console.log(`  Δ TRAIN→TEST: WR ${dWR.toFixed(1)}pp  PF ${dPF.toFixed(2)}  sumR ${dSumR.toFixed(2)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
