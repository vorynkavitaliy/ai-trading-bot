/**
 * btc-cvd-filter — validate the BTC CVD-confluence FILTER on the FAITHFUL engine.
 *
 * The filter (signal-level survivor from overlay C): at a BTC fade entry, DROP it
 * if 24h cross-exchange aggregated taker order flow strongly OPPOSES the fade:
 *   - fade-SHORT (crowded-long, strategy side='short') skipped when 24h CVD z >= +T
 *     (buyers in control — opposing the short).
 *   - fade-LONG  (crowded-short, strategy side='long')  skipped when 24h CVD z <= -T
 *     (sellers in control — opposing the long).
 *
 * CVD = cumulative (aggregated_taker_buy - aggregated_taker_sell), per 4h bar.
 * 24h CVD = trailing sum of 6×4h bars. z-score of that 24h series over a trailing
 * window (default 180 bars = 30d). NO LOOK-AHEAD: z is computed only from CVD bars
 * whose close time < decision bar close (ctx.ts), i.e. data live would already have.
 *
 * Engine: runBacktest (single-pair BTC = faithful, cap never binds), cronRealistic:true,
 * slippage 0.25%, taker 0.00055 / maker 0.0002, leverage 10, tp1SlMode no_move —
 * matching the validated live BTC config (pair-strategies.ts):
 *   lsTopPositionFade pctHi .85 pctLo .15, useBtcTrend, SL 2.0×ATR, TP 2.0×ATR,
 *   maxHoldBars 12, riskPct 1.25.
 *
 * Per window/variant we report: n, WR, PF, sumR, ret%, equity MaxDD%, worst rolling-24h
 * DD%. We also report, per window: how many entries the filter DROPS and the dropped-set
 * realized R AFTER SL/TP packaging (a separate "dropped-only" run on the same engine) —
 * does the filter still isolate losers after the engine, or did packaging already handle
 * them?
 *
 * Run: npx tsx src/backtest/cli/btc-cvd-filter.ts
 *   env CVD_EXCHANGES (default Binance,OKX,Bybit), CVD_Z_WINDOW (default 180),
 *       CVD_BUY (default 200000) start equity scale is fixed at 200k.
 *
 * Pure research CLI — does NOT edit cg-fade.ts / engine.ts / pair-strategies.ts.
 */
import { runBacktest } from '../engine';
import { BacktestSettings, Action, Strategy, StrategyContext } from '../types';
import { lsTopPositionFade, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { cgGet } from '../../core/coinglass';
import { close as closePg } from '../../core/db';

const START_EQUITY = 200_000;
const RISK_PCT = 1.25;
const FIXED_RISK_USD = START_EQUITY * (RISK_PCT / 100);
const Z_WINDOW = parseInt(process.env.CVD_Z_WINDOW ?? '180', 10);   // trailing bars for z (30d)
const EXCHANGES = process.env.CVD_EXCHANGES ?? 'Binance,OKX,Bybit';
const BARS_24H = 6;  // 6 × 4h = 24h

// ─── CVD series + as-of z lookup (no look-ahead) ────────────────────────────────
interface CvdSeries {
  ts: number[];        // 4h bar close-anchored timestamps (ascending) = CG `time`
  cvd24: number[];     // trailing-24h CVD (sum of 6 bar deltas) ending at ts[i]
}

async function loadCvd(): Promise<CvdSeries> {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: 'BTC', exchange_list: EXCHANGES, interval: '4h', limit: 2160,
  });
  const arr = ((r as any).data as any[]).slice().sort((a, b) => a.time - b.time);
  const ts: number[] = [];
  const delta: number[] = [];   // per-bar (buy - sell)
  for (const d of arr) {
    ts.push(d.time);
    delta.push((d.aggregated_buy_volume_usd ?? 0) - (d.aggregated_sell_volume_usd ?? 0));
  }
  // trailing-24h CVD = rolling sum of last 6 bar deltas
  const cvd24: number[] = new Array(ts.length).fill(NaN);
  for (let i = 0; i < ts.length; i++) {
    if (i + 1 < BARS_24H) continue;     // need 6 bars
    let s = 0;
    for (let k = i - BARS_24H + 1; k <= i; k++) s += delta[k];
    cvd24[i] = s;
  }
  return { ts, cvd24 };
}

