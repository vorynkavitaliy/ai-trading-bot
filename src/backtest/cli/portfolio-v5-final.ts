/**
 * Portfolio v5 FINAL — 7 pairs, ALL scaled-in FIXED.
 * Excludes: BTC (0R post-funding-fix), TAO (marginal), AVAX (only 90d CG data).
 *
 * Architecture: each pair runs its proven strategy (S2/S3/S4) PLUS scaled-in
 * FIXED entry (3 ATR-spaced limits, dca_boost decay 0.5, TP locked at signal+2*ATR).
 * Honest engine (funding window block enabled).
 */
import { runBacktest, makeBacktestRiskState } from '../engine';
import { lsTopPositionFade, fundingFade, fundingTaConfluence, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { ClosedTrade, Strategy } from '../types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import { BACKTEST_COMMON } from '../defaults';

const SCALED_IN_FIXED = {
  nEntries: 3, spacingAtr: 0.6, tpAtrMult: 2.0,
  sizingMode: 'dca_boost' as const, dcaBoostDecay: 0.5,
  tpRecomputeOnFill: false,
};

interface PairCfg { pair: string; strategy: Strategy; note: string; }

export const PORTFOLIO_V5_FINAL: PairCfg[] = [
  { pair: 'SOLUSDT',  note: 'S4 scaled-in FIXED',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'INJUSDT',  note: 'S2 scaled-in FIXED',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ATOMUSDT', note: 'S3 scaled-in FIXED',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ARBUSDT',  note: 'S3 scaled-in FIXED',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'XRPUSDT',  note: 'S4 scaled-in FIXED',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'LTCUSDT',  note: 'S2 scaled-in FIXED',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,  slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'HYPEUSDT', note: 'S4 scaled-in FIXED',  strategy: fundingTaConfluence({ scaledIn: SCALED_IN_FIXED }) },
  { pair: 'ETHUSDT',  note: 'S1 scaled-in FIXED',  strategy: lsTopPositionFade({ pctHi: 0.85, pctLo: 0.15, usePairTrend: true,  useBtcTrend: false, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: 0.5, scaledIn: SCALED_IN_FIXED }) },
  { pair: 'BNBUSDT',  note: 'S3 scaled-in FIXED',  strategy: fundingFade({ scaledIn: SCALED_IN_FIXED }) },
];

const MAX_CONCURRENT_POSITIONS = 6;  // operator cap 2026-05-25 (validated vs unlimited — cap6 better)

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

// Post-hoc portfolio-level kill-switch filter — event-based simulation that
// mirrors live timing: equity only changes at EXIT events (PnL realized at close),
// entries check equity reflecting only previously-closed trades.
//
// Previous naive sort-by-entryTs version "compounded" PnL at entry time, which
// incorrectly treated open trades as already-closed — over-killed candidates.
function applyPortfolioKills(trades: ClosedTrade[], startEquity: number, riskPct: number): { keep: ClosedTrade[]; dropped: number } {
  if (trades.length === 0) return { keep: [], dropped: 0 };
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade };
  const events: Event[] = [];
  for (const t of trades) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  // Order entry before exit at same ts (entry sees fresh pre-exit state)
  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.kind === 'entry' ? -1 : 1;
  });

  const dropped = new Set<ClosedTrade>();
  let equity = startEquity;
  let dailyOpen = { day: new Date(events[0].ts).toISOString().slice(0, 10), equity: startEquity };
  let openCount = 0;  // currently-open positions count (for max parallel cap)

  for (const ev of events) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    if (day !== dailyOpen.day) dailyOpen = { day, equity };
    if (ev.kind === 'entry') {
      const totalPnlPct = (equity - startEquity) / startEquity * 100;
      const dailyPnlPct = (equity - dailyOpen.equity) / dailyOpen.equity * 100;
      if (totalPnlPct <= -8.0 || dailyPnlPct <= -4.0 || dailyPnlPct <= -2.5) {
        dropped.add(ev.trade);
      } else if (openCount >= MAX_CONCURRENT_POSITIONS) {
        // Live cap: max 6 concurrent positions. Operator-set 2026-05-25.
        dropped.add(ev.trade);
      } else {
        openCount++;
      }
    } else {  // 'exit'
      if (!dropped.has(ev.trade)) {
        // Fixed sizing — riskPct × STARTING equity, not current.
        const pnlUsd = ev.trade.pnlR * (startEquity * riskPct / 100);
        equity += pnlUsd;
        openCount--;
      }
    }
  }
  return { keep: trades.filter(t => !dropped.has(t)), dropped: dropped.size };
}

