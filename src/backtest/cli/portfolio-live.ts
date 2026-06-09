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

const CAP_OVERRIDE = process.argv[4] != null ? parseInt(process.argv[4], 10) : null;
const MAX_CONCURRENT_POSITIONS = CAP_OVERRIDE ?? 6;  // live risk-guard cap (overridable for sweeps)

const RISK_PCT_OVERRIDE = process.argv[3] != null ? parseFloat(process.argv[3]) : null;
const EFFECTIVE_RISK_PCT = RISK_PCT_OVERRIDE ?? LIVE_RISK_PCT;

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  riskPctBase: EFFECTIVE_RISK_PCT,
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

// Per-trade maximum intra-day swing — assumes MFE→MAE on the same day. This is
// the Hyro-faithful upper bound on a single trade's contribution to one-day DDD.
// trades-overlap-day finds the worst day by summing each trade's full swing on
// the day where its MAE occurs (worst-case alignment).
function computeHyroBoundDdd(trades: ClosedTrade[], startEquity: number, riskUsd: number): { worstDayDd: number; worstDayDate: string; perTradeMaxSwingUsd: number; perTradeAvgSwingUsd: number } {
  if (trades.length === 0) return { worstDayDd: 0, worstDayDate: '', perTradeMaxSwingUsd: 0, perTradeAvgSwingUsd: 0 };
  let perTradeMaxSwing = 0;
  let perTradeSumSwing = 0;
  const dayContribUsd = new Map<string, number>();
  for (const t of trades) {
    const mfeR = t.mfeR ?? Math.max(0, t.pnlR);
    const maeR = t.maeR ?? Math.min(0, t.pnlR);
    const swingR = mfeR - maeR;
    const swingUsd = swingR * riskUsd;
    if (swingUsd > perTradeMaxSwing) perTradeMaxSwing = swingUsd;
    perTradeSumSwing += swingUsd;
    const maeDay = new Date(t.maeTs ?? t.exitTs).toISOString().slice(0, 10);
    dayContribUsd.set(maeDay, (dayContribUsd.get(maeDay) ?? 0) + swingUsd);
  }
  let worstDay = '';
  let worstUsd = 0;
  for (const [day, usd] of dayContribUsd.entries()) {
    if (usd > worstUsd) { worstUsd = usd; worstDay = day; }
  }
  return {
    worstDayDd: -worstUsd / startEquity * 100,
    worstDayDate: worstDay,
    perTradeMaxSwingUsd: perTradeMaxSwing,
    perTradeAvgSwingUsd: perTradeSumSwing / trades.length,
  };
}

// Honest MTM (mark-to-market) intraday DDD per HyroTrader formula:
//   Daily DD = today's HIGHEST equity (peak)  −  LOWEST equity AFTER that peak
// Trough resets when a new peak is set within the day. Peak resets at 00:00 UTC.
function computeHonestMtmDdd(trades: ClosedTrade[], startEquity: number, riskUsd: number): { worstDayDd: number; worstDayDate: string; maxDdPct: number } {
  if (trades.length === 0) return { worstDayDd: 0, worstDayDate: '', maxDdPct: 0 };
  type Ev = { ts: number; tradeId: number; rContribution: number; final: boolean };
  const events: Ev[] = [];
  trades.forEach((t, idx) => {
    const mfeR = t.mfeR ?? Math.max(0, t.pnlR);
    const maeR = t.maeR ?? Math.min(0, t.pnlR);
    const mfeTs = t.mfeTs ?? t.exitTs;
    const maeTs = t.maeTs ?? t.exitTs;
    events.push({ ts: t.entryTs, tradeId: idx, rContribution: 0, final: false });
    if (mfeTs <= maeTs) {
      events.push({ ts: mfeTs, tradeId: idx, rContribution: mfeR, final: false });
      events.push({ ts: maeTs, tradeId: idx, rContribution: maeR, final: false });
    } else {
      events.push({ ts: maeTs, tradeId: idx, rContribution: maeR, final: false });
      events.push({ ts: mfeTs, tradeId: idx, rContribution: mfeR, final: false });
    }
    events.push({ ts: t.exitTs, tradeId: idx, rContribution: t.pnlR, final: true });
  });
  events.sort((a, b) => a.ts !== b.ts ? a.ts - b.ts : (a.final ? 1 : -1));
  const tradeCurR = new Map<number, number>();
  const realizedR = new Map<number, number>();
  let equity = startEquity;
  let peak = startEquity;
  let maxDdPct = 0;
  let dailyKey = '';
  let dailyPeak = startEquity;
  let dailyTrough = startEquity;
  let worstDayDd = 0;
  let worstDayDate = '';
  const finalizeDay = () => {
    if (dailyKey === '') return;
    const dd = (dailyTrough - dailyPeak) / dailyPeak * 100;
    if (dd < worstDayDd) { worstDayDd = dd; worstDayDate = dailyKey; }
  };
  for (const ev of events) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    if (day !== dailyKey) {
      finalizeDay();
      dailyKey = day;
      dailyPeak = equity;
      dailyTrough = equity;
    }
    if (ev.final) {
      const before = tradeCurR.get(ev.tradeId) ?? 0;
      const finalR = ev.rContribution;
      const delta = (finalR - before) * riskUsd;
      equity += delta;
      realizedR.set(ev.tradeId, finalR);
      tradeCurR.delete(ev.tradeId);
    } else {
      const before = tradeCurR.get(ev.tradeId) ?? 0;
      const after = ev.rContribution;
      const delta = (after - before) * riskUsd;
      equity += delta;
      tradeCurR.set(ev.tradeId, after);
    }
    if (equity > peak) peak = equity;
    const ddPct = (peak - equity) / peak * 100;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
    if (equity > dailyPeak) {
      dailyPeak = equity;
      dailyTrough = equity;
    } else if (equity < dailyTrough) {
      dailyTrough = equity;
      const dd = (dailyTrough - dailyPeak) / dailyPeak * 100;
      if (dd < worstDayDd) { worstDayDd = dd; worstDayDate = dailyKey; }
    }
  }
  finalizeDay();
  return { worstDayDd, worstDayDate, maxDdPct };
}

