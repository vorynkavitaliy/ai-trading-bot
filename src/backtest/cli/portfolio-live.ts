/**
 * BOEVOY (production) backtest — runs the EXACT live universe + per-pair strategy
 * config imported directly from src/runtime/pair-strategies.ts (TIER1_PORTFOLIO).
 *
 * Unlike portfolio-v5-final.ts (a frozen research snapshot with stale spacing 0.6),
 * this ALWAYS mirrors what the cron bot actually trades — single source of truth.
 *
 * Honest engine + post-hoc portfolio kill switches + fixed-risk sizing.
 *
 * Usage: npx tsx src/backtest/cli/portfolio-live.ts [days=365]
 */
import { runBacktest } from '../engine';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { BACKTEST_COMMON } from '../defaults';

const MAX_CONCURRENT_POSITIONS = 6;  // live risk-guard cap

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  slippagePct: 0.05,
  riskPctBase: LIVE_RISK_PCT,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

function applyPortfolioKills(trades: ClosedTrade[], startEquity: number, riskPct: number): { keep: ClosedTrade[]; dropped: number } {
  if (trades.length === 0) return { keep: [], dropped: 0 };
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
      else if (openCount >= MAX_CONCURRENT_POSITIONS) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) { equity += ev.trade.pnlR * (startEquity * riskPct / 100); openCount--; }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)), dropped: dropped.size };
}

function aggregate(trades: ClosedTrade[], label: string) {
  const { keep, dropped } = applyPortfolioKills(trades, COMMON.startEquity, COMMON.riskPctBase);
  if (dropped > 0) console.log(`  (${label} portfolio kills dropped ${dropped}/${trades.length})`);
  trades = keep;
  const fixedRiskUsd = COMMON.startEquity * (COMMON.riskPctBase / 100);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  const monthly: Record<string, number> = {};
  for (const t of trades) {
    const pnlUsd = t.pnlR * fixedRiskUsd;
    equity += pnlUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
    const m = new Date(t.entryTs).toISOString().slice(0, 7);
    monthly[m] = (monthly[m] ?? 0) + pnlUsd;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const ret = (equity - COMMON.startEquity) / COMMON.startEquity * 100;
  console.log(`${label}: n=${total} WR=${(wins/Math.max(1,total)*100).toFixed(1)}% PF=${(winR/Math.max(0.01,lossR)).toFixed(2)} sumR=${sumR.toFixed(2)} return=${ret.toFixed(2)}% MaxDD=${maxDD.toFixed(2)}%`);
  return { equity, monthly, ret, maxDD };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  const active = TIER1_PORTFOLIO.filter(c => c.enabled);
  console.log(`\n═══════════════════════════════════════════════════════════════════════`);
  console.log(`  PORTFOLIO LIVE CONFIG — ${active.length} pairs, ${days}d honest engine`);
  console.log(`  riskPct=${LIVE_RISK_PCT}% cap=${MAX_CONCURRENT_POSITIONS} | source: pair-strategies.ts`);
  console.log(`  Pairs: ${active.map(c => c.pair).join(', ')}`);
  console.log(`═══════════════════════════════════════════════════════════════════════\n`);

  const fullTrades: ClosedTrade[] = [];
  const trainTrades: ClosedTrade[] = [];
  const testTrades: ClosedTrade[] = [];
  const perPair: Record<string, ClosedTrade[]> = {};

  for (const cfg of active) {
    log.info(`backtest ${cfg.pair}`);
    resetCgFadeCooldownState();
    const rFull = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    resetCgFadeCooldownState();
    const rTrain = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: splitTs, ...COMMON });
    resetCgFadeCooldownState();
    const rTest = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs: splitTs, endTs: now, ...COMMON });
    fullTrades.push(...rFull.trades);
    trainTrades.push(...rTrain.trades);
    testTrades.push(...rTest.trades);
    perPair[cfg.pair] = rFull.trades;
  }

  console.log('\n=== AGGREGATE (portfolio kills + fixed sizing) ===');
  const fullAgg = aggregate(fullTrades, 'FULL ');
  aggregate(trainTrades, 'TRAIN');
  aggregate(testTrades,  'TEST ');

  console.log('\n=== PER-PAIR (full window, pre-kill) ===');
  const sorted = [...active].sort((a, b) => {
    const sa = perPair[a.pair].reduce((s, t) => s + t.pnlR, 0);
    const sb = perPair[b.pair].reduce((s, t) => s + t.pnlR, 0);
    return sb - sa;
  });
  for (const cfg of sorted) {
    const t = perPair[cfg.pair];
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const losses = t.filter(x => x.pnlR < -0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : 0;
    console.log(`  ${cfg.pair.padEnd(9)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,wins+losses)*100).toFixed(1).padStart(5)}% PF=${pf.toFixed(2).padStart(5)} sumR=${sumR.toFixed(2).padStart(7)}`);
  }

  console.log('\n=== MONTHLY (FULL) ===');
  const months = Object.keys(fullAgg.monthly).sort();
  let runEq = COMMON.startEquity;
  let posMonths = 0;
  for (const m of months) {
    const pnl = fullAgg.monthly[m];
    runEq += pnl;
    if (pnl > 0) posMonths++;
    const pct = pnl / (runEq - pnl) * 100;
    const sign = pnl >= 0 ? '+' : '';
    console.log(`  ${m}: ${sign}${pnl.toFixed(0).padStart(7)} (${pct.toFixed(2).padStart(6)}%) → equity ${runEq.toFixed(0)}`);
  }
  console.log(`  Positive months: ${posMonths}/${months.length}`);

  // Annualized projection
  const annualRet = fullAgg.ret * (365 / days);
  console.log(`\n=== HEADLINE ===`);
  console.log(`  FULL ${days}d return: ${fullAgg.ret.toFixed(2)}%  (annualized ~${annualRet.toFixed(1)}%)  MaxDD ${fullAgg.maxDD.toFixed(2)}%`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
