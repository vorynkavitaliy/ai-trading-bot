// Walk-forward portfolio diagnostic. Runs the same VP-SMC + cap-N + per-symbol
// params as src/backtest/cli/portfolio.ts, but splits the year into N non-overlapping
// 30d windows. Each window is treated as an independent backtest (no cross-window
// equity carry — we measure window-by-window robustness, not compounding).
//
// Output: per-window metrics (trades, WR, totalR, P&L, return%) + summary
// (profitable-window %, return stdev, best/worst).
//
// Why: split-sample IS/OOS missed the per-month variance. If most windows are flat
// and one outlier window carries the year, that's overfit-to-regime, not robust edge.

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'BNBUSDT', 'LTCUSDT', 'LINKUSDT', 'ATOMUSDT',
  'SUIUSDT', 'TONUSDT', 'DOGEUSDT', 'APTUSDT', 'ARBUSDT',
];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  LINKUSDT: { maxStopAtrPct: 5.0 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  SUIUSDT:  { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
};

const SLIPPAGE_PCT = parseFloat(process.env.WALK_SLIP ?? '0.12');
const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: SLIPPAGE_PCT,
  riskPctBase: 0.6,
  leverage: 10,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

const RISK_PCT = parseFloat(process.env.WALK_RISK_PCT ?? '0.375');
const MAX_PARALLEL = parseInt(process.env.WALK_CAP ?? '4', 10);
const WINDOW_DAYS = parseInt(process.env.WALK_DAYS ?? '30', 10);
const NUM_WINDOWS = parseInt(process.env.WALK_N ?? '12', 10);

interface WindowResult {
  fromTs: number;
  toTs: number;
  trades: number;
  wins: number;
  wr: number;
  totalR: number;
  pnlUsd: number;
  returnPct: number;
  maxDDPct: number;
  bySymbol: Record<string, { trades: number; wins: number; totalR: number }>;
}

async function runWindow(startTs: number, endTs: number): Promise<WindowResult> {
  const all: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    all.push(...r.trades);
  }
  all.sort((a, b) => a.entryTs - b.entryTs);

  // Portfolio sim with cap + pair-unique
  const open: { symbol: string; exitTs: number }[] = [];
  const taken: ClosedTrade[] = [];
  for (const t of all) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exitTs <= t.entryTs) open.splice(i, 1);
    if (open.some((p) => p.symbol === t.symbol)) continue;
    if (open.length >= MAX_PARALLEL) continue;
    taken.push(t);
    open.push({ symbol: t.symbol, exitTs: t.exitTs });
  }

  // Compound equity by event order
  type Event = { ts: number; kind: 'entry' | 'exit'; trade: ClosedTrade; pnlUsd?: number };
  const events: Event[] = [];
  const pnlByTrade = new Map<ClosedTrade, number>();
  for (const t of taken) {
    events.push({ ts: t.entryTs, kind: 'entry', trade: t });
    events.push({ ts: t.exitTs, kind: 'exit', trade: t });
  }
  events.sort((a, b) => a.ts - b.ts || (a.kind === 'exit' ? -1 : 1));

  let runEquity = COMMON.startEquity;
  let peak = COMMON.startEquity;
  let maxDDPct = 0;
  for (const ev of events) {
    if (ev.kind === 'entry') {
      const riskUsd = runEquity * (RISK_PCT / 100);
      pnlByTrade.set(ev.trade, ev.trade.pnlR * riskUsd);
    } else {
      const pnl = pnlByTrade.get(ev.trade) ?? 0;
      runEquity += pnl;
      if (runEquity > peak) peak = runEquity;
      const dd = ((peak - runEquity) / peak) * 100;
      if (dd > maxDDPct) maxDDPct = dd;
    }
  }

  const wins = taken.filter((t) => t.pnlR > 0).length;
  const totalR = taken.reduce((a, t) => a + t.pnlR, 0);
  const pnlUsd = runEquity - COMMON.startEquity;
  const returnPct = (pnlUsd / COMMON.startEquity) * 100;

  const bySymbol: Record<string, { trades: number; wins: number; totalR: number }> = {};
  for (const t of taken) {
    const s = bySymbol[t.symbol] ?? { trades: 0, wins: 0, totalR: 0 };
    s.trades++;
    if (t.pnlR > 0) s.wins++;
    s.totalR += t.pnlR;
    bySymbol[t.symbol] = s;
  }

  return {
    fromTs: startTs, toTs: endTs,
    trades: taken.length, wins, wr: taken.length ? wins / taken.length : 0,
    totalR, pnlUsd, returnPct, maxDDPct, bySymbol,
  };
}

