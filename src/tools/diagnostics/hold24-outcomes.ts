/**
 * Base rate: backtest trades that survive past 24h (6 × 4H bars) without a take.
 *
 * Runs the EXACT live universe (TIER1_PORTFOLIO, enabled pairs) through the honest
 * engine, then bins ClosedTrade by hold time (exitTs − entryTs). For the ≥24h cohort
 * it prints the exitReason distribution + mean/median pnlR — overall, shorts-only,
 * and per pair — to answer "hold to forced exit at 48h vs close at the 24h red-flag".
 *
 * Usage: npx tsx src/tools/diagnostics/hold24-outcomes.ts [days=365]
 */
import { runBacktest } from '../../backtest/engine';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { ClosedTrade } from '../../backtest/types';
import { BACKTEST_COMMON } from '../../backtest/defaults';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const HOUR_MS = 3600_000;
const COHORT_HOURS = 24;

const COMMON = {
  ...BACKTEST_COMMON,
  startEquity: 200_000,
  riskPctBase: LIVE_RISK_PCT,
  leverage: 10,
  decisionTf: '240m' as const,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

function holdHours(t: ClosedTrade): number {
  return (t.exitTs - t.entryTs) / HOUR_MS;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : 'n/a';
}

function summarize(label: string, trades: ClosedTrade[], denomForShare?: number) {
  const rs = trades.map(t => t.pnlR);
  const wins = rs.filter(r => r > 0).length;
  const share = denomForShare ? ` (${(trades.length / denomForShare * 100).toFixed(1)}% of ${denomForShare})` : '';
  console.log(`\n--- ${label}: n=${trades.length}${share} ---`);
  if (trades.length === 0) return;
  console.log(`  meanR=${fmt(mean(rs))}  medianR=${fmt(median(rs))}  sumR=${fmt(rs.reduce((a, b) => a + b, 0), 2)}  WR(pnlR>0)=${(wins / trades.length * 100).toFixed(1)}%`);
  const byReason = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const arr = byReason.get(t.exitReason) ?? [];
    arr.push(t);
    byReason.set(t.exitReason, arr);
  }
  for (const [reason, arr] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const rr = arr.map(t => t.pnlR);
    console.log(`    ${reason.padEnd(15)} n=${String(arr.length).padStart(3)} (${(arr.length / trades.length * 100).toFixed(1).padStart(5)}%)  meanR=${fmt(mean(rr)).padStart(7)}  medianR=${fmt(median(rr)).padStart(7)}`);
  }
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * HOUR_MS;

  const active = TIER1_PORTFOLIO.filter(c => c.enabled);
  console.log(`hold24-outcomes — live config (${active.map(c => c.pair).join(', ')}), ${days}d, cohort = hold >= ${COHORT_HOURS}h`);

  const all: ClosedTrade[] = [];
  for (const cfg of active) {
    log.info(`backtest ${cfg.pair}`);
    resetCgFadeCooldownState();
    const r = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    all.push(...r.trades);
  }

  const cohort = all.filter(t => holdHours(t) >= COHORT_HOURS);
  const under = all.filter(t => holdHours(t) < COHORT_HOURS);

  console.log(`\n=== ALL TRADES (pre-kill, raw engine output): n=${all.length} ===`);
  summarize(`UNDER 24h (exited before 24h)`, under, all.length);
  summarize(`COHORT >= 24h (survived to 24h without take)`, cohort, all.length);
  summarize(`COHORT >= 24h, SHORT only`, cohort.filter(t => t.side === 'short'));
  summarize(`COHORT >= 24h, LONG only`, cohort.filter(t => t.side === 'long'));
  summarize(`COHORT subset: exited in 24-48h window`, cohort.filter(t => holdHours(t) < 48), cohort.length);
  summarize(`COHORT subset: still open past 48h (engine has no time_stop)`, cohort.filter(t => holdHours(t) >= 48), cohort.length);
  summarize(`COHORT SHORT subset: exited in 24-48h`, cohort.filter(t => t.side === 'short' && holdHours(t) < 48));
  summarize(`COHORT SHORT subset: past 48h`, cohort.filter(t => t.side === 'short' && holdHours(t) >= 48));

  console.log(`\n=== COHORT >= 24h PER PAIR ===`);
  for (const cfg of active) {
    const pairAll = all.filter(t => t.symbol === cfg.pair);
    summarize(`${cfg.pair} cohort`, cohort.filter(t => t.symbol === cfg.pair), pairAll.length);
    summarize(`${cfg.pair} cohort SHORT`, cohort.filter(t => t.symbol === cfg.pair && t.side === 'short'));
  }

  console.log(`\n=== COHORT HOLD-TIME HISTOGRAM (4h buckets) ===`);
  const buckets = new Map<number, ClosedTrade[]>();
  for (const t of cohort) {
    const b = Math.floor(holdHours(t) / 4) * 4;
    const arr = buckets.get(b) ?? [];
    arr.push(t);
    buckets.set(b, arr);
  }
  for (const [b, arr] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) {
    const rr = arr.map(t => t.pnlR);
    console.log(`  ${String(b).padStart(2)}-${b + 4}h: n=${String(arr.length).padStart(3)}  meanR=${fmt(mean(rr)).padStart(7)}  medianR=${fmt(median(rr)).padStart(7)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
