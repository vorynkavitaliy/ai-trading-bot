/**
 * RESEARCH: robustness analysis of v5 portfolio on STANDARD-tier 360d data.
 *
 * Read-only — uses existing src/strategies/cg-fade.ts factories + same portfolio
 * config as portfolio-v5-final.ts. Does NOT modify production strategies, engine,
 * runtime, or live config. The cron bot keeps running unchanged.
 *
 * 4 analyses:
 *   A. Rolling walk-forward: 3 overlapping train/test splits on 360d data.
 *      Tells us whether +66.96% was a single-window lucky split or holds across
 *      different anchorings.
 *   B. Parameter sensitivity: vary slAtrMult, tpAtrMult, dcaBoostDecay, spacingAtr
 *      one at a time. Plateau vs peak vs cliff.
 *   C. Bootstrap CI on annual return: resample trades 1000× with replacement,
 *      95% CI on return %. If CI crosses 0 → edge is weak.
 *   D. Monthly decomposition: which months / market regimes win / lose.
 *
 * Usage: npx tsx src/backtest/cli/wf-robustness-v5.ts
 *        npx tsx src/backtest/cli/wf-robustness-v5.ts --skip-sensitivity
 *        npx tsx src/backtest/cli/wf-robustness-v5.ts --only A
 */

import { runBacktest } from '../engine';
import {
  lsTopPositionFade, fundingFade, fundingTaConfluence,
  resetCgFadeCooldownState,
} from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

// ---------- Config (mirror portfolio-v5-final.ts) ----------

interface ScaledInCfg {
  nEntries: number; spacingAtr: number; tpAtrMult: number;
  sizingMode: 'dca_boost'; dcaBoostDecay: number; tpRecomputeOnFill: boolean;
}

const BASELINE_SCALED_IN: ScaledInCfg = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost', dcaBoostDecay: 0.5, tpRecomputeOnFill: false,
};

const COMMON_PARAMS = {
  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5,
};

interface PairCfg { pair: string; note: string; build: (scaledIn: ScaledInCfg, slAtrMult: number, tpAtrMult: number) => Strategy; }

const PORTFOLIO: PairCfg[] = [
  { pair: 'SOLUSDT',  note: 'S4', build: (s) => fundingTaConfluence({ scaledIn: s }) },
  { pair: 'INJUSDT',  note: 'S2', build: (s, sl, tp) => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: sl, tpAtrMult: tp, maxHoldBars: 12, riskPct: 0.5, scaledIn: s }) },
  { pair: 'ATOMUSDT', note: 'S3', build: (s) => fundingFade({ scaledIn: s }) },
  { pair: 'ARBUSDT',  note: 'S3', build: (s) => fundingFade({ scaledIn: s }) },
  { pair: 'XRPUSDT',  note: 'S4', build: (s) => fundingTaConfluence({ scaledIn: s }) },
  { pair: 'LTCUSDT',  note: 'S2', build: (s, sl, tp) => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: sl, tpAtrMult: tp, maxHoldBars: 12, riskPct: 0.5, scaledIn: s }) },
  { pair: 'HYPEUSDT', note: 'S4', build: (s) => fundingTaConfluence({ scaledIn: s }) },
  { pair: 'ETHUSDT',  note: 'S1', build: (s, sl, tp) => lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: sl, tpAtrMult: tp, maxHoldBars: 12, riskPct: 0.5, scaledIn: s }) },
  { pair: 'BNBUSDT',  note: 'S3', build: (s) => fundingFade({ scaledIn: s }) },
];

const MAX_CONCURRENT = 6;
const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  slippagePct: 0.05, riskPctBase: 0.5, leverage: 10,
  decisionTf: '240m' as const, tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

// ---------- Shared aggregation (mirrors portfolio-v5-final.ts) ----------

function applyPortfolioKills(trades: ClosedTrade[], startEquity: number, riskPct: number) {
  if (trades.length === 0) return { keep: [] as ClosedTrade[], dropped: 0 };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
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
      if (!dropped.has(ev.trade)) {
        const pnlUsd = ev.trade.pnlR * (startEquity * riskPct / 100);
        equity += pnlUsd;
        openCount--;
      }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)), dropped: dropped.size };
}

interface AggResult { n: number; wr: number; pf: number; sumR: number; ret: number; dd: number; }

function aggregate(trades: ClosedTrade[], label?: string): AggResult {
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
  const result: AggResult = {
    n: total, wr: total > 0 ? wins / total * 100 : 0,
    pf: lossR > 0 ? winR / lossR : 0,
    sumR, ret: (equity - COMMON.startEquity) / COMMON.startEquity * 100, dd: maxDD,
  };
  if (label) {
    console.log(`  ${label.padEnd(30)} n=${String(result.n).padStart(3)} WR=${result.wr.toFixed(1).padStart(5)}% PF=${result.pf.toFixed(2).padStart(5)} sumR=${result.sumR.toFixed(2).padStart(7)} ret=${result.ret.toFixed(2).padStart(6)}% DD=${result.dd.toFixed(2).padStart(5)}%`);
  }
  return result;
}

