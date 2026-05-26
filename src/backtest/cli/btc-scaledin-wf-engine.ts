/**
 * Walk-forward validation of best scaled-in config through REAL engine.
 *
 * Runs the strategy on TRAIN half (first 50%) and TEST half (second 50%) by
 * setting startTs/endTs in the engine. Compares scaled-in vs baseline on each
 * half. Acceptance: TEST sumR ≥ baseline TEST sumR AND TEST MaxDD ≤ 2× baseline TEST MaxDD.
 *
 * Candidates to validate (BTC standalone winners from sweep):
 *   1. sp0.6 TP2.5 cd8h decay0.5  — sumR +23.07, MaxDD 6.05%
 *   2. sp0.6 TP2 cd0h decay0.5     — sumR +18.09, MaxDD 6.40%
 *   3. sp0.6 TP2 cd8h decay0.5     — sumR +16.27, MaxDD 5.65%
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

const BASE_PARAMS = {
  pctHi: 0.85, pctLo: 0.15,
  usePairTrend: true, useBtcTrend: false,
  slAtrMult: 1.5, tpAtrMult: 2.0,
  maxHoldBars: 12, riskPct: 0.5,
};

interface Candidate { label: string; strategy: Strategy; }

async function runHalf(c: Candidate, startTs: number, endTs: number, label: string) {
  const r = await runBacktest(c.strategy, { symbol: 'BTCUSDT', startTs, endTs, ...COMMON });
  console.log(`  ${label}: n=${r.metrics.trades}  WR=${(r.metrics.winRate*100).toFixed(1)}%  PF=${r.metrics.profitFactor.toFixed(2)}  sumR=${r.metrics.totalR.toFixed(2)}  MaxDD=${r.metrics.maxDDPct.toFixed(2)}%  return=${r.metrics.netPnlPct.toFixed(2)}%`);
  return r.metrics;
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const fullStart = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log(`Full period: ${new Date(fullStart).toISOString().slice(0,10)} → ${new Date(now).toISOString().slice(0,10)}`);
  console.log(`Split at:    ${new Date(splitTs).toISOString().slice(0,10)}`);
  console.log(`TRAIN: first half, TEST: second half\n`);

  const candidates: Candidate[] = [
    { label: 'BASELINE', strategy: lsTopPositionFade(BASE_PARAMS) },
    { label: 'sp0.6 TP2.5 cd8h decay0.5', strategy: lsTopPositionFade({ ...BASE_PARAMS, cooldownAfterTpHours: 8, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.5, sizingMode: 'dca_boost', dcaBoostDecay: 0.5 } }) },
    { label: 'sp0.6 TP2 cd0h decay0.5  ', strategy: lsTopPositionFade({ ...BASE_PARAMS, cooldownAfterTpHours: 0, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0, sizingMode: 'dca_boost', dcaBoostDecay: 0.5 } }) },
    { label: 'sp0.6 TP2 cd8h decay0.5  ', strategy: lsTopPositionFade({ ...BASE_PARAMS, cooldownAfterTpHours: 8, scaledIn: { nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0, sizingMode: 'dca_boost', dcaBoostDecay: 0.5 } }) },
  ];

  for (const c of candidates) {
    console.log(`\n========== ${c.label} ==========`);
    const train = await runHalf(c, fullStart, splitTs, 'TRAIN');
    const test = await runHalf(c, splitTs, now, 'TEST ');
    console.log(`  Δ TRAIN→TEST:  WR ${(test.winRate*100 - train.winRate*100).toFixed(1)}pp  PF ${(test.profitFactor - train.profitFactor).toFixed(2)}  sumR ${(test.totalR - train.totalR).toFixed(2)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
