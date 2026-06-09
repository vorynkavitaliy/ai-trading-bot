/**
 * TRUE portfolio backtest CLI — uses runPortfolioBacktest (engine-portfolio.ts)
 * to simulate ALL pairs in ONE shared risk-state.
 *
 * Difference from portfolio-live.ts:
 *   - That CLI runs each pair through `runBacktest` ISOLATED and applies
 *     portfolio kills POST-HOC. Cross-pair heat-cap and trailing-peak DDD kill
 *     switches don't influence the per-pair sim — they only drop already-
 *     simulated trades after the fact.
 *   - THIS CLI runs all pairs in a single engine call. Shared risk-state means
 *     heat-cap, DDD kills, and the parallel cap GATE entries DURING simulation.
 *     Per-pair P&L emerges from the joint walk.
 *
 * Equity-curve handling:
 *   - Engine compounds equity (risk-per-trade scales with live portfolio
 *     equity).
 *   - "AGGREGATE" report uses FIXED-risk sizing on trades emitted by the
 *     engine — apples-to-apples with portfolio-live.ts for direct comparison.
 *   - "ENGINE COMPOUND" report uses the engine's true compounding result.
 *
 * Usage: npx tsx src/backtest/cli/portfolio-true.ts [days=365] [riskPct] [cap]
 *        [--include-paused]
 */
import {
  runPortfolioBacktest,
  PortfolioSymbolStrategy,
} from '../engine-portfolio';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { BACKTEST_COMMON } from '../defaults';

function parseFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const INCLUDE_PAUSED = parseFlag('--include-paused');
const NO_COOLDOWN = parseFlag('--no-cooldown');
const COOLDOWN_OVERRIDE_ARG = process.argv.find(a => a.startsWith('--cooldown='));
const COOLDOWN_OVERRIDE_HOURS = COOLDOWN_OVERRIDE_ARG != null ? parseFloat(COOLDOWN_OVERRIDE_ARG.split('=')[1]) : null;

function parseNumericArg(pos: number): number | null {
  // Skip the flag args when counting positional ones.
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const v = positional[pos];
  return v != null ? parseFloat(v) : null;
}

const DAYS = parseNumericArg(0) ?? 365;
const RISK_PCT_OVERRIDE = parseNumericArg(1);
const CAP_OVERRIDE = parseNumericArg(2);

const EFFECTIVE_RISK_PCT = RISK_PCT_OVERRIDE ?? LIVE_RISK_PCT;
const MAX_CONCURRENT_POSITIONS = CAP_OVERRIDE != null ? Math.round(CAP_OVERRIDE) : 6;

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  riskPctBase: EFFECTIVE_RISK_PCT,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