async function runConfig(scaledIn: ScaledInCfg, slAtrMult: number, tpAtrMult: number, startTs: number, endTs: number): Promise<ClosedTrade[]> {
  const all: ClosedTrade[] = [];
  for (const cfg of PORTFOLIO) {
    resetCgFadeCooldownState();
    const strategy = cfg.build(scaledIn, slAtrMult, tpAtrMult);
    const r = await runBacktest(strategy, { symbol: cfg.pair, startTs, endTs, ...COMMON });
    all.push(...r.trades);
  }
  return all;
}

// ---------- A. Rolling walk-forward ----------

async function analysisA(now: number) {
  console.log('\n=== A. ROLLING WALK-FORWARD (3 windows, 6mo train / 2mo test) ===');
  console.log('   Each window: train on 6 months, test on the following 2 months. Sliding by 1 month.\n');
  const day = 24 * 3600_000;
  const month = 30 * day;

  // Use total 12mo window. Train 6mo, test 2mo, slide by 1mo → 3 windows leaving room.
  // Window 1: train mo 1-6, test mo 7-8
  // Window 2: train mo 2-7, test mo 8-9
  // Window 3: train mo 3-8, test mo 9-10
  const windows = [
    { name: 'W1', trainStart: now - 12 * month, trainEnd: now - 6 * month, testStart: now - 6 * month, testEnd: now - 4 * month },
    { name: 'W2', trainStart: now - 11 * month, trainEnd: now - 5 * month, testStart: now - 5 * month, testEnd: now - 3 * month },
    { name: 'W3', trainStart: now - 10 * month, trainEnd: now - 4 * month, testStart: now - 4 * month, testEnd: now - 2 * month },
  ];

  const testResults: AggResult[] = [];
  for (const w of windows) {
    console.log(`${w.name}:`);
    console.log(`   train ${new Date(w.trainStart).toISOString().slice(0,10)} → ${new Date(w.trainEnd).toISOString().slice(0,10)}`);
    console.log(`   test  ${new Date(w.testStart).toISOString().slice(0,10)} → ${new Date(w.testEnd).toISOString().slice(0,10)}`);
    const trTrades = await runConfig(BASELINE_SCALED_IN, COMMON_PARAMS.slAtrMult, COMMON_PARAMS.tpAtrMult, w.trainStart, w.trainEnd);
    aggregate(trTrades, `  TRAIN`);
    const teTrades = await runConfig(BASELINE_SCALED_IN, COMMON_PARAMS.slAtrMult, COMMON_PARAMS.tpAtrMult, w.testStart, w.testEnd);
    const teRes = aggregate(teTrades, `  TEST `);
    testResults.push(teRes);
  }

  const allPositive = testResults.every(r => r.ret > 0);
  const meanRet = testResults.reduce((s, r) => s + r.ret, 0) / testResults.length;
  const variance = testResults.reduce((s, r) => s + (r.ret - meanRet) ** 2, 0) / testResults.length;
  const stddev = Math.sqrt(variance);
  console.log(`\n   Verdict: ${testResults.length}/${testResults.length} windows ${allPositive ? '✓ all positive' : '✗ NOT all positive'}, mean test ret ${meanRet.toFixed(2)}% ± ${stddev.toFixed(2)}%`);
}

// ---------- B. Parameter sensitivity ----------

async function analysisB(now: number) {
  console.log('\n=== B. PARAM SENSITIVITY (full 12mo, vary 1 param at a time) ===');
  const day = 24 * 3600_000;
  const startTs = now - 360 * day;

  // Baseline first
  console.log('Baseline:');
  const base = await runConfig(BASELINE_SCALED_IN, COMMON_PARAMS.slAtrMult, COMMON_PARAMS.tpAtrMult, startTs, now);
  aggregate(base, '  baseline');

  // slAtrMult sweep
  console.log('\nslAtrMult (baseline 1.5):');
  for (const sl of [1.0, 1.25, 1.5, 1.75, 2.0]) {
    const trades = await runConfig(BASELINE_SCALED_IN, sl, COMMON_PARAMS.tpAtrMult, startTs, now);
    aggregate(trades, `  sl=${sl}`);
  }

  // tpAtrMult sweep (also varies scaledIn.tpAtrMult since they share)
  console.log('\ntpAtrMult (baseline 2.0):');
  for (const tp of [1.5, 2.0, 2.5, 3.0]) {
    const si = { ...BASELINE_SCALED_IN, tpAtrMult: tp };
    const trades = await runConfig(si, COMMON_PARAMS.slAtrMult, tp, startTs, now);
    aggregate(trades, `  tp=${tp}`);
  }

  // dcaBoostDecay
  console.log('\ndcaBoostDecay (baseline 0.5):');
  for (const decay of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const si = { ...BASELINE_SCALED_IN, dcaBoostDecay: decay };
    const trades = await runConfig(si, COMMON_PARAMS.slAtrMult, COMMON_PARAMS.tpAtrMult, startTs, now);
    aggregate(trades, `  decay=${decay}`);
  }

  // spacingAtr
  console.log('\nspacingAtr (baseline 0.5):');
  for (const sp of [0.3, 0.4, 0.5, 0.6, 0.8]) {
    const si = { ...BASELINE_SCALED_IN, spacingAtr: sp };
    const trades = await runConfig(si, COMMON_PARAMS.slAtrMult, COMMON_PARAMS.tpAtrMult, startTs, now);
    aggregate(trades, `  sp=${sp}`);
  }

  return base; // return for reuse in C and D
}

