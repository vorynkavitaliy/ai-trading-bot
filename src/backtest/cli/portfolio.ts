// Portfolio backtest: 10 pairs sharing one $50k equity, max 4 parallel positions
// (one per pair). Uses R-multiples from per-pair backtests; pnlUsd is rederived
// against the SHARED, COMPOUNDING equity.
//
// Why this matters: per-pair backtests run on isolated $50k. Real portfolio has
// (a) shared equity, (b) parallel-cap, (c) compound. This script answers the
// honest question: "what would $50k actually do across all 10 pairs with cap 4?"

import { runBacktest } from '../engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade, BacktestSettings } from '../types';
import { computeMetrics, formatMetrics } from '../metrics';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'BNBUSDT', 'LTCUSDT', 'ATOMUSDT',
  'TONUSDT', 'DOGEUSDT',
  'APTUSDT', 'ARBUSDT',
  'TAOUSDT', 'INJUSDT',
];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
  TAOUSDT:  { maxStopAtrPct: 5.0 },
  INJUSDT:  { maxStopAtrPct: 5.0 },
};

// Override via CLI: portfolio.ts <days> <riskPct> <maxParallel> [posCapPct] [slippagePct] [tp1SlMode] [bePlusBufferPct]
// Defaults reflect production config (no_move SL after TP1, slip 0.12%).
const RISK_PCT = parseFloat(process.argv[3] ?? '0.375');
const MAX_PARALLEL = parseInt(process.argv[4] ?? '6', 10);
const POS_CAP_PCT = process.argv[5] ? parseFloat(process.argv[5]) : undefined;
const SLIPPAGE_PCT = process.argv[6] ? parseFloat(process.argv[6]) : 0.12;          // mid-realistic
const TP1_SL_MODE = (process.argv[7] as 'be' | 'be_plus' | 'no_move' | 'halfway' | undefined) ?? 'no_move';
const BE_PLUS_BUFFER_PCT = process.argv[8] ? parseFloat(process.argv[8]) : 0.10;

const COMMON: Omit<BacktestSettings, 'symbol' | 'startTs' | 'endTs'> = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: SLIPPAGE_PCT,
  riskPctBase: 0.6,
  leverage: 10,
  maxNotionalPctOfEquity: POS_CAP_PCT,
  tp1SlMode: TP1_SL_MODE,
  bePlusBufferPct: BE_PLUS_BUFFER_PCT,
};

interface PortfolioTrade extends ClosedTrade {
  // Recomputed at portfolio level
  portfolioRiskUsd: number;
  portfolioPnlUsd: number;
  equityAtEntry: number;
  equityAtExit: number;
  skipped?: boolean;
  skipReason?: string;
}

