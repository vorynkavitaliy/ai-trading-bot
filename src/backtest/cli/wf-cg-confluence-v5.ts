/**
 * RESEARCH: test taker delta + liquidation cascade as CONFLUENCE filters on v5.
 *
 * Hypotheses being tested (both walked-forward from day 1):
 *
 *   F1. Taker-delta extreme fade
 *       - LONG entry: only if taker_delta in last 4h is in BOTTOM X% of 180-bar history
 *         (sellers dominated → contrarian long supported)
 *       - SHORT entry: only if taker_delta in TOP X% (buyers dominated → contrarian short)
 *       - Threshold sweep: 0.20, 0.30, 0.40 (more selective → fewer trades)
 *
 *   F2. Liquidation cascade confirmation
 *       - LONG entry: only if long_liq_usd in last 4h ≥ 75th percentile of 180-bar history
 *         (longs got flushed → oversold)
 *       - SHORT entry: only if short_liq_usd ≥ 75th percentile (shorts squeezed → overbought)
 *       - Threshold sweep: 0.50, 0.70, 0.85
 *
 * Memory: [[feedback-cg-gates-overfit]] warns of 4 consecutive CG-gate failures
 * (regime, size grading, orderbook imbalance, scaled-in-on-VP-SMC). Default
 * expectation: most variants fail OOS. If any survives, must dominate baseline
 * by ≥3pp ret AND not worsen DD by ≥1pp.
 *
 * Test: same 3 rolling windows as wf-decay07. For each variant, compute test-window
 * Δret vs baseline. Verdict per variant.
 *
 * Read-only. Bot untouched.
 */

import { runBacktest } from '../engine';
import {
  lsTopPositionFade, fundingFade, fundingTaConfluence,
  resetCgFadeCooldownState,
} from '../../strategies/cg-fade';
import { Action, ClosedTrade, Strategy, StrategyContext } from '../types';
import { close as closePg, query } from '../../core/db';
import { BACKTEST_COMMON } from '../defaults';

interface ScaledInCfg {
  nEntries: number; spacingAtr: number; tpAtrMult: number;
  sizingMode: 'dca_boost'; dcaBoostDecay: number; tpRecomputeOnFill: boolean;
}
const BASE: ScaledInCfg = {
  nEntries: 3, spacingAtr: 0.5, tpAtrMult: 2.0,
  sizingMode: 'dca_boost', dcaBoostDecay: 0.5, tpRecomputeOnFill: false,
};

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

const FOUR_H = 4 * 3600_000;
const WINDOW_BARS = 180;

// ---------- Pre-load confluence data ----------

interface BarData { delta: number; longLiq: number; shortLiq: number; }

async function preloadConfluence(pair: string, startTs: number, endTs: number): Promise<Map<number, { deltaPctile: number; longLiqPctile: number; shortLiqPctile: number }>> {
  // Query a bit more history before startTs so we can compute pctile from bar 1
  const lookbackStart = startTs - WINDOW_BARS * FOUR_H;
  const takerRows = await query<{ ts: string; buy_usd: string; sell_usd: string }>(
    `SELECT ts::text, buy_usd::text, sell_usd::text FROM cg_taker_pair WHERE pair = $1 AND exchange = 'Binance' AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
    [pair, lookbackStart, endTs]
  );
  const liqRows = await query<{ ts: string; long_liq_usd: string; short_liq_usd: string }>(
    `SELECT ts::text, long_liq_usd::text, short_liq_usd::text FROM cg_liq_pair WHERE pair = $1 AND exchange = 'Binance' AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
    [pair, lookbackStart, endTs]
  );

  // Index by ts
  const bars = new Map<number, BarData>();
  for (const r of takerRows.rows) {
    const ts = Number(r.ts);
    bars.set(ts, { delta: parseFloat(r.buy_usd) - parseFloat(r.sell_usd), longLiq: 0, shortLiq: 0 });
  }
  for (const r of liqRows.rows) {
    const ts = Number(r.ts);
    const b = bars.get(ts) ?? { delta: 0, longLiq: 0, shortLiq: 0 };
    b.longLiq = parseFloat(r.long_liq_usd);
    b.shortLiq = parseFloat(r.short_liq_usd);
    bars.set(ts, b);
  }

  // Sort tses, compute rolling percentiles
  const tses = [...bars.keys()].sort((a, b) => a - b);
  const result = new Map<number, { deltaPctile: number; longLiqPctile: number; shortLiqPctile: number }>();

  for (let i = 0; i < tses.length; i++) {
    const ts = tses[i];
    const windowStart = Math.max(0, i - WINDOW_BARS + 1);
    const window = tses.slice(windowStart, i + 1).map(t => bars.get(t)!);
    const cur = bars.get(ts)!;
    const deltaRank = window.filter(x => x.delta <= cur.delta).length / window.length;
    const longLiqRank = window.filter(x => x.longLiq <= cur.longLiq).length / window.length;
    const shortLiqRank = window.filter(x => x.shortLiq <= cur.shortLiq).length / window.length;
    result.set(ts, { deltaPctile: deltaRank, longLiqPctile: longLiqRank, shortLiqPctile: shortLiqRank });
  }
  return result;
}