// ---------- C. Bootstrap CI ----------

function bootstrapCI(trades: ClosedTrade[], iterations = 1000, ciPct = 95) {
  if (trades.length === 0) return { lo: 0, hi: 0, median: 0 };
  const fixedRiskUsd = COMMON.startEquity * (COMMON.riskPctBase / 100);
  const returns: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < trades.length; j++) {
      const idx = Math.floor(Math.random() * trades.length);
      sum += trades[idx].pnlR * fixedRiskUsd;
    }
    returns.push(sum / COMMON.startEquity * 100);
  }
  returns.sort((a, b) => a - b);
  const tail = (100 - ciPct) / 2 / 100;
  const lo = returns[Math.floor(iterations * tail)];
  const hi = returns[Math.floor(iterations * (1 - tail))];
  const median = returns[Math.floor(iterations / 2)];
  return { lo, hi, median };
}

function analysisC(baseTrades: ClosedTrade[]) {
  console.log('\n=== C. BOOTSTRAP CI (1000 resamples, 95% CI on 12mo return) ===');
  const { keep } = applyPortfolioKills(baseTrades, COMMON.startEquity, COMMON.riskPctBase);
  const { lo, hi, median } = bootstrapCI(keep);
  console.log(`   Median return: ${median.toFixed(2)}%`);
  console.log(`   95% CI: [${lo.toFixed(2)}%, ${hi.toFixed(2)}%]`);
  console.log(`   Verdict: ${lo > 0 ? '✓ CI lower bound positive — edge is real' : '✗ CI lower bound negative — edge could be variance'}`);
}

// ---------- D. Monthly decomposition ----------

function analysisD(baseTrades: ClosedTrade[]) {
  console.log('\n=== D. MONTHLY P&L DECOMPOSITION ===');
  const { keep } = applyPortfolioKills(baseTrades, COMMON.startEquity, COMMON.riskPctBase);
  const fixedRiskUsd = COMMON.startEquity * (COMMON.riskPctBase / 100);
  const monthly: Record<string, { pnl: number; n: number; wins: number }> = {};
  for (const t of keep) {
    const m = new Date(t.entryTs).toISOString().slice(0, 7);
    if (!monthly[m]) monthly[m] = { pnl: 0, n: 0, wins: 0 };
    monthly[m].pnl += t.pnlR * fixedRiskUsd;
    monthly[m].n++;
    if (t.pnlR > 0.05) monthly[m].wins++;
  }
  const months = Object.keys(monthly).sort();
  let runEq = COMMON.startEquity;
  let positiveMonths = 0;
  for (const m of months) {
    const d = monthly[m];
    runEq += d.pnl;
    const pct = d.pnl / (runEq - d.pnl) * 100;
    const wr = d.n > 0 ? (d.wins / d.n * 100).toFixed(0) + '%' : '—';
    const sign = d.pnl >= 0 ? '+' : '';
    if (d.pnl > 0) positiveMonths++;
    console.log(`   ${m}: ${sign}$${d.pnl.toFixed(0).padStart(7)} (${pct.toFixed(2).padStart(6)}%)  n=${String(d.n).padStart(3)} WR=${wr.padStart(5)}  → equity $${runEq.toFixed(0)}`);
  }
  console.log(`\n   Positive months: ${positiveMonths}/${months.length} (${(positiveMonths/months.length*100).toFixed(0)}%)`);
}

// ---------- Main ----------

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const skipA = only && only !== 'A';
  const skipB = only && only !== 'B';
  const skipCD = only && only !== 'CD';
  const now = Date.now();

  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('  V5 PORTFOLIO ROBUSTNESS ANALYSIS — read-only research, bot untouched');
  console.log(`  Run: ${new Date(now).toISOString()}`);
  console.log(`  Pairs: ${PORTFOLIO.map(p => p.pair).join(', ')}`);
  console.log('═════════════════════════════════════════════════════════════════════════════');

  if (!skipA) await analysisA(now);

  let baseTrades: ClosedTrade[] = [];
  if (!skipB) {
    baseTrades = await analysisB(now);
  } else if (!skipCD) {
    // Need baseline for C and D
    const day = 24 * 3600_000;
    baseTrades = await runConfig(BASELINE_SCALED_IN, COMMON_PARAMS.slAtrMult, COMMON_PARAMS.tpAtrMult, now - 360 * day, now);
  }

  if (!skipCD && baseTrades.length > 0) {
    analysisC(baseTrades);
    analysisD(baseTrades);
  }

  console.log('\n═════════════════════════════════════════════════════════════════════════════');
  console.log('  Done. Bot in production untouched.');
  console.log('═════════════════════════════════════════════════════════════════════════════\n');

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
