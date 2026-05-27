/**
 * RESEARCH: walk-forward validation of dcaBoostDecay=0.7 vs baseline 0.5.
 *
 * In-sample sweep (wf-robustness-v5.ts B section, 2026-05-26):
 *   decay=0.5 → ret 67.55% / DD 2.74% / sumR 135.10 (baseline)
 *   decay=0.7 → ret 72.65% / DD 2.72% / sumR 145.31 (+5pp in-sample lift)
 *
 * Concern: total full-deploy risk grows 1.75R → 2.19R per position. Worth it
 * ONLY if OOS dominates baseline across multiple windows. Memory warns
 * [[feedback-overfit-lessons]]: in-sample 3-5× rosier than OOS without WF.
 *
 * Test: same 3 rolling windows as robustness analysis (6mo train / 2mo test,
 * sliding 1mo). For each window, run BOTH decay=0.5 and decay=0.7 on identical
 * train + test windows. Compare TEST returns directly.
 *
 * Verdict criteria:
 *   - decay=0.7 wins ≥2 of 3 OOS test windows → green light, consider live
 *   - decay=0.7 wins 1/3 OOS → marginal, keep baseline
 *   - decay=0.7 wins 0/3 OOS → confirmed in-sample artifact, definitely keep 0.5
 *
 * Read-only — does not touch production strategies or runtime.
 */

import { runBacktest } from '../engine';
import {
  lsTopPositionFade, fundingFade, fundingTaConfluence,
  resetCgFadeCooldownState,
} from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

interface ScaledInCfg {
  nEntries: number; spacingAtr: number; tpAtrMult: number;
  sizingMode: 'dca_boost'; dcaBoostDecay: number; tpRecomputeOnFill: boolean;
}

const BASE: ScaledInCfg = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost', dcaBoostDecay: 0.5, tpRecomputeOnFill: false,
};
const DECAY07: ScaledInCfg = { ...BASE, dcaBoostDecay: 0.7 };

interface PairCfg { pair: string; build: (s: ScaledInCfg) => Strategy; }
const PORTFOLIO: PairCfg[] = [
  { pair: 'SOLUSDT',  build: (s) => fundingTaConfluence({ scaledIn: s }) },
  { pair: 'INJUSDT',  build: (s) => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: s }) },
  { pair: 'ATOMUSDT', build: (s) => fundingFade({ scaledIn: s }) },
  { pair: 'ARBUSDT',  build: (s) => fundingFade({ scaledIn: s }) },
  { pair: 'XRPUSDT',  build: (s) => fundingTaConfluence({ scaledIn: s }) },
  { pair: 'LTCUSDT',  build: (s) => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: s }) },
  { pair: 'HYPEUSDT', build: (s) => fundingTaConfluence({ scaledIn: s }) },
  { pair: 'ETHUSDT',  build: (s) => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: s }) },
  { pair: 'BNBUSDT',  build: (s) => fundingFade({ scaledIn: s }) },
];

const MAX_CONCURRENT = 6;
const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000, slippagePct: 0.05, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

function applyPortfolioKills(trades: ClosedTrade[], startEquity: number, riskPct: number) {
  if (trades.length === 0) return { keep: [] as ClosedTrade[] };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) { events.push({ ts: t.entryTs, kind: 'entry', trade: t }); events.push({ ts: t.exitTs, kind: 'exit', trade: t }); }
  events.sort((a, b) => a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'entry' ? -1 : 1));
  const dropped = new Set<ClosedTrade>();
  let equity = startEquity;
  let dailyOpen = { day: new Date(events[0].ts).toISOString().slice(0, 10), equity: startEquity };
  let openCount = 0;
  for (const ev of events) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    if (day !== dailyOpen.day) dailyOpen = { day, equity };
    if (ev.kind === 'entry') {
      const totalPct = (equity - startEquity) / startEquity * 100;
      const dailyPct = (equity - dailyOpen.equity) / dailyOpen.equity * 100;
      if (totalPct <= -8.0 || dailyPct <= -4.0 || dailyPct <= -2.5) dropped.add(ev.trade);
      else if (openCount >= MAX_CONCURRENT) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) { equity += ev.trade.pnlR * (startEquity * riskPct / 100); openCount--; }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)) };
}