async function main() {
  // Override window via env: BT_START_ISO=2026-01-01 BT_END_ISO=2026-05-16
  // (used for frozen-params OOS splits). Falls back to `days`-from-now window.
  const days = parseInt(process.argv[2] ?? '365', 10);
  const now = Date.now();
  const envStart = process.env.BT_START_ISO ? Date.parse(process.env.BT_START_ISO) : NaN;
  const envEnd   = process.env.BT_END_ISO   ? Date.parse(process.env.BT_END_ISO)   : NaN;
  const startTs = Number.isFinite(envStart) ? envStart : now - days * 24 * 60 * 60_000;
  const endTs   = Number.isFinite(envEnd)   ? envEnd   : now;
  const windowDays = Math.round((endTs - startTs) / 86_400_000);
  log.info('=== portfolio backtest start ===', {
    days: windowDays, symbols: SYMBOLS.length, maxParallel: MAX_PARALLEL,
    riskPct: RISK_PCT, startEquity: COMMON.startEquity,
    from: new Date(startTs).toISOString().slice(0,10),
    to: new Date(endTs).toISOString().slice(0,10),
  });

  // 1) Run per-pair backtests, collect trades
  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    log.info('pair done', {
      symbol, trades: r.metrics.trades, totalR: r.metrics.totalR.toFixed(2),
      pf: r.metrics.profitFactor === Infinity ? '∞' : r.metrics.profitFactor.toFixed(2),
    });
    allTrades.push(...r.trades);
  }

  // 2) Sort by entryTs (chronological)
  allTrades.sort((a, b) => a.entryTs - b.entryTs);
  log.info('all-pair trade count', { combined: allTrades.length });

  // 3) Portfolio simulation: cap parallel + per-pair-uniqueness, compound equity
  let equity = COMMON.startEquity;
  const open: { symbol: string; exitTs: number }[] = [];
  const taken: PortfolioTrade[] = [];
  const skipped: PortfolioTrade[] = [];

  for (const t of allTrades) {
    // Drop positions that closed before this entry
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].exitTs <= t.entryTs) open.splice(i, 1);
    }

    // Block #1: same-pair already open
    if (open.some((p) => p.symbol === t.symbol)) {
      skipped.push({ ...t, portfolioRiskUsd: 0, portfolioPnlUsd: 0, equityAtEntry: equity, equityAtExit: equity, skipped: true, skipReason: 'pair-open' });
      continue;
    }
    // Block #2: cap reached
    if (open.length >= MAX_PARALLEL) {
      skipped.push({ ...t, portfolioRiskUsd: 0, portfolioPnlUsd: 0, equityAtEntry: equity, equityAtExit: equity, skipped: true, skipReason: 'cap-4' });
      continue;
    }

    // Take it
    const equityAtEntry = equity;
    const portfolioRiskUsd = equity * (RISK_PCT / 100);
    const portfolioPnlUsd = t.pnlR * portfolioRiskUsd;  // R already includes fees+funding
    const equityAtExit = equity + portfolioPnlUsd;
    // Note: equity is updated at exitTs, NOT entryTs (other parallel trades sized on same equity until close)
    // To approximate this simply, we update equity at exitTs in chronological order below.

    taken.push({
      ...t, portfolioRiskUsd, portfolioPnlUsd, equityAtEntry, equityAtExit,
    });
    open.push({ symbol: t.symbol, exitTs: t.exitTs });
  }

  // 4) Walk taken trades by exitTs to compound equity correctly
  taken.sort((a, b) => a.exitTs - b.exitTs);
  let runEquity = COMMON.startEquity;
  const equityCurve: { ts: number; equity: number }[] = [{ ts: startTs, equity: runEquity }];
  // We need to recompute portfolioPnl using equity at ENTRY (which depends on prior closes).
  // Simpler approach: re-walk.
  const realized: PortfolioTrade[] = [];
  // Map trade -> entry-time equity by walking close events.
  // Algorithm:
  //   - Iterate events sorted by ts: each entry-event reads current equity, each exit-event applies pnl.
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: PortfolioTrade };
  const events: Event[] = [];
  for (const t of taken) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  events.sort((a, b) => a.ts - b.ts || (a.kind === 'exit' ? -1 : 1));  // exits before entries at same ts

  for (const ev of events) {
    if (ev.kind === 'entry') {
      ev.trade.equityAtEntry = runEquity;
      ev.trade.portfolioRiskUsd = runEquity * (RISK_PCT / 100);
      ev.trade.portfolioPnlUsd = ev.trade.pnlR * ev.trade.portfolioRiskUsd;
    } else {
      runEquity += ev.trade.portfolioPnlUsd;
      ev.trade.equityAtExit = runEquity;
      equityCurve.push({ ts: ev.ts, equity: runEquity });
      realized.push(ev.trade);
    }
  }
  equityCurve.push({ ts: endTs, equity: runEquity });

  // 5) Portfolio metrics — use ClosedTrade-shaped objects with portfolio P&L
  const portfolioClosedTrades: ClosedTrade[] = realized.map((t) => ({
    ...t,
    pnlUsd: t.portfolioPnlUsd,
    feesUsd: 0,           // already baked into pnlR
    fundingUsd: 0,
  }));
  const portfolioMetrics = computeMetrics(portfolioClosedTrades, COMMON.startEquity, equityCurve);

  // 6) Per-symbol breakdown of TAKEN trades
  const bySymbol = new Map<string, ClosedTrade[]>();
  for (const t of realized) {
    const arr = bySymbol.get(t.symbol) ?? [];
    arr.push({ ...t, pnlUsd: t.portfolioPnlUsd, feesUsd: 0, fundingUsd: 0 });
    bySymbol.set(t.symbol, arr);
  }

  // 7) Skip diagnostics
  const skipPair = skipped.filter((s) => s.skipReason === 'pair-open').length;
  const skipCap = skipped.filter((s) => s.skipReason === 'cap-4').length;

  // ---- output ----
  console.log('================================================================');
  console.log(`PORTFOLIO BACKTEST — VP-SMC, ${SYMBOLS.length} pairs, cap-${MAX_PARALLEL} parallel, $${COMMON.startEquity} equity`);
  console.log(`window: ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} (${windowDays}d)`);
  console.log(`risk per trade: ${RISK_PCT}% of equity (compounding)`);
  console.log('================================================================\n');

  console.log(`signal volume:`);
  console.log(`  total signals:        ${allTrades.length}`);
  console.log(`  taken:                ${realized.length}`);
  console.log(`  skipped (pair open):  ${skipPair}`);
  console.log(`  skipped (cap-4):      ${skipCap}`);
  console.log(`  take-rate:            ${((realized.length / allTrades.length) * 100).toFixed(1)}%\n`);

  console.log('per-pair (only TAKEN trades):');
  for (const s of SYMBOLS) {
    const trs = bySymbol.get(s) ?? [];
    if (trs.length === 0) {
      console.log(`  ${s.padEnd(10)} 0 trades taken`);
      continue;
    }
    const wins = trs.filter((t) => t.pnlR > 0).length;
    const totalR = trs.reduce((acc, t) => acc + t.pnlR, 0);
    const totalUsd = trs.reduce((acc, t) => acc + t.pnlUsd, 0);
    console.log(`  ${s.padEnd(10)} T:${String(trs.length).padStart(3)}  W:${String(wins).padStart(3)}  R:${totalR.toFixed(2).padStart(7)}  $${totalUsd.toFixed(0).padStart(6)}`);
  }
  console.log('');

  console.log(formatMetrics('PORTFOLIO', portfolioMetrics));

  // Monthly breakdown
  console.log('\nmonthly P&L (compounding):');
  const monthly = new Map<string, number>();
  for (const t of realized) {
    const month = new Date(t.exitTs).toISOString().slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + t.portfolioPnlUsd);
  }
  let monthRunEquity = COMMON.startEquity;
  const monthsSorted = [...monthly.keys()].sort();
  for (const m of monthsSorted) {
    const pnl = monthly.get(m)!;
    const startMonth = monthRunEquity;
    monthRunEquity += pnl;
    const pct = (pnl / startMonth) * 100;
    console.log(`  ${m}: $${pnl.toFixed(0).padStart(6)}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)  → equity $${monthRunEquity.toFixed(0)}`);
  }
  const monthsCount = monthsSorted.length;
  const totalReturnPct = ((runEquity - COMMON.startEquity) / COMMON.startEquity) * 100;
  const avgMonthlyPct = totalReturnPct / monthsCount;
  console.log(`\nover ${monthsCount} active months: total ${totalReturnPct.toFixed(2)}%, avg ${avgMonthlyPct.toFixed(2)}%/month`);
  console.log(`final equity: $${runEquity.toFixed(0)}  (started $${COMMON.startEquity})`);

  await closePg();
}

main().catch(async (e) => {
  log.error('portfolio backtest failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