// ---------- Strategy wrappers ----------

type FilterFn = (action: Action & { kind: 'enter' }, ctx: StrategyContext, bar: { deltaPctile: number; longLiqPctile: number; shortLiqPctile: number } | undefined) => boolean;

function wrap(base: Strategy, name: string, dataMap: Map<number, any>, filter: FilterFn): Strategy {
  return {
    name: `${base.name}+${name}`,
    needsCoinglass: true,
    decide(ctx) {
      const action = base.decide(ctx);
      if (action.kind !== 'enter') return action;
      // Find latest 4h bar at or before ctx.ts
      const barTs = Math.floor(ctx.ts / FOUR_H) * FOUR_H;
      const bar = dataMap.get(barTs);
      // If filter rejects, return hold
      return filter(action as any, ctx, bar) ? action : { kind: 'hold' };
    },
  };
}

// F1: Taker delta extreme
//   LONG: deltaPctile ≤ threshold (sellers dominated → contrarian long)
//   SHORT: deltaPctile ≥ 1 - threshold (buyers dominated → contrarian short)
function takerDeltaFilter(threshold: number): FilterFn {
  return (action, _ctx, bar) => {
    if (!bar) return true; // No data — pass (don't penalize missing data)
    if (action.side === 'long') return bar.deltaPctile <= threshold;
    return bar.deltaPctile >= (1 - threshold);
  };
}

// F2: Liquidation cascade
//   LONG: longLiqPctile ≥ threshold (recent long liq cascade → oversold)
//   SHORT: shortLiqPctile ≥ threshold (recent short squeeze → overbought)
function liqCascadeFilter(threshold: number): FilterFn {
  return (action, _ctx, bar) => {
    if (!bar) return true;
    if (action.side === 'long') return bar.longLiqPctile >= threshold;
    return bar.shortLiqPctile >= threshold;
  };
}

// ---------- Shared agg ----------

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

// ---------- Variant runner ----------

interface Variant { label: string; build: (pair: string, pairCfg: PairCfg, data: Map<number, any>) => Strategy; }

async function runVariant(variant: Variant, windowStart: number, windowEnd: number, dataByPair: Record<string, Map<number, any>>): Promise<ClosedTrade[]> {
  const all: ClosedTrade[] = [];
  for (const cfg of PORTFOLIO) {
    resetCgFadeCooldownState();
    const strategy = variant.build(cfg.pair, cfg, dataByPair[cfg.pair]);
    const r = await runBacktest(strategy, { symbol: cfg.pair, startTs: windowStart, endTs: windowEnd, ...COMMON });
    all.push(...r.trades);
  }
  return all;
}

function fmt(r: AggResult): string {
  return `n=${String(r.n).padStart(3)} WR=${r.wr.toFixed(1).padStart(5)}% PF=${r.pf.toFixed(2).padStart(5)} ret=${r.ret.toFixed(2).padStart(6)}% DD=${r.dd.toFixed(2).padStart(5)}%`;
}

// ---------- Main ----------