interface AggResult { n: number; wr: number; pf: number; sumR: number; ret: number; dd: number; }
function aggregate(trades: ClosedTrade[]): AggResult {
  const { keep } = applyPortfolioKills(trades, COMMON.startEquity, COMMON.riskPctBase);
  trades = keep;
  const fixedRiskUsd = COMMON.startEquity * (COMMON.riskPctBase / 100);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  for (const t of trades) {
    const pnlUsd = t.pnlR * fixedRiskUsd;
    equity += pnlUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return {
    n: total, wr: total > 0 ? wins / total * 100 : 0,
    pf: lossR > 0 ? winR / lossR : 0,
    sumR, ret: (equity - COMMON.startEquity) / COMMON.startEquity * 100, dd: maxDD,
  };
}

async function runConfig(scaledIn: ScaledInCfg, startTs: number, endTs: number): Promise<ClosedTrade[]> {
  const all: ClosedTrade[] = [];
  for (const cfg of PORTFOLIO) {
    resetCgFadeCooldownState();
    const r = await runBacktest(cfg.build(scaledIn), { symbol: cfg.pair, startTs, endTs, ...COMMON });
    all.push(...r.trades);
  }
  return all;
}

function fmt(r: AggResult): string {
  return `n=${String(r.n).padStart(3)} WR=${r.wr.toFixed(1).padStart(5)}% PF=${r.pf.toFixed(2).padStart(5)} sumR=${r.sumR.toFixed(2).padStart(7)} ret=${r.ret.toFixed(2).padStart(6)}% DD=${r.dd.toFixed(2).padStart(5)}%`;
}

async function main() {
  const now = Date.now();
  const day = 24 * 3600_000;
  const month = 30 * day;

  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('  V5 DCA-BOOST DECAY: 0.5 (baseline) vs 0.7 (research) — walk-forward');
  console.log(`  Run: ${new Date(now).toISOString()}`);
  console.log(`  Pairs: ${PORTFOLIO.map(p => p.pair).join(', ')}`);
  console.log('═════════════════════════════════════════════════════════════════════════════');

  const windows = [
    { name: 'W1', trainStart: now - 12 * month, trainEnd: now - 6 * month, testStart: now - 6 * month, testEnd: now - 4 * month },
    { name: 'W2', trainStart: now - 11 * month, trainEnd: now - 5 * month, testStart: now - 5 * month, testEnd: now - 3 * month },
    { name: 'W3', trainStart: now - 10 * month, trainEnd: now - 4 * month, testStart: now - 4 * month, testEnd: now - 2 * month },
  ];

  const results: { window: string; baseTrain: AggResult; decayTrain: AggResult; baseTest: AggResult; decayTest: AggResult }[] = [];

  for (const w of windows) {
    console.log(`\n=== ${w.name} ===`);
    console.log(`   train ${new Date(w.trainStart).toISOString().slice(0,10)} → ${new Date(w.trainEnd).toISOString().slice(0,10)}`);
    console.log(`   test  ${new Date(w.testStart).toISOString().slice(0,10)} → ${new Date(w.testEnd).toISOString().slice(0,10)}`);

    const baseTr = await runConfig(BASE, w.trainStart, w.trainEnd);
    const baseTe = await runConfig(BASE, w.testStart, w.testEnd);
    const decayTr = await runConfig(DECAY07, w.trainStart, w.trainEnd);
    const decayTe = await runConfig(DECAY07, w.testStart, w.testEnd);

    const baseTrA = aggregate(baseTr);
    const baseTeA = aggregate(baseTe);
    const decayTrA = aggregate(decayTr);
    const decayTeA = aggregate(decayTe);

    console.log(`   TRAIN  base 0.5: ${fmt(baseTrA)}`);
    console.log(`   TRAIN  decay0.7: ${fmt(decayTrA)}`);
    console.log(`   TEST   base 0.5: ${fmt(baseTeA)}`);
    console.log(`   TEST   decay0.7: ${fmt(decayTeA)}`);
    console.log(`   TEST   Δret: ${(decayTeA.ret - baseTeA.ret).toFixed(2).padStart(6)}pp,  Δdd: ${(decayTeA.dd - baseTeA.dd).toFixed(2).padStart(5)}pp`);

    results.push({ window: w.name, baseTrain: baseTrA, decayTrain: decayTrA, baseTest: baseTeA, decayTest: decayTeA });
  }

  // Verdict
  console.log('\n═════════════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY: TEST window-by-window');
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('Window | base 0.5 ret | decay 0.7 ret |   Δ ret    | base DD | decay DD |  Δ DD  | winner');
  let decayWins = 0, ties = 0, baseWins = 0;
  for (const r of results) {
    const dRet = r.decayTest.ret - r.baseTest.ret;
    const dDD = r.decayTest.dd - r.baseTest.dd;
    let winner: string;
    if (Math.abs(dRet) < 0.5) { ties++; winner = 'tie'; }
    else if (dRet > 0 && dDD < 1.0) { decayWins++; winner = '✓ decay 0.7'; }
    else if (dRet < 0) { baseWins++; winner = '✗ base 0.5'; }
    else { baseWins++; winner = '✗ base 0.5 (dd too much)'; }
    console.log(`  ${r.window}   | ${r.baseTest.ret.toFixed(2).padStart(6)}%     | ${r.decayTest.ret.toFixed(2).padStart(6)}%       | ${dRet.toFixed(2).padStart(5)}pp    | ${r.baseTest.dd.toFixed(2).padStart(5)}%  | ${r.decayTest.dd.toFixed(2).padStart(5)}%   | ${dDD.toFixed(2).padStart(5)}pp | ${winner}`);
  }
  console.log(`\nDecay 0.7 wins: ${decayWins}/3,  ties: ${ties}/3,  base wins: ${baseWins}/3`);

  if (decayWins >= 2) {
    console.log('\n🟢 VERDICT: decay=0.7 dominates OOS. Consider live migration.');
    console.log('   Note: full-deploy risk per position grows 1.75R → 2.19R.');
    console.log('   Recommended: deploy to 1 sub-account first, watch 2-3 weeks, then full rollout.');
  } else if (decayWins === 1 && baseWins === 0) {
    console.log('\n🟡 VERDICT: decay=0.7 marginal. Keep baseline 0.5 for now.');
  } else {
    console.log('\n🔴 VERDICT: decay=0.7 does NOT generalize OOS — in-sample artifact.');
    console.log('   Keep baseline decay=0.5. The +5pp in-sample lift was variance/overfit.');
  }

  console.log('\nBot in production untouched.\n');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
