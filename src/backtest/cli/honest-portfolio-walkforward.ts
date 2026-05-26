/**
 * Walk-forward 50/50 для baseline vs scaled-in FIXED на honest engine.
 * Запускает оба конфига на TRAIN (first half) и TEST (second half) per-pair,
 * aggregates portfolio metrics.
 */
import { runBacktest } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

interface PairCfg { pair: string; baseline: Strategy; scaledin: Strategy; }

const PAIRS: PairCfg[] = [
  { pair: 'BTCUSDT', baseline: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }),
    scaledin: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true, useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'TAOUSDT', baseline: fundingFade(), scaledin: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'INJUSDT', baseline: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }),
    scaledin: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', baseline: fundingFade(), scaledin: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT', baseline: fundingFade(), scaledin: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT', baseline: fundingTaConfluence(), scaledin: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT', baseline: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5 }),
    scaledin: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
];

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

function aggregate(allTrades: ClosedTrade[], label: string) {
  allTrades.sort((a, b) => a.entryTs - b.entryTs);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0;
  let sumR = 0;
  for (const t of allTrades) {
    const riskUsd = equity * (COMMON.riskPctBase / 100);
    equity += t.pnlR * riskUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = allTrades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(allTrades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const pf = lossR > 0 ? winR / lossR : Infinity;
  console.log(`  ${label}: n=${total} WR=${(wins/total*100).toFixed(1)}% PF=${pf.toFixed(2)} sumR=${sumR.toFixed(2)} return=${((equity-COMMON.startEquity)/COMMON.startEquity*100).toFixed(2)}% MaxDD=${maxDD.toFixed(2)}%`);
  return { wins, losses, sumR, pf, returnPct: (equity-COMMON.startEquity)/COMMON.startEquity*100, maxDD };
}

async function runOne(strategy: Strategy, pair: string, startTs: number, endTs: number) {
  const r = await runBacktest(strategy, { symbol: pair, startTs, endTs, ...COMMON });
  return r.trades;
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const fullStart = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log(`Honest portfolio walk-forward, split @ ${new Date(splitTs).toISOString().slice(0, 10)}\n`);

  const baselineTrain: ClosedTrade[] = [];
  const baselineTest: ClosedTrade[] = [];
  const scaledTrain: ClosedTrade[] = [];
  const scaledTest: ClosedTrade[] = [];

  for (const p of PAIRS) {
    console.log(`Running ${p.pair}…`);
    const bTr = await runOne(p.baseline, p.pair, fullStart, splitTs);
    const bTe = await runOne(p.baseline, p.pair, splitTs, now);
    const sTr = await runOne(p.scaledin, p.pair, fullStart, splitTs);
    const sTe = await runOne(p.scaledin, p.pair, splitTs, now);
    baselineTrain.push(...bTr);
    baselineTest.push(...bTe);
    scaledTrain.push(...sTr);
    scaledTest.push(...sTe);
  }

  console.log('\n=== BASELINE ===');
  const bTr = aggregate(baselineTrain, 'TRAIN');
  const bTe = aggregate(baselineTest, 'TEST ');

  console.log('\n=== SCALED-IN FIXED ===');
  const sTr = aggregate(scaledTrain, 'TRAIN');
  const sTe = aggregate(scaledTest, 'TEST ');

  console.log('\n=== TEST COMPARISON ===');
  console.log(`Baseline TEST:  sumR ${bTe.sumR.toFixed(2)} return ${bTe.returnPct.toFixed(2)}% MaxDD ${bTe.maxDD.toFixed(2)}%`);
  console.log(`Scaled   TEST:  sumR ${sTe.sumR.toFixed(2)} return ${sTe.returnPct.toFixed(2)}% MaxDD ${sTe.maxDD.toFixed(2)}%`);
  console.log(`Δ TEST: sumR ${(sTe.sumR - bTe.sumR).toFixed(2)}  return ${(sTe.returnPct - bTe.returnPct).toFixed(2)}pp`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