async function main() {
  const envEnd = process.env.BT_END_ISO ? Date.parse(process.env.BT_END_ISO) : Date.now();
  const totalDays = WINDOW_DAYS * NUM_WINDOWS;

  console.log('==================================================================================');
  console.log(`WALK-FORWARD PORTFOLIO — ${SYMBOLS.length} pairs, cap-${MAX_PARALLEL}, risk ${RISK_PCT}%, slip ${SLIPPAGE_PCT}%`);
  console.log(`${NUM_WINDOWS} × ${WINDOW_DAYS}d windows = ${totalDays}d total`);
  console.log(`anchor end: ${new Date(envEnd).toISOString().slice(0, 10)}`);
  console.log('==================================================================================\n');

  log.info('walk-portfolio start', { numWindows: NUM_WINDOWS, windowDays: WINDOW_DAYS, riskPct: RISK_PCT, cap: MAX_PARALLEL });

  const results: WindowResult[] = [];
  console.log('window                                T    WR    totalR     P&L      DD     return');
  console.log('----------------------------------------------------------------------------------');

  for (let i = 0; i < NUM_WINDOWS; i++) {
    const winEnd = envEnd - (NUM_WINDOWS - 1 - i) * WINDOW_DAYS * 86_400_000;
    const winStart = winEnd - WINDOW_DAYS * 86_400_000;
    const r = await runWindow(winStart, winEnd);
    results.push(r);
    const wStr = `${new Date(winStart).toISOString().slice(0, 10)} → ${new Date(winEnd).toISOString().slice(0, 10)}`;
    console.log(
      `${wStr}  ${String(r.trades).padStart(3)}  ${(r.wr * 100).toFixed(1).padStart(5)}%  ` +
      `${r.totalR.toFixed(2).padStart(7)}R  $${r.pnlUsd.toFixed(0).padStart(6)}  ${r.maxDDPct.toFixed(2).padStart(5)}%  ${(r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(2).padStart(6)}%`
    );
  }

  // Summary statistics
  const returns = results.map((r) => r.returnPct);
  const profitable = returns.filter((x) => x > 0).length;
  const negative = returns.filter((x) => x < 0).length;
  const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sortedRet = [...returns].sort((a, b) => a - b);
  const median = sortedRet[Math.floor(sortedRet.length / 2)];
  const minRet = sortedRet[0];
  const maxRet = sortedRet[sortedRet.length - 1];
  const variance = returns.reduce((a, x) => a + Math.pow(x - avgRet, 2), 0) / returns.length;
  const stdev = Math.sqrt(variance);

  // Sharpe-ish: annualised
  const monthlyAvg = avgRet;
  const monthlyStdev = stdev;
  const annSharpe = monthlyStdev > 0 ? (monthlyAvg * 12) / (monthlyStdev * Math.sqrt(12)) : 0;

  console.log('----------------------------------------------------------------------------------\n');
  console.log('summary:');
  console.log(`  profitable windows:   ${profitable}/${NUM_WINDOWS} (${((profitable / NUM_WINDOWS) * 100).toFixed(0)}%)`);
  console.log(`  negative windows:     ${negative}/${NUM_WINDOWS}`);
  console.log(`  avg return / window:  ${avgRet.toFixed(2)}%`);
  console.log(`  median return:        ${median.toFixed(2)}%`);
  console.log(`  best window:          ${maxRet.toFixed(2)}%`);
  console.log(`  worst window:         ${minRet.toFixed(2)}%`);
  console.log(`  stdev:                ${stdev.toFixed(2)}%`);
  console.log(`  annualised Sharpe-ish:${annSharpe.toFixed(2)}`);

  // Outlier check
  const meanContribution = avgRet * NUM_WINDOWS;
  const topWindow = sortedRet[sortedRet.length - 1];
  const top3 = sortedRet.slice(-3).reduce((a, b) => a + b, 0);
  const top3Frac = (top3 / meanContribution) * 100;
  console.log('');
  console.log('outlier sensitivity:');
  console.log(`  total return all windows summed: ${meanContribution.toFixed(2)}%`);
  console.log(`  top 1 window:                    ${topWindow.toFixed(2)}% (${((topWindow / meanContribution) * 100).toFixed(1)}% of total)`);
  console.log(`  top 3 windows combined:          ${top3.toFixed(2)}% (${top3Frac.toFixed(1)}% of total)`);
  if (top3Frac > 70) {
    console.log(`  ⚠  top 3 windows carry ${top3Frac.toFixed(0)}% of total — strategy is regime-concentrated.`);
  }

  // Per-symbol contribution across windows
  const symStats: Record<string, { trades: number; wins: number; totalR: number; winsInWindow: number }> = {};
  for (const r of results) {
    for (const [sym, s] of Object.entries(r.bySymbol)) {
      const acc = symStats[sym] ?? { trades: 0, wins: 0, totalR: 0, winsInWindow: 0 };
      acc.trades += s.trades; acc.wins += s.wins; acc.totalR += s.totalR;
      if (s.totalR > 0) acc.winsInWindow++;
      symStats[sym] = acc;
    }
  }
  console.log('');
  console.log('per-symbol stats across all windows:');
  console.log('  symbol     trades  WR     totalR    winsInWindow');
  const symEntries = Object.entries(symStats).sort((a, b) => b[1].totalR - a[1].totalR);
  for (const [sym, s] of symEntries) {
    const wr = s.trades ? (s.wins / s.trades) * 100 : 0;
    console.log(`  ${sym.padEnd(10)} ${String(s.trades).padStart(4)}  ${wr.toFixed(1).padStart(5)}% ${s.totalR.toFixed(2).padStart(8)}R  ${s.winsInWindow}/${NUM_WINDOWS}`);
  }

  await closePg();
}

main().catch(async (e) => {
  log.error('walk-portfolio failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