// z-score of 24h-CVD as of the decision bar whose CLOSE == atTs. Uses only bars with
// time < atTs (strictly before) → the bar that closed at atTs is the most recent KNOWN
// 4h CVD bar (CG `time` is the bar OPEN; a bar with time T closes at T+4h, so we include
// bars with time + 4h <= atTs). Returns null when insufficient history (→ no drop).
const FOUR_H = 4 * 3600_000;
function zAsOf(series: CvdSeries, atTs: number): number | null {
  // index of the last CVD bar that has fully CLOSED at or before atTs
  let idx = -1;
  for (let i = 0; i < series.ts.length; i++) {
    if (series.ts[i] + FOUR_H <= atTs) idx = i; else break;
  }
  if (idx < 0) return null;
  const cur = series.cvd24[idx];
  if (!Number.isFinite(cur)) return null;
  // trailing window of valid cvd24 values ending at idx (exclusive of idx for stats?
  // include idx — z = (cur - mean(window includes cur)) / std). Use window ending at idx.
  const lo = Math.max(0, idx - Z_WINDOW + 1);
  const win: number[] = [];
  for (let i = lo; i <= idx; i++) if (Number.isFinite(series.cvd24[i])) win.push(series.cvd24[i]);
  if (win.length < Math.min(30, Z_WINDOW)) return null;   // need a meaningful sample
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const variance = win.reduce((a, b) => a + (b - mean) * (b - mean), 0) / win.length;
  const std = Math.sqrt(variance);
  if (std <= 0) return null;
  return (cur - mean) / std;
}

// ─── Filter decorator ───────────────────────────────────────────────────────────
// mode 'filter' → drop the entry when CVD opposes the fade (the FILTERED variant).
// mode 'dropped' → keep ONLY the entries the filter would drop (the DROPPED-only set,
//                  so we can measure dropped-set realized R after SL/TP packaging).
type WrapMode = 'filter' | 'dropped';

interface WrapStats { seenEnter: number; opposed: number; passed: number; }

function opposes(side: 'long' | 'short', z: number | null, T: number): boolean {
  if (z == null) return false;          // unknown flow → never claim opposition
  if (side === 'short') return z >= +T; // buyers in control opposes a short
  return z <= -T;                       // sellers in control opposes a long
}

function wrap(inner: Strategy, series: CvdSeries, T: number, mode: WrapMode, stats: WrapStats): Strategy {
  return {
    name: `${inner.name}+cvd-${mode}(T${T})`,
    needsCoinglass: inner.needsCoinglass,
    needsBtcContext: inner.needsBtcContext,
    decide(ctx: StrategyContext): Action {
      const a = inner.decide(ctx);
      if (a.kind !== 'enter') return a;
      stats.seenEnter++;
      const z = zAsOf(series, ctx.ts);
      const isOpposed = opposes(a.side, z, T);
      if (isOpposed) stats.opposed++; else stats.passed++;
      if (mode === 'filter') {
        // FILTERED: drop opposing entries → return hold so engine treats as no-signal.
        return isOpposed ? { kind: 'hold' } : a;
      }
      // DROPPED-only: keep ONLY the opposing entries.
      return isOpposed ? a : { kind: 'hold' };
    },
  };
}

// ─── Metrics ────────────────────────────────────────────────────────────────────
interface Row {
  variant: string;
  window: string;
  n: number;
  wrPct: number;
  pf: number;
  sumR: number;
  retPct: number;
  maxDDPct: number;
  worst24hDDPct: number;
  dropped?: number;
  droppedSumR?: number;
}

function summarize(variant: string, window: string, trades: { pnlR: number; exitTs: number }[]): Row {
  let eq = START_EQUITY, peak = eq, maxDD = 0, sumR = 0, wins = 0, losses = 0, winR = 0, lossR = 0;
  const sorted = trades.slice().sort((a, b) => a.exitTs - b.exitTs);
  // equity points (ts, equity) for rolling-24h DD
  const pts: { ts: number; eq: number }[] = [{ ts: sorted.length ? sorted[0].exitTs - 1 : 0, eq }];
  for (const t of sorted) {
    eq += t.pnlR * FIXED_RISK_USD;
    if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100;
    if (d > maxDD) maxDD = d;
    sumR += t.pnlR;
    if (t.pnlR > 0) { wins++; winR += t.pnlR; } else if (t.pnlR < 0) { losses++; lossR += Math.abs(t.pnlR); }
    pts.push({ ts: t.exitTs, eq });
  }
  // worst rolling-24h equity DD: for each point, max drop to any point within next 24h
  let worst24 = 0;
  for (let i = 0; i < pts.length; i++) {
    const hi = pts[i].eq;
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].ts - pts[i].ts > 24 * 3600_000) break;
      const drop = (hi - pts[j].eq) / hi * 100;
      if (drop > worst24) worst24 = drop;
    }
  }
  const total = wins + losses;
  const pf = lossR > 0 ? winR / lossR : (winR > 0 ? 99 : 0);
  return {
    variant, window,
    n: sorted.length,
    wrPct: total > 0 ? wins / total * 100 : 0,
    pf,
    sumR,
    retPct: (eq - START_EQUITY) / START_EQUITY * 100,
    maxDDPct: maxDD,
    worst24hDDPct: worst24,
  };
}