async function main() {
  const now = Date.now();
  const day = 24 * 3600_000;
  const month = 30 * day;

  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('  V5 + CG-CONFLUENCE FILTERS — walk-forward (3 windows, 6mo train / 2mo test)');
  console.log(`  Run: ${new Date(now).toISOString()}`);
  console.log('═════════════════════════════════════════════════════════════════════════════\n');

  // Pre-load all confluence data once for full year (covers all 3 windows)
  console.log('Preloading taker + liq history per pair...');
  const dataByPair: Record<string, Map<number, any>> = {};
  for (const cfg of PORTFOLIO) {
    dataByPair[cfg.pair] = await preloadConfluence(cfg.pair, now - 13 * month, now);
    console.log(`  ${cfg.pair}: ${dataByPair[cfg.pair].size} bars`);
  }
  console.log('');

  // Variants
  const variants: Variant[] = [
    { label: 'baseline',           build: (_p, cfg) => cfg.build(BASE) },
    { label: 'F1 takerDelta@0.20', build: (_p, cfg, d) => wrap(cfg.build(BASE), 'taker0.20', d, takerDeltaFilter(0.20)) },
    { label: 'F1 takerDelta@0.30', build: (_p, cfg, d) => wrap(cfg.build(BASE), 'taker0.30', d, takerDeltaFilter(0.30)) },
    { label: 'F1 takerDelta@0.40', build: (_p, cfg, d) => wrap(cfg.build(BASE), 'taker0.40', d, takerDeltaFilter(0.40)) },
    { label: 'F2 liqCascade@0.50', build: (_p, cfg, d) => wrap(cfg.build(BASE), 'liq0.50', d, liqCascadeFilter(0.50)) },
    { label: 'F2 liqCascade@0.70', build: (_p, cfg, d) => wrap(cfg.build(BASE), 'liq0.70', d, liqCascadeFilter(0.70)) },
    { label: 'F2 liqCascade@0.85', build: (_p, cfg, d) => wrap(cfg.build(BASE), 'liq0.85', d, liqCascadeFilter(0.85)) },
  ];

  const windows = [
    { name: 'W1', testStart: now - 6 * month, testEnd: now - 4 * month },
    { name: 'W2', testStart: now - 5 * month, testEnd: now - 3 * month },
    { name: 'W3', testStart: now - 4 * month, testEnd: now - 2 * month },
  ];

  // Results: variant × window × test
  const results: Record<string, { perWindow: AggResult[]; }> = {};

  for (const variant of variants) {
    console.log(`--- ${variant.label} ---`);
    results[variant.label] = { perWindow: [] };
    for (const w of windows) {
      const trades = await runVariant(variant, w.testStart, w.testEnd, dataByPair);
      const r = aggregate(trades);
      results[variant.label].perWindow.push(r);
      console.log(`   ${w.name} TEST: ${fmt(r)}`);
    }
    console.log('');
  }

  // Summary
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY: TEST window returns');
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('Variant                  | W1 ret  | W2 ret  | W3 ret  | Mean   | Δ vs base');
  const baseRets = results['baseline'].perWindow.map(r => r.ret);
  const baseMean = baseRets.reduce((s, x) => s + x, 0) / baseRets.length;
  for (const variant of variants) {
    const rets = results[variant.label].perWindow.map(r => r.ret);
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const delta = mean - baseMean;
    const marker = variant.label === 'baseline' ? '←base' : (delta >= 3 && rets.every(r => r > 0)) ? '✓ WIN' : (delta < -1) ? '✗ LOSE' : '· mixed';
    console.log(`  ${variant.label.padEnd(25)}| ${rets[0].toFixed(2).padStart(6)}% | ${rets[1].toFixed(2).padStart(6)}% | ${rets[2].toFixed(2).padStart(6)}% | ${mean.toFixed(2).padStart(5)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp ${marker}`);
  }

  console.log('\nVerdict criteria:');
  console.log('  ✓ WIN  = mean +3pp over baseline AND all 3 windows positive');
  console.log('  ✗ LOSE = mean ≤ -1pp under baseline');
  console.log('  · mixed = no clear edge');

  console.log('\nBot in production untouched.\n');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
