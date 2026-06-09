/**
 * RESEARCH: trailing peak DDD analysis — prop firm rule semantics.
 *
 * HyroTrader DDD: -5% from intraday PEAK equity (resets UTC midnight, but peak
 * grows with profits). Our current kill logic uses FROM-OPEN — under-counts DDD
 * by the magnitude of any intraday peak above open. Real example:
 *   open=$450k, peak=$470k, drop to $446.5k → from-open=-0.78% (we say OK),
 *   from-peak=-5.0% (Hyro KILLS account).
 *
 * Methodology:
 *   1. Run engine ONCE per pair (live config, 365d) → collect all trades.
 *   2. Apply TWO kill simulations in aggregation:
 *      A. from-OPEN (current logic, baseline)
 *      B. from-PEAK trailing (Hyro-faithful)
 *   3. Report side-by-side: return%, MaxDD, max from-peak DD experienced,
 *      kills triggered, days affected.
 *
 * Approximation: equity in event-sim updates only on EXIT events (realized).
 * Real Hyro uses mark-to-market (intra-trade unrealized counts). This metric is
 * OPTIMISTIC vs reality — real intraday peak may be higher (more underwater
 * during open positions), so real from-peak DD is harsher. If the optimistic
 * simulation already shows close to -5%, reality is worse.
 *
 * Read-only. No live code touched. Run: npx tsx src/backtest/cli/portfolio-trailing-peak-dd.ts
 */
import { runBacktest } from '../engine';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { BACKTEST_COMMON } from '../defaults';

const MAX_CONCURRENT_POSITIONS = 6;

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

// ─── Kill simulation: from-OPEN (current) ───────────────────────────────────
function applyKillsFromOpen(
  trades: ClosedTrade[],
  startEquity: number,
  riskPct: number,
  softPct: number,
  hardPct: number,
): { kept: ClosedTrade[]; killEvents: number; maxDailyDdFromOpen: number } {
  if (trades.length === 0) return { kept: [], killEvents: 0, maxDailyDdFromOpen: 0 };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  events.sort((a, b) => a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'entry' ? -1 : 1));

  const dropped = new Set<ClosedTrade>();
  let equity = startEquity;
  let dailyOpen = { day: utcDay(events[0].ts), equity: startEquity };
  let openCount = 0;
  let killEvents = 0;
  let maxDailyDdFromOpen = 0;  // most-negative dailyPnlPct seen (worst dip from open)

  for (const ev of events) {
    const day = utcDay(ev.ts);
    if (day !== dailyOpen.day) dailyOpen = { day, equity };
    if (ev.kind === 'entry') {
      const totalPct = (equity - startEquity) / startEquity * 100;
      const dailyPct = (equity - dailyOpen.equity) / dailyOpen.equity * 100;
      if (dailyPct < maxDailyDdFromOpen) maxDailyDdFromOpen = dailyPct;
      if (totalPct <= -8.0 || dailyPct <= hardPct || dailyPct <= softPct) {
        dropped.add(ev.trade); killEvents++;
      } else if (openCount >= MAX_CONCURRENT_POSITIONS) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) {
        equity += ev.trade.pnlR * (startEquity * riskPct / 100);
        openCount--;
      }
    }
  }
  return { kept: trades.filter(t => !dropped.has(t)), killEvents, maxDailyDdFromOpen };
}