function aggregate(trades: ClosedTrade[], label: string) {
  // Apply portfolio kill switches post-hoc (mirrors live risk-guard).
  const { keep, dropped } = applyPortfolioKills(trades, COMMON.startEquity, COMMON.riskPctBase);
  if (dropped > 0) console.log(`  (${label} portfolio kills dropped ${dropped}/${trades.length} trades)`);
  trades = keep;

  // FIXED-RISK sizing: every trade risks riskPctBase × STARTING equity, NOT
  // current equity. This is what operator runs on prop accounts — keeps SL
  // distance in $ constant, predictable. No exponential compounding.
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
  console.log(`${label}: n=${total} WR=${(wins/total*100).toFixed(1)}% PF=${(winR/lossR).toFixed(2)} sumR=${sumR.toFixed(2)} return=${((equity-COMMON.startEquity)/COMMON.startEquity*100).toFixed(2)}% MaxDD=${maxDD.toFixed(2)}%`);
  return { equity, monthly };
}

async function main() {
  const days = parseFloat(process.argv[2] ?? '365');
  const now = Date.now();
  const startTs = now - days * 24 * 3600_000;
  const splitTs = now - (days / 2) * 24 * 3600_000;

  console.log(`Portfolio v5 FINAL — ${PORTFOLIO_V5_FINAL.length} pairs, ${days}d honest engine`);
  console.log(`Pairs: ${PORTFOLIO_V5_FINAL.map(c => c.pair).join(', ')}\n`);

  const fullTrades: ClosedTrade[] = [];
  const trainTrades: ClosedTrade[] = [];
  const testTrades: ClosedTrade[] = [];
  const perPair: Record<string, { full: ClosedTrade[] }> = {};

  // Per-pair fresh risk state — sequential pair-by-pair backtest can't share
  // portfolio-level state correctly (a pair runs full year before next starts).
  // Per-pair filters (SL/any-close cooldown, max SL/day, rrTp2 gate) ARE active.
  // Portfolio-level filters (kill switches, heat cap) are applied post-hoc in
  // aggregation below by sorting all trades chronologically and dropping any
  // that entered after a soft-kill or total-kill trigger.
  for (const cfg of PORTFOLIO_V5_FINAL) {
    log.info(`backtest ${cfg.pair}`, { note: cfg.note });
    resetCgFadeCooldownState();
    const rFull = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: now, ...COMMON });
    resetCgFadeCooldownState();
    const rTrain = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs, endTs: splitTs, ...COMMON });
    resetCgFadeCooldownState();
    const rTest = await runBacktest(cfg.strategy, { symbol: cfg.pair, startTs: splitTs, endTs: now, ...COMMON });
    fullTrades.push(...rFull.trades);
    trainTrades.push(...rTrain.trades);
    testTrades.push(...rTest.trades);
    perPair[cfg.pair] = { full: rFull.trades };
  }

  console.log('\n=== AGGREGATE ===');
  const fullAgg = aggregate(fullTrades, 'FULL ');
  aggregate(trainTrades, 'TRAIN');
  aggregate(testTrades,  'TEST ');

  console.log('\n=== PER-PAIR ===');
  for (const cfg of PORTFOLIO_V5_FINAL) {
    const t = perPair[cfg.pair].full;
    const wins = t.filter(x => x.pnlR > 0.05).length;
    const sumR = t.reduce((s, x) => s + x.pnlR, 0);
    console.log(`  ${cfg.pair.padEnd(10)} ${cfg.note.padEnd(28)} n=${String(t.length).padStart(3)} WR=${(wins/Math.max(1,t.length)*100).toFixed(1).padStart(5)}% sumR=${sumR.toFixed(2).padStart(6)}`);
  }

  console.log('\n=== MONTHLY (FULL) ===');
  const months = Object.keys(fullAgg.monthly).sort();
  let runEq = COMMON.startEquity;
  for (const m of months) {
    const pnl = fullAgg.monthly[m];
    runEq += pnl;
    const pct = pnl / (runEq - pnl) * 100;
    console.log(`  ${m}: $${pnl.toFixed(0).padStart(7)} (${pct.toFixed(2).padStart(6)}%) → equity $${runEq.toFixed(0)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