// ─── Hyro-bound DDD: max single-day swing assuming MFE→MAE on same day ────
function computeHyroBoundDdd(trades: ClosedTrade[], startEquity: number, riskUsd: number) {
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

// ─── Honest MTM intraday DDD per Hyro formula ─────────────────────────────
function computeHonestMtmDdd(trades: ClosedTrade[], startEquity: number, riskUsd: number) {
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
  const days = DAYS;
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  // Filter pairs: skip enabled:false unless --include-paused
  const active = TIER1_PORTFOLIO.filter(c => INCLUDE_PAUSED || c.enabled);
  if (NO_COOLDOWN) {
    for (const cfg of active) (cfg.strategy as any).p.cooldownHours = 0;
  } else if (COOLDOWN_OVERRIDE_HOURS != null) {
    for (const cfg of active) (cfg.strategy as any).p.cooldownHours = COOLDOWN_OVERRIDE_HOURS;
  }
  const cdLabel = NO_COOLDOWN ? '0 (disabled)' : (COOLDOWN_OVERRIDE_HOURS ?? 'default (6)');
  console.log(`\n═══════════════════════════════════════════════════════════════════════`);
  console.log(`  PORTFOLIO TRUE-SIM — ${active.length} pairs, ${days}d shared risk-state`);
  console.log(`  riskPct=${EFFECTIVE_RISK_PCT}%${RISK_PCT_OVERRIDE != null ? ` (OVERRIDE, source = ${LIVE_RISK_PCT}%)` : ''} cap=${MAX_CONCURRENT_POSITIONS} | include-paused=${INCLUDE_PAUSED} | strat-cooldown=${cdLabel}h`);
  console.log(`  Pairs: ${active.map(c => `${c.pair}${c.enabled ? '' : '⏸'}`).join(', ')}`);
  console.log(`═══════════════════════════════════════════════════════════════════════\n`);

  const buildSymbolStrategies = (): PortfolioSymbolStrategy[] => active.map((cfg, i) => ({
    symbol: cfg.pair,
    strategy: cfg.strategy,
    priority: i,  // operator-set priority via TIER1_PORTFOLIO order
  }));

  log.info('portfolio-true: running FULL window');
  resetCgFadeCooldownState();
  const rFull = await runPortfolioBacktest(buildSymbolStrategies(), {
    ...COMMON,
    startTs,
    endTs: now,
    maxParallelCap: MAX_CONCURRENT_POSITIONS,
  });

  log.info('portfolio-true: running TRAIN window');
  resetCgFadeCooldownState();
  const rTrain = await runPortfolioBacktest(buildSymbolStrategies(), {
    ...COMMON,
    startTs,
    endTs: splitTs,
    maxParallelCap: MAX_CONCURRENT_POSITIONS,
  });

  log.info('portfolio-true: running TEST window');
  resetCgFadeCooldownState();
  const rTest = await runPortfolioBacktest(buildSymbolStrategies(), {
    ...COMMON,
    startTs: splitTs,
    endTs: now,
    maxParallelCap: MAX_CONCURRENT_POSITIONS,
  });

  const fullTrades = rFull.trades;
  const trainTrades = rTrain.trades;
  const testTrades = rTest.trades;

  console.log('\n=== AGGREGATE (true sim + fixed-risk sizing, apples-to-apples vs portfolio-live) ===');
  const fullAgg = aggregate(fullTrades, 'FULL ');
  const trainAgg = aggregate(trainTrades, 'TRAIN');
  const testAgg = aggregate(testTrades,  'TEST ');

  console.log('\n=== ENGINE COMPOUND (true sim with risk scaling on live equity) ===');
  console.log(`  FULL :  startEq $${rFull.startEquity.toFixed(0)} → endEq $${rFull.endEquity.toFixed(0)}  (${((rFull.endEquity - rFull.startEquity) / rFull.startEquity * 100).toFixed(2)}%)`);
  console.log(`  TRAIN:  startEq $${rTrain.startEquity.toFixed(0)} → endEq $${rTrain.endEquity.toFixed(0)}  (${((rTrain.endEquity - rTrain.startEquity) / rTrain.startEquity * 100).toFixed(2)}%)`);
  console.log(`  TEST :  startEq $${rTest.startEquity.toFixed(0)} → endEq $${rTest.endEquity.toFixed(0)}  (${((rTest.endEquity - rTest.startEquity) / rTest.startEquity * 100).toFixed(2)}%)`);

  console.log('\n=== PER-PAIR (full window) ===');
  const perPair: Record<string, ClosedTrade[]> = {};
  for (const cfg of active) perPair[cfg.pair] = [];
  for (const t of fullTrades) {
    if (!perPair[t.symbol]) perPair[t.symbol] = [];
    perPair[t.symbol].push(t);
  }
  const sorted = [...active].sort((a, b) => {
    const sa = (perPair[a.pair] ?? []).reduce((s, t) => s + t.pnlR, 0);
    const sb = (perPair[b.pair] ?? []).reduce((s, t) => s + t.pnlR, 0);
    return sb - sa;
  });
  for (const cfg of sorted) {
    const t = perPair[cfg.pair] ?? [];
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const losses = t.filter(x => x.pnlR < -0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : 0;
    console.log(`  ${cfg.pair.padEnd(10)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,wins+losses)*100).toFixed(1).padStart(5)}% PF=${pf.toFixed(2).padStart(5)} sumR=${sumR.toFixed(2).padStart(7)}`);
  }

  console.log('\n=== DECISION STATS (candidates vs opened vs blocked-by-shared-risk-guard) ===');
  for (const cfg of active) {
    const s = rFull.decisionStats[cfg.pair];
    if (!s) continue;
    console.log(`  ${cfg.pair.padEnd(10)} candidates=${String(s.candidates).padStart(4)} opened=${String(s.opened).padStart(4)} blocked=${String(s.blocked).padStart(4)}`);
  }

  console.log('\n=== MONTHLY (FULL, fixed-risk) ===');
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

  const annualRet = fullAgg.ret * (365 / days);
  console.log(`\n=== HEADLINE ===`);
  console.log(`  FULL  ${days}d return: ${fullAgg.ret.toFixed(2)}%  (annualized ~${annualRet.toFixed(1)}%)  MaxDD ${fullAgg.maxDD.toFixed(2)}%  Hyro max peak-to-trough ${fullAgg.mtm.maxDdPct.toFixed(2)}%  worst-day ${fullAgg.mtm.worstDayDd.toFixed(2)}%`);
  console.log(`  TRAIN ${(days/2).toFixed(0)}d return: ${trainAgg.ret.toFixed(2)}%   MaxDD ${trainAgg.maxDD.toFixed(2)}%  Hyro max peak-to-trough ${trainAgg.mtm.maxDdPct.toFixed(2)}%  worst-day ${trainAgg.mtm.worstDayDd.toFixed(2)}%`);
  console.log(`  TEST  ${(days/2).toFixed(0)}d return: ${testAgg.ret.toFixed(2)}%   MaxDD ${testAgg.maxDD.toFixed(2)}%  Hyro max peak-to-trough ${testAgg.mtm.maxDdPct.toFixed(2)}%  worst-day ${testAgg.mtm.worstDayDd.toFixed(2)}%`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