// ─── Kill simulation: from-PEAK trailing (HyroTrader semantics) ─────────────
function applyKillsFromPeak(
  trades: ClosedTrade[],
  startEquity: number,
  riskPct: number,
  softPct: number,
  hardPct: number,
): { kept: ClosedTrade[]; killEvents: number; maxDdFromPeak: number; perDayPeakDd: Map<string, number> } {
  if (trades.length === 0) return { kept: [], killEvents: 0, maxDdFromPeak: 0, perDayPeakDd: new Map() };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  events.sort((a, b) => a.ts !== b.ts ? a.ts - b.ts : (a.kind === 'entry' ? -1 : 1));

  const dropped = new Set<ClosedTrade>();
  let equity = startEquity;
  let dayKey = utcDay(events[0].ts);
  let dayPeak = startEquity;
  let openCount = 0;
  let killEvents = 0;
  let maxDdFromPeak = 0;
  const perDayPeakDd = new Map<string, number>();

  for (const ev of events) {
    const day = utcDay(ev.ts);
    if (day !== dayKey) {
      // Carry forward worst from-peak DD of the day before resetting
      const ddNow = (equity - dayPeak) / dayPeak * 100;
      if (ddNow < (perDayPeakDd.get(dayKey) ?? 0)) perDayPeakDd.set(dayKey, ddNow);
      dayKey = day;
      dayPeak = equity;  // reset peak at UTC midnight
    }
    if (ev.kind === 'entry') {
      const ddFromPeak = (equity - dayPeak) / dayPeak * 100;
      if (ddFromPeak < (perDayPeakDd.get(day) ?? 0)) perDayPeakDd.set(day, ddFromPeak);
      if (ddFromPeak < maxDdFromPeak) maxDdFromPeak = ddFromPeak;
      const totalPct = (equity - startEquity) / startEquity * 100;
      if (totalPct <= -8.0 || ddFromPeak <= hardPct || ddFromPeak <= softPct) {
        dropped.add(ev.trade); killEvents++;
      } else if (openCount >= MAX_CONCURRENT_POSITIONS) dropped.add(ev.trade);
      else openCount++;
    } else {
      if (!dropped.has(ev.trade)) {
        equity += ev.trade.pnlR * (startEquity * riskPct / 100);
        if (equity > dayPeak) dayPeak = equity;  // update day peak (realized)
        openCount--;
      }
    }
  }
  // Capture last day's worst DD too
  const ddLast = (equity - dayPeak) / dayPeak * 100;
  if (ddLast < (perDayPeakDd.get(dayKey) ?? 0)) perDayPeakDd.set(dayKey, ddLast);
  return { kept: trades.filter(t => !dropped.has(t)), killEvents, maxDdFromPeak, perDayPeakDd };
}

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ─── Aggregate metrics from a set of kept trades ────────────────────────────
function aggregate(trades: ClosedTrade[], label: string) {
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
  const ret = (equity - COMMON.startEquity) / COMMON.startEquity * 100;
  const pf = lossR > 0 ? winR / lossR : 0;
  return {
    label, n: total, wr: total > 0 ? wins / total * 100 : 0,
    pf, sumR, ret, maxDD, finalEquity: equity,
  };
}