function aggregate(trades: ClosedTrade[], label: string) {
  const { keep, dropped } = applyPortfolioKills(trades, COMMON.startEquity, COMMON.riskPctBase);
  if (dropped > 0) console.log(`  (${label} portfolio kills dropped ${dropped}/${trades.length})`);
  trades = keep;
  const fixedRiskUsd = COMMON.startEquity * (COMMON.riskPctBase / 100);
  let equity = COMMON.startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  const monthly: Record<string, number> = {};
  const sortedByExit = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  let dailyPeak = COMMON.startEquity;
  let dailyDay = new Date(sortedByExit[0]?.exitTs ?? Date.now()).toISOString().slice(0, 10);
  let worstDailyDdFromPeakPct = 0;
  let worstDailyDdDay = '';
  let dailyMin = COMMON.startEquity;
  for (const t of sortedByExit) {
    const day = new Date(t.exitTs).toISOString().slice(0, 10);
    if (day !== dailyDay) {
      const dailyDd = (dailyMin - dailyPeak) / dailyPeak * 100;
      if (dailyDd < worstDailyDdFromPeakPct) { worstDailyDdFromPeakPct = dailyDd; worstDailyDdDay = dailyDay; }
      dailyDay = day;
      dailyPeak = equity;
      dailyMin = equity;
    }
    const pnlUsd = t.pnlR * fixedRiskUsd;
    equity += pnlUsd;
    if (equity > peak) peak = equity;
    if (equity > dailyPeak) dailyPeak = equity;
    if (equity < dailyMin) dailyMin = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += t.pnlR;
    if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
    const m = new Date(t.entryTs).toISOString().slice(0, 7);
    monthly[m] = (monthly[m] ?? 0) + pnlUsd;
  }
  {
    const dailyDd = (dailyMin - dailyPeak) / dailyPeak * 100;
    if (dailyDd < worstDailyDdFromPeakPct) { worstDailyDdFromPeakPct = dailyDd; worstDailyDdDay = dailyDay; }
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const ret = (equity - COMMON.startEquity) / COMMON.startEquity * 100;
  const mtm = computeHonestMtmDdd(trades, COMMON.startEquity, fixedRiskUsd);
  const hyro = computeHyroBoundDdd(trades, COMMON.startEquity, fixedRiskUsd);
  console.log(`${label}: n=${total} WR=${(wins/Math.max(1,total)*100).toFixed(1)}% PF=${(winR/Math.max(0.01,lossR)).toFixed(2)} sumR=${sumR.toFixed(2)} return=${ret.toFixed(2)}%`);
  console.log(`       close-only:  MaxDD=${maxDD.toFixed(2)}%  worstDailyDDD=${worstDailyDdFromPeakPct.toFixed(2)}%@${worstDailyDdDay}`);
  console.log(`       per-trade swing: max=$${hyro.perTradeMaxSwingUsd.toFixed(0)}  avg=$${hyro.perTradeAvgSwingUsd.toFixed(0)}`);
  console.log(`       HYRO Daily DD:  max peak-to-trough = ${mtm.maxDdPct.toFixed(2)}%   worst single-day = ${mtm.worstDayDd.toFixed(2)}% @ ${mtm.worstDayDate}`);
  return { equity, monthly, ret, maxDD, worstDailyDdFromPeakPct, worstDailyDdDay, mtm, hyro };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  const active = TIER1_PORTFOLIO.filter(c => c.enabled);
  console.log(`\n═══════════════════════════════════════════════════════════════════════`);
  console.log(`  PORTFOLIO LIVE CONFIG — ${active.length} pairs, ${days}d honest engine`);
  console.log(`  riskPct=${EFFECTIVE_RISK_PCT}%${RISK_PCT_OVERRIDE != null ? ` (OVERRIDE, source code = ${LIVE_RISK_PCT}%)` : ''} cap=${MAX_CONCURRENT_POSITIONS} | source: pair-strategies.ts`);
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