// ─── Run one variant on one window ──────────────────────────────────────────────
async function runVariant(
  label: string,
  windowName: string,
  startTs: number,
  endTs: number,
  makeStrat: () => Strategy,
): Promise<{ row: Row; trades: { pnlR: number; exitTs: number }[] }> {
  resetCgFadeCooldownState();
  const settings: BacktestSettings = {
    symbol: 'BTCUSDT',
    startTs, endTs,
    startEquity: START_EQUITY,
    takerFeeRate: 0.00055,
    makerFeeRate: 0.0002,
    slippagePct: 0.25,
    riskPctBase: RISK_PCT,
    leverage: 10,
    tp1SlMode: 'no_move',
    bePlusBufferPct: 0.10,
    decisionTf: '240m',
    cronRealistic: true,
  };
  const r = await runBacktest(makeStrat(), settings);
  const trades = r.trades.map(t => ({ pnlR: t.pnlR, exitTs: t.exitTs }));
  return { row: summarize(label, windowName, trades), trades };
}

function fmt(n: number, d = 2): string { return (n >= 0 ? '' : '') + n.toFixed(d); }

function printRows(rows: Row[]) {
  console.log(`\n  ${'variant'.padEnd(20)} ${'window'.padEnd(14)} ${'n'.padStart(4)} ${'WR%'.padStart(6)} ${'PF'.padStart(6)} ${'sumR'.padStart(8)} ${'ret%'.padStart(8)} ${'MaxDD%'.padStart(8)} ${'w24DD%'.padStart(8)}  drop/dropSumR`);
  console.log('  ' + '─'.repeat(118));
  for (const r of rows) {
    const drop = r.dropped != null ? `${r.dropped} / ${r.droppedSumR != null ? fmt(r.droppedSumR, 2) + 'R' : '?'}` : '';
    console.log(`  ${r.variant.padEnd(20)} ${r.window.padEnd(14)} ${String(r.n).padStart(4)} ${fmt(r.wrPct, 1).padStart(6)} ${(r.pf === 99 ? '∞' : fmt(r.pf, 2)).padStart(6)} ${fmt(r.sumR, 2).padStart(8)} ${fmt(r.retPct, 1).padStart(8)} ${fmt(r.maxDDPct, 2).padStart(8)} ${fmt(r.worst24hDDPct, 2).padStart(8)}  ${drop}`);
  }
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const series = await loadCvd();
  console.log(`\nCVD: ${series.ts.length} bars  ${new Date(series.ts[0]).toISOString().slice(0, 10)} → ${new Date(series.ts[series.ts.length - 1]).toISOString().slice(0, 10)}  exch=${EXCHANGES}  zWin=${Z_WINDOW}`);

  const now = Date.now();
  const D = 24 * 3600_000;
  // Windows: recent 183d (OOS), older 183d (IS), full 365d, + 3 rolling ~120d windows.
  const windows: { name: string; startTs: number; endTs: number }[] = [
    { name: 'full-365d', startTs: now - 365 * D, endTs: now },
    { name: 'IS-old183d', startTs: now - 366 * D, endTs: now - 183 * D },
    { name: 'OOS-rec183d', startTs: now - 183 * D, endTs: now },
    { name: 'WF1-0..120', startTs: now - 365 * D, endTs: now - 245 * D },
    { name: 'WF2-120..240', startTs: now - 245 * D, endTs: now - 125 * D },
    { name: 'WF3-240..365', startTs: now - 125 * D, endTs: now },
  ];

  const baseStrat = () => lsTopPositionFade({
    pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,
    slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK_PCT,
  });

  const T_VALUES = [1.0, 0.5, 1.5];

  for (const w of windows) {
    console.log(`\n══════════════════════════════════════════════════════════════════════════════`);
    console.log(`  WINDOW ${w.name}  ${new Date(w.startTs).toISOString().slice(0, 10)} → ${new Date(w.endTs).toISOString().slice(0, 10)}`);
    console.log(`══════════════════════════════════════════════════════════════════════════════`);
    const rows: Row[] = [];

    // BASE (no filter)
    const base = await runVariant('BASE', w.name, w.startTs, w.endTs, baseStrat);
    rows.push(base.row);

    for (const T of T_VALUES) {
      // FILTERED (drop opposing)
      const fStats: WrapStats = { seenEnter: 0, opposed: 0, passed: 0 };
      const filt = await runVariant(`FILT-T${T}`, w.name, w.startTs, w.endTs,
        () => wrap(baseStrat(), series, T, 'filter', fStats));
      // DROPPED-only (keep opposing) — realized R of the dropped set AFTER SL/TP packaging
      const dStats: WrapStats = { seenEnter: 0, opposed: 0, passed: 0 };
      const dropped = await runVariant(`DROP-T${T}`, w.name, w.startTs, w.endTs,
        () => wrap(baseStrat(), series, T, 'dropped', dStats));
      filt.row.dropped = dropped.row.n;
      filt.row.droppedSumR = dropped.row.sumR;
      rows.push(filt.row);
      // store dropped-set as its own row for visibility (realized R after packaging)
      dropped.row.variant = `  └dropped-T${T}`;
      rows.push(dropped.row);
    }
    printRows(rows);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
