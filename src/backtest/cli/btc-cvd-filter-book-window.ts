/**
 * btc-cvd-filter-book-window — ONE rolling window of the FAITHFUL 4-pair BOOK
 * with BASE vs BTC-CVD-FILTER, for rolling-WF decision-making.
 *
 * Identical engine wiring to btc-cvd-filter-book.ts (faithful cap-4 book:
 * BTC+SOL+ADA+LINK, 1H cadence + 4H anchor, cap-4, 3 entries/12h, cooldown-on-
 * commit, flatten −4.3, kills off, slip 0.25%, mixed per-pair risk from
 * pair-strategies.ts). The ONLY change vs base: the BTCUSDT strategy is wrapped
 * with the CVD opposition filter (drop a BTC fade when 24h cross-exchange
 * aggregated taker flow strongly OPPOSES it). All other pairs untouched.
 *
 * Single-window-per-process so each ~120-183d window finishes inside one tsx run
 * (the 6-window all-in-one variant overruns the 10-min cap). Drive via env:
 *   START_OFF / END_OFF = days-before-now for the window bounds (START>END).
 *   WNAME = label. CVD_T (default 1.0). CVD_EXCHANGES / CVD_Z_WINDOW as in base.
 *
 * Emits one JSON line per variant prefixed RESULT_JSON so the runner can parse
 * deterministically. Does NOT edit any live-path file. Filter logic duplicated
 * from btc-cvd-filter.ts so cg-fade.ts / engine-portfolio.ts stay clean.
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { TIER1_PORTFOLIO, LIVE_RISK_PCT } from '../../runtime/pair-strategies';
import { Action, Strategy, StrategyContext, ClosedTrade } from '../types';
import { cgGet } from '../../core/coinglass';
import { close as closePg } from '../../core/db';

const START_EQUITY = 668_000;
const CAP = parseInt(process.env.CAP ?? '4', 10);
const ENTRYCAP = parseInt(process.env.ENTRYCAP ?? '3', 10);
const ENTRY_WINDOW_MS = 12 * 3600_000;
const SLIP = parseFloat(process.env.SLIP ?? '0.25');
const Z_WINDOW = parseInt(process.env.CVD_Z_WINDOW ?? '180', 10);
const EXCHANGES = process.env.CVD_EXCHANGES ?? 'Binance,OKX,Bybit';
const T = parseFloat(process.env.CVD_T ?? '1.0');
const BARS_24H = 6;
const FOUR_H = 4 * 3600_000;

// ─── CVD series + as-of z (duplicated from btc-cvd-filter.ts; no look-ahead) ─────
interface CvdSeries { ts: number[]; cvd24: number[]; }

async function loadCvd(): Promise<CvdSeries> {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: 'BTC', exchange_list: EXCHANGES, interval: '4h', limit: 2160,
  });
  const arr = ((r as any).data as any[]).slice().sort((a, b) => a.time - b.time);
  const ts: number[] = [];
  const delta: number[] = [];
  for (const d of arr) {
    ts.push(d.time);
    delta.push((d.aggregated_buy_volume_usd ?? 0) - (d.aggregated_sell_volume_usd ?? 0));
  }
  const cvd24: number[] = new Array(ts.length).fill(NaN);
  for (let i = 0; i < ts.length; i++) {
    if (i + 1 < BARS_24H) continue;
    let s = 0;
    for (let k = i - BARS_24H + 1; k <= i; k++) s += delta[k];
    cvd24[i] = s;
  }
  return { ts, cvd24 };
}

function zAsOf(series: CvdSeries, atTs: number): number | null {
  let idx = -1;
  for (let i = 0; i < series.ts.length; i++) {
    if (series.ts[i] + FOUR_H <= atTs) idx = i; else break;
  }
  if (idx < 0) return null;
  const cur = series.cvd24[idx];
  if (!Number.isFinite(cur)) return null;
  const lo = Math.max(0, idx - Z_WINDOW + 1);
  const win: number[] = [];
  for (let i = lo; i <= idx; i++) if (Number.isFinite(series.cvd24[i])) win.push(series.cvd24[i]);
  if (win.length < Math.min(30, Z_WINDOW)) return null;
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const variance = win.reduce((a, b) => a + (b - mean) * (b - mean), 0) / win.length;
  const std = Math.sqrt(variance);
  if (std <= 0) return null;
  return (cur - mean) / std;
}

function opposes(side: 'long' | 'short', z: number | null, t: number): boolean {
  if (z == null) return false;
  if (side === 'short') return z >= +t;
  return z <= -t;
}

interface WrapStats { seenEnter: number; dropped: number; }

function wrapBtc(inner: Strategy, series: CvdSeries, t: number, stats: WrapStats): Strategy {
  return {
    name: `${inner.name}+cvd-filter(T${t})`,
    needsCoinglass: inner.needsCoinglass,
    needsBtcContext: inner.needsBtcContext,
    decide(ctx: StrategyContext): Action {
      const a = inner.decide(ctx);
      if (a.kind !== 'enter') return a;
      stats.seenEnter++;
      const z = zAsOf(series, ctx.ts);
      if (opposes(a.side, z, t)) { stats.dropped++; return { kind: 'hold' }; }
      return a;
    },
  };
}

// ─── book metrics (mirrors live-cron-true-mirror.aggregate, fixed-risk sizing) ────
function aggregate(trades: ClosedTrade[]): { ret: number; maxDD: number; sumR: number; pf: number; n: number; wr: number } {
  const fixedRiskUsd = START_EQUITY * (LIVE_RISK_PCT / 100);
  let equity = START_EQUITY, peak = equity, maxDD = 0, sumR = 0, wins = 0, losses = 0;
  const sorted = [...trades].sort((a, b) => a.exitTs - b.exitTs);
  for (const tr of sorted) {
    equity += tr.pnlR * fixedRiskUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    sumR += tr.pnlR;
    if (tr.pnlR > 0.05) wins++; else if (tr.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  return {
    ret: (equity - START_EQUITY) / START_EQUITY * 100,
    maxDD, sumR, pf: lossR > 0 ? winR / lossR : (winR > 0 ? 99 : 0),
    n: trades.length, wr: total > 0 ? wins / total * 100 : 0,
  };
}

async function runBook(
  filtered: boolean, windowName: string, startTs: number, endTs: number, series: CvdSeries,
) {
  process.env.DECISION_CADENCE = '60m';
  process.env.ANCHOR_4H = '1';

  const stats: WrapStats = { seenEnter: 0, dropped: 0 };
  const activePairs = TIER1_PORTFOLIO.filter(c => c.enabled);
  const symbolStrats: PortfolioSymbolStrategy[] = activePairs.map((c, i) => ({
    symbol: c.pair,
    strategy: (filtered && c.pair === 'BTCUSDT') ? wrapBtc(c.strategy, series, T, stats) : c.strategy,
    priority: i,
  }));

  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(symbolStrats, {
    startTs, endTs,
    startEquity: START_EQUITY,
    slippagePct: SLIP,
    takerFeeRate: 0.00055,
    makerFeeRate: 0.0002,
    leverage: 10,
    decisionTf: '240m',
    tp1SlMode: 'no_move',
    bePlusBufferPct: 0.10,
    maxParallelCap: CAP,
    maxEntriesPerWindow: ENTRYCAP,
    entryCapWindowMs: ENTRY_WINDOW_MS,
    cooldownOnCommit: true,
    dailyDdFlattenPct: -4.3,
  });

  const agg = aggregate(r.trades);
  const cnt = (sym: string) => r.trades.filter(t => t.symbol === sym).length;
  const dd = r.dailyDd;
  const out = {
    variant: filtered ? `FILT-T${T}` : 'BASE',
    window: windowName,
    ret: Number(agg.ret.toFixed(2)),
    engineRet: Number(((r.endEquity - r.startEquity) / r.startEquity * 100).toFixed(2)),
    pf: Number(agg.pf.toFixed(2)),
    sumR: Number(agg.sumR.toFixed(2)),
    maxDD: Number(agg.maxDD.toFixed(2)),
    n: agg.n,
    wr: Number(agg.wr.toFixed(1)),
    worstDayMtm: dd.worstDailyDdPct,
    worstDayBal: dd.balWorstDailyDdPct,
    breach5: dd.daysBreach5,
    breach4: dd.daysBreach4,
    flatten: r.guard.flattenDays,
    btcN: cnt('BTCUSDT'), solN: cnt('SOLUSDT'), adaN: cnt('ADAUSDT'), linkN: cnt('LINKUSDT'),
    btcDropped: filtered ? stats.dropped : 0,
  };
  console.log('RESULT_JSON ' + JSON.stringify(out));
  return out;
}

async function main() {
  const startOff = parseFloat(process.env.START_OFF ?? '183');  // days-before-now (older bound)
  const endOff = parseFloat(process.env.END_OFF ?? '0');        // days-before-now (newer bound)
  const wname = process.env.WNAME ?? `w-${startOff}..${endOff}`;
  const now = Date.now();
  const D = 24 * 3600_000;
  const startTs = now - startOff * D;
  const endTs = now - endOff * D;

  const series = await loadCvd();
  console.log(`\nCVD: ${series.ts.length} bars  ${new Date(series.ts[0]).toISOString().slice(0, 10)} → ${new Date(series.ts[series.ts.length - 1]).toISOString().slice(0, 10)}  exch=${EXCHANGES}  zWin=${Z_WINDOW}  T=${T}`);
  console.log(`BOOK: ${TIER1_PORTFOLIO.filter(c => c.enabled).map(c => c.pair).join('+')}  cap=${CAP} entrycap=${ENTRYCAP}/12h slip=${SLIP}% flatten=−4.3 (kills off)`);
  console.log(`  WINDOW ${wname}  ${new Date(startTs).toISOString().slice(0, 10)} → ${new Date(endTs).toISOString().slice(0, 10)}  (${((endTs - startTs) / D).toFixed(0)}d)`);

  await runBook(false, wname, startTs, endTs, series);
  await runBook(true, wname, startTs, endTs, series);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