function fmt(r: any): string {
  return `n=${String(r.n).padStart(3)} WR=${r.wr.toFixed(1).padStart(5)}% PF=${r.pf.toFixed(2)} sumR=${r.sumR.toFixed(2).padStart(6)} ret=${r.ret.toFixed(2).padStart(6)}% MaxDD=${r.maxDD.toFixed(2)}%`;
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const active = TIER1_PORTFOLIO.filter(c => c.enabled);

  console.log(`\n═════════════════════════════════════════════════════════════════════════════`);
  console.log(`  TRAILING-PEAK DDD RESEARCH — ${active.length} pairs, ${days}d`);
  console.log(`  Compares from-OPEN (current) vs from-PEAK trailing (Hyro-faithful) kill logic`);
  console.log(`  Pairs: ${active.map(c => c.pair).join(', ')}`);
  console.log(`═════════════════════════════════════════════════════════════════════════════\n`);

  // Single engine pass — collect all trades
  console.log('Running engine across all pairs (no portfolio kills applied yet)...');
  const allTrades: ClosedTrade[] = [];
  for (const cfg of active) {
    log.info(`engine ${cfg.pair}`);
    resetCgFadeCooldownState();
    const r = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    allTrades.push(...r.trades);
  }
  console.log(`Total trades from engine (pre-portfolio-kill): ${allTrades.length}\n`);

  // Apply two kill simulations
  console.log('=== KILL SIMULATIONS (same trade input, different kill logic) ===\n');

  const variants = [
    { name: 'A. NO portfolio kill (theoretical max)', kill: null as any },
    { name: 'B. from-OPEN soft=-2.5 hard=-4.0 (current)', kill: { from: 'open', soft: -2.5, hard: -4.0 } as any },
    { name: 'C. from-PEAK soft=-2.5 hard=-4.0', kill: { from: 'peak', soft: -2.5, hard: -4.0 } as any },
    { name: 'D. from-PEAK soft=-2.0 hard=-3.0 (TIGHTER)', kill: { from: 'peak', soft: -2.0, hard: -3.0 } as any },
    { name: 'E. from-PEAK soft=-1.5 hard=-2.5 (V-TIGHT)', kill: { from: 'peak', soft: -1.5, hard: -2.5 } as any },
  ];

  const results: Array<{ variant: string; agg: any; killEvents: number; maxObservedDd: number }> = [];
  for (const v of variants) {
    let kept = allTrades, killEvents = 0, maxObservedDd = 0;
    let perDayPeakDd = new Map<string, number>();
    if (v.kill) {
      if (v.kill.from === 'open') {
        const r = applyKillsFromOpen(allTrades, COMMON.startEquity, COMMON.riskPctBase, v.kill.soft, v.kill.hard);
        kept = r.kept; killEvents = r.killEvents; maxObservedDd = r.maxDailyDdFromOpen;
      } else {
        const r = applyKillsFromPeak(allTrades, COMMON.startEquity, COMMON.riskPctBase, v.kill.soft, v.kill.hard);
        kept = r.kept; killEvents = r.killEvents; maxObservedDd = r.maxDdFromPeak; perDayPeakDd = r.perDayPeakDd;
      }
    } else {
      // No kill — still compute max from-peak DD observed (informational)
      const r = applyKillsFromPeak(allTrades, COMMON.startEquity, COMMON.riskPctBase, -999, -999);
      maxObservedDd = r.maxDdFromPeak; perDayPeakDd = r.perDayPeakDd;
    }
    const agg = aggregate(kept, v.name);
    results.push({ variant: v.name, agg, killEvents, maxObservedDd });
    console.log(`${v.name}`);
    console.log(`  ${fmt(agg)}`);
    console.log(`  kills triggered: ${killEvents} entries dropped | max DD observed: ${maxObservedDd.toFixed(2)}%`);
    // For variants with per-day peak data, summarize worst days
    if (perDayPeakDd.size > 0) {
      const worstDays = [...perDayPeakDd.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5);
      console.log(`  Worst 5 days by from-peak DD: ${worstDays.map(([d, dd]) => `${d}:${dd.toFixed(2)}%`).join(', ')}`);
    }
    console.log('');
  }

  // Final comparison table
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('  COMPARISON');
  console.log('═════════════════════════════════════════════════════════════════════════════');
  console.log('Variant                              | Return%  | MaxDD% | Kills | MaxObsDd');
  for (const r of results) {
    console.log(`  ${r.variant.padEnd(36)} | ${r.agg.ret.toFixed(2).padStart(7)}% | ${r.agg.maxDD.toFixed(2).padStart(5)}% | ${String(r.killEvents).padStart(5)} | ${r.maxObservedDd.toFixed(2)}%`);
  }
  console.log('\nKey question: in variant A (no kill), what was the WORST from-peak DD experienced?');
  console.log(`  → ${results[0].maxObservedDd.toFixed(2)}%  (vs HyroTrader limit -5%)`);
  if (results[0].maxObservedDd <= -5.0) {
    console.log(`  ❌ EXCEEDS Hyro -5% — we would have been TERMINATED at least once.`);
  } else if (results[0].maxObservedDd <= -4.0) {
    console.log(`  ⚠️  Close to Hyro -5% — narrow safety margin.`);
  } else {
    console.log(`  ✅ Stays comfortably above Hyro -5% — current kill logic adequate.`);
  }

  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
