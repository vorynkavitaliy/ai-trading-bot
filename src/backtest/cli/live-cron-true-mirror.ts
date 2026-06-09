/**
 * LIVE-CRON-TRUE-MIRROR — true portfolio simulation (shared risk-state) + cronRealistic.
 *
 * Объединяет:
 *   - portfolio-true.ts (cross-pair shared cap-6, heat-cap, kill switches)
 *   - cronRealistic mode (entry на HH:00 после funding window, CG read на nowTs)
 *
 * Самая близкая аппроксимация к live execution.
 *
 * Usage: npx tsx src/backtest/cli/live-cron-true-mirror.ts [days=5]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

// ─── SINGLE SOURCE OF TRUTH ──────────────────────────────────────────────────
// Universe + per-pair strategy + risk come from runtime/pair-strategies.ts — the
// EXACT same TIER1_PORTFOLIO that live scan-decide uses (tier1Pairs/getStrategyForPair).
// Disabling a pair there (enabled:false) drops it from BOTH live and this mirror at
// once — no duplicated list to drift. (2026-06-03: ETH+HYPE disabled there → 8 here.)
//
// Env DEFAULTS below mirror the CURRENT live risk config, so a bare
// `npx tsx live-cron-true-mirror.ts <days>` reproduces live with zero flags:
//   cap 6 · 3 entries/12h · cooldown-on-commit · flatten −4.3 (kills off in tandem) ·
//   risk 0.5%/slot. Override for research: CAP= ENTRYCAP= SLIP= COOLDOWN_COMMIT=0
//   FLATTEN_DD=off KEEP_KILLS=1 GUARD_DD= DROP= SKIP=.
const LIVE_MAX_PARALLEL = parseInt(process.env.CAP ?? '6', 10);
const LIVE_MAX_ENTRIES_PER_WINDOW = parseInt(process.env.ENTRYCAP ?? '3', 10);
const LIVE_ENTRY_CAP_WINDOW_MS = 12 * 3600_000;
const COOLDOWN_ON_COMMIT = process.env.COOLDOWN_COMMIT !== '0';   // default ON (matches live)
const flatEnv = process.env.FLATTEN_DD;
const FLATTEN_PCT: number | undefined =
  flatEnv === undefined ? -4.3                                    // default ARMED (matches live daemon)
  : (flatEnv === 'off' || flatEnv === '') ? undefined             // FLATTEN_DD=off disables
  : parseFloat(flatEnv);

const COMMON = {
  startEquity: 668_000,
  slippagePct: parseFloat(process.env.SLIP ?? '0.25'),
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
  riskPctBase: LIVE_RISK_PCT,
  cronRealistic: true,
};

interface LivePair { symbol: string; family: string; strategy: Strategy; }

// Cosmetic family labels for the per-pair printout only — behavior comes from the
// strategy instances in pair-strategies.ts.
const FAMILY: Record<string, string> = {
  SOLUSDT: 'S4', INJUSDT: 'S2', ATOMUSDT: 'S3', ARBUSDT: 'S3', XRPUSDT: 'S4',
  LTCUSDT: 'S2', HYPEUSDT: 'S4', ETHUSDT: 'S1', BNBUSDT: 'S3', TAOUSDT: 'S1',
};

// INCLUDE=ETHUSDT,HYPEUSDT force-adds enabled:false pairs for RESEARCH only — does
// NOT touch live (live universe = whatever TIER1_PORTFOLIO has enabled). Lets you
// backtest a dropped pair in the real 8-pair portfolio context without re-arming it.
const includeSet = new Set((process.env.INCLUDE ?? '').split(',').map(s => s.trim()).filter(Boolean));
const LIVE_PAIRS: LivePair[] = TIER1_PORTFOLIO
  .filter(c => c.enabled || includeSet.has(c.pair))
  .map(c => ({ symbol: c.pair, family: FAMILY[c.pair] ?? '?', strategy: c.strategy }));

function aggregate(trades: ClosedTrade[], label: string, startEquity: number, riskPct: number) {
  const fixedRiskUsd = startEquity * (riskPct / 100);
  let equity = startEquity, peak = equity, maxDD = 0;
  let wins = 0, losses = 0, sumR = 0;
  const monthly: Record<string, number> = {};
  const sortedByExit = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  for (const t of sortedByExit) {
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
  const ret = (equity - startEquity) / startEquity * 100;
  console.log(`${label}: n=${total} WR=${(wins/Math.max(1,total)*100).toFixed(1)}% PF=${(winR/Math.max(0.01,lossR)).toFixed(2)} sumR=${sumR.toFixed(2)} return=${ret.toFixed(2)}%  MaxDD=${maxDD.toFixed(2)}%`);
  return { ret, maxDD, monthly };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '5');
  // Default the mirror to the DEPLOYED LIVE config (Lever 1: hourly cron + 4H-close
  // anchor for price+CG, NO +1h entry defer) so a bare `... <days>` run == what live
  // actually does (~+46%/yr, validated both OOS halves). For the 4H-cadence/+1h-defer
  // research variant (the +62.8% Lever-2 backtest) run with DECISION_CADENCE=240m.
  if (process.env.DECISION_CADENCE === undefined) process.env.DECISION_CADENCE = '60m';
  if (process.env.ANCHOR_4H === undefined) process.env.ANCHOR_4H = '1';
  // SKIP=N ends the window N days before now (for TRAIN/TEST split, no look-ahead:
  // both halves are historical). e.g. days=183 SKIP=182 = older half; SKIP=0 = recent.
  const skipDays = parseFloat(process.env.SKIP ?? '0');
  const now = Date.now();
  const endTs = now - skipDays * 24 * 3600_000;
  const startTs = endTs - days * 24 * 3600_000;

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`  LIVE-CRON-TRUE-MIRROR — shared risk-state + cronRealistic + CG-fix`);
  console.log(`  ${LIVE_PAIRS.length} pairs | risk ${LIVE_RISK_PCT}% | cap ${LIVE_MAX_PARALLEL} | startEq $${COMMON.startEquity.toLocaleString()}`);
  console.log(`  slip ${COMMON.slippagePct}% | period ${days}d | decisions ${process.env.DECISION_CADENCE === '60m' ? '1H (live-mirror)' : '4H'}`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // DROP="ETHUSDT,HYPEUSDT,LTCUSDT" excludes pairs (universe-pruning experiments).
  const dropSet = new Set((process.env.DROP ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const activePairs = LIVE_PAIRS.filter(p => !dropSet.has(p.symbol));
  if (includeSet.size) console.log(`  (RESEARCH: force-included disabled pairs: ${[...includeSet].join(', ')})`);
  if (dropSet.size) console.log(`  (dropped: ${[...dropSet].join(', ')} → ${activePairs.length} pairs)`);
  const symbolStrats: PortfolioSymbolStrategy[] = activePairs.map((p, i) => ({
    symbol: p.symbol, strategy: p.strategy, priority: i,
  }));

  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(symbolStrats, {
    ...COMMON, startTs, endTs,
    maxParallelCap: LIVE_MAX_PARALLEL,
    maxEntriesPerWindow: LIVE_MAX_ENTRIES_PER_WINDOW,
    entryCapWindowMs: LIVE_ENTRY_CAP_WINDOW_MS,
    cooldownOnCommit: COOLDOWN_ON_COMMIT,
    intradayDdGuardPct: process.env.GUARD_DD ? parseFloat(process.env.GUARD_DD) : undefined,
    dailyDdFlattenPct: FLATTEN_PCT,
  });

  console.log('=== AGGREGATE ===');
  const agg = aggregate(r.trades, 'FULL ', COMMON.startEquity, LIVE_RISK_PCT);

  // DUMP=1 → per-trade list for backtest-vs-live compare. JSON to be shape-agnostic.
  if (process.env.DUMP === '1') {
    console.log('\n=== TRADES (backtest) ===');
    for (const t of [...r.trades].sort((a: any, b: any) => (a.entryTs ?? 0) - (b.entryTs ?? 0))) {
      const tt = t as any;
      console.log(`  ${tt.symbol} ${tt.side} entryTs=${tt.entryTs ? new Date(tt.entryTs).toISOString().slice(0, 16) : '?'} ` +
        `exitTs=${tt.exitTs ? new Date(tt.exitTs).toISOString().slice(0, 16) : '?'} ` +
        `entry=${tt.entryPrice ?? tt.entry ?? '?'} exit=${tt.exitPrice ?? tt.exit ?? '?'} ` +
        `reason=${tt.exitReason ?? tt.reason ?? '?'} R=${(tt.pnlR ?? 0).toFixed(2)}`);
      console.log(`    raw: ${JSON.stringify(tt)}`);
    }
  }

  // DAILY=1 → per-day realized breakdown (grouped by trade EXIT date). Days with no
  // closed trade are shown as flat so the calendar is continuous.
  if (process.env.DAILY === '1') {
    const fixedRiskUsd = COMMON.startEquity * (LIVE_RISK_PCT / 100);
    const byDay = new Map<string, { r: number; n: number }>();
    for (const t of r.trades) {
      const d = new Date(t.exitTs).toISOString().slice(0, 10);
      const e = byDay.get(d) ?? { r: 0, n: 0 };
      e.r += t.pnlR; e.n += 1;
      byDay.set(d, e);
    }
    // Continuous calendar from startTs..endTs
    const days: string[] = [];
    for (let t = Math.floor(startTs / 86_400_000) * 86_400_000; t <= endTs; t += 86_400_000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    console.log('\n=== DAILY (by trade exit date) ===');
    console.log('date          trades    dayR     dayP&L$     cumP&L$    cum%');
    let cum = 0;
    for (const d of days) {
      const e = byDay.get(d);
      const dr = e?.r ?? 0;
      const pnl = dr * fixedRiskUsd;
      cum += pnl;
      const mark = e && Math.abs(dr) > 0.001 ? '' : '  ·';
      console.log(
        `  ${d}   ${String(e?.n ?? 0).padStart(3)}    ${dr.toFixed(2).padStart(7)}   ${pnl.toFixed(0).padStart(9)}   ${cum.toFixed(0).padStart(9)}   ${(cum / COMMON.startEquity * 100).toFixed(2).padStart(6)}%${mark}`,
      );
    }
  }

  const dd = r.dailyDd;
  console.log(`=== INTRADAY DAILY-DD (MTM, Hyro-faithful) ===`);
  console.log(`  worst day −DD: ${dd.worstDailyDdPct}% @ ${dd.worstDay}  |  days breaching: −5%(Hyro)=${dd.daysBreach5}  −4%=${dd.daysBreach4}  −2.5%=${dd.daysBreach25}`);
  console.log(`  [EQUITY/MTM basis] worst ${dd.worstDailyDdPct}% @ ${dd.worstDay}  −5%=${dd.daysBreach5}  −4%=${dd.daysBreach4}`);
  console.log(`  [BALANCE basis  ] worst ${dd.balWorstDailyDdPct}% @ ${dd.balWorstDay}  −5%=${dd.balDaysBreach5}  −4%=${dd.balDaysBreach4}`);
  console.log(`  HYRO survival (MTM): ${dd.daysBreach5 === 0 ? 'OK' : `⚠ ${dd.daysBreach5} breach`} | (BALANCE): ${dd.balDaysBreach5 === 0 ? 'OK' : `⚠ ${dd.balDaysBreach5} breach`}`);
  if (process.env.GUARD_DD) console.log(`  DDD-GUARD (${process.env.GUARD_DD}%): blocked entries on ${r.guard.blockedDays} day(s), ${r.guard.blockedEvents} signal(s)`);
  if (FLATTEN_PCT != null) console.log(`  DDD-FLATTEN (${FLATTEN_PCT}%): emergency-closed all positions on ${r.guard.flattenDays} day(s)`);

  console.log('\n=== ENGINE COMPOUND ===');
  console.log(`  startEq $${r.startEquity.toFixed(0)} → endEq $${r.endEquity.toFixed(0)}  (${((r.endEquity - r.startEquity) / r.startEquity * 100).toFixed(2)}%)`);

  console.log('\n=== PER-PAIR ===');
  const perPair: Record<string, ClosedTrade[]> = {};
  for (const p of LIVE_PAIRS) perPair[p.symbol] = [];
  for (const t of r.trades) (perPair[t.symbol] ?? (perPair[t.symbol] = [])).push(t);
  const sorted = [...LIVE_PAIRS].sort((a, b) => {
    const sa = (perPair[a.symbol] ?? []).reduce((s, t) => s + t.pnlR, 0);
    const sb = (perPair[b.symbol] ?? []).reduce((s, t) => s + t.pnlR, 0);
    return sb - sa;
  });
  for (const p of sorted) {
    const t = perPair[p.symbol] ?? [];
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const losses = t.filter(x => x.pnlR < -0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : 0;
    console.log(`  ${p.family} ${p.symbol.padEnd(9)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,wins+losses)*100).toFixed(1).padStart(5)}% PF=${pf.toFixed(2).padStart(5)} sumR=${sumR.toFixed(2).padStart(7)}`);
  }

  console.log('\n=== DECISION STATS ===');
  for (const p of LIVE_PAIRS) {
    const s = r.decisionStats[p.symbol];
    if (s && s.candidates > 0) console.log(`  ${p.symbol.padEnd(10)} candidates=${s.candidates} opened=${s.opened} blocked=${s.blocked}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
