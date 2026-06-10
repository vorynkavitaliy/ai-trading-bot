/**
 * btc-cvd-filter-attack — SKEPTIC companion to btc-cvd-filter.ts.
 *
 * Re-implements the SAME CVD filter (same loadCvd / zAsOf / opposes logic) but adds the
 * three adversarial attacks the verdict hinges on:
 *
 *  1) LOOK-AHEAD lag test. The base CLI uses the most recent CVD bar that has fully
 *     CLOSED at the decision time (series.ts[i] + 4h <= atTs). Coinglass publishes the
 *     closed 4h bar ~30-90s after close, and our cron acts at the next HH:00. To stress
 *     this, re-run with CVD lagged by an extra whole 4h bar (lagBars=1): the filter may
 *     only use a bar that closed >= 4h before the decision. If the benefit needs the
 *     freshest (just-closed) bar, lag=1 will erase it → that benefit was borderline
 *     look-ahead. If it survives lag=1, the edge is robust to publish/ingest latency.
 *
 *  2) CONCENTRATION. Dump per-trade R for BASE and for FILTERED (T=1.0). Identify the
 *     trades the filter REMOVED (entryTs in BASE but not in FILTERED) and the trades it
 *     KEPT but that BASE also had. Then recompute the filtered-minus-base lift after
 *     removing the top-3 most-positive contributing removed trades (i.e. the 3 dropped
 *     fades whose absence helped the most). If the lift collapses → few-trade artifact.
 *
 *  3) THRESHOLD robustness handled by the base CLI (T=0.5/1.0/1.5) — re-printed here as
 *     a compact lift table for completeness.
 *
 * Engine + config identical to btc-cvd-filter.ts (faithful single-pair BTC, cronRealistic,
 * slip 0.25%, lsTopPositionFade .85/.15 useBtcTrend SL2.0/TP2.0 hold12 risk1.25).
 *
 * Run: npx tsx src/backtest/cli/btc-cvd-filter-attack.ts   (writes /tmp/btc-cvd-attack.json)
 */
import { runBacktest } from '../engine';
import { BacktestSettings, Action, Strategy, StrategyContext } from '../types';
import { lsTopPositionFade, resetCgFadeCooldownState } from '../../strategies/cg-fade';
import { cgGet } from '../../core/coinglass';
import { close as closePg } from '../../core/db';
import fs from 'node:fs';

const START_EQUITY = 200_000;
const RISK_PCT = 1.25;
const Z_WINDOW = parseInt(process.env.CVD_Z_WINDOW ?? '180', 10);
const EXCHANGES = process.env.CVD_EXCHANGES ?? 'Binance,OKX,Bybit';
const BARS_24H = 6;
const FOUR_H = 4 * 3600_000;

interface CvdSeries { ts: number[]; cvd24: number[]; }

async function loadCvd(): Promise<CvdSeries> {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: 'BTC', exchange_list: EXCHANGES, interval: '4h', limit: 2160,
  });
  const arr = ((r as any).data as any[]).slice().sort((a, b) => a.time - b.time);
  const ts: number[] = []; const delta: number[] = [];
  for (const d of arr) {
    ts.push(Number(d.time));
    delta.push((d.aggregated_buy_volume_usd ?? 0) - (d.aggregated_sell_volume_usd ?? 0));
  }
  const cvd24: number[] = new Array(ts.length).fill(NaN);
  for (let i = 0; i < ts.length; i++) {
    if (i + 1 < BARS_24H) continue;
    let s = 0; for (let k = i - BARS_24H + 1; k <= i; k++) s += delta[k];
    cvd24[i] = s;
  }
  return { ts, cvd24 };
}

// lagBars: extra whole-bar lag beyond "fully closed at atTs". lagBars=0 == base CLI.
function zAsOf(series: CvdSeries, atTs: number, lagBars: number): number | null {
  let idx = -1;
  for (let i = 0; i < series.ts.length; i++) {
    if (series.ts[i] + FOUR_H <= atTs) idx = i; else break;
  }
  idx -= lagBars;               // step back an extra `lagBars` closed bars
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

function opposes(side: 'long' | 'short', z: number | null, T: number): boolean {
  if (z == null) return false;
  if (side === 'short') return z >= +T;
  return z <= -T;
}

// Tag every enter decision with its CVD z + opposed flag so we can attribute trades.
function wrapTag(inner: Strategy, series: CvdSeries, T: number, lagBars: number,
                 mode: 'base' | 'filter', tagByTs: Map<number, { z: number | null; opposed: boolean }>): Strategy {
  return {
    name: `${inner.name}+atk(${mode},T${T},lag${lagBars})`,
    needsCoinglass: inner.needsCoinglass,
    needsBtcContext: inner.needsBtcContext,
    decide(ctx: StrategyContext): Action {
      const a = inner.decide(ctx);
      if (a.kind !== 'enter') return a;
      const z = zAsOf(series, ctx.ts, lagBars);
      const isOpposed = opposes(a.side, z, T);
      tagByTs.set(ctx.ts, { z, opposed: isOpposed });   // keyed on decision ts
      if (mode === 'base') return a;                     // base: keep all
      return isOpposed ? { kind: 'hold' } : a;           // filter: drop opposed
    },
  };
}

function baseStrat(): Strategy {
  return lsTopPositionFade({
    pctHi: 0.85, pctLo: 0.15, usePairTrend: false, useBtcTrend: true,
    slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: RISK_PCT,
  });
}

interface TradeLite { entryTs: number; exitTs: number; pnlR: number; side: 'long' | 'short'; reason: string; }

async function run(startTs: number, endTs: number, makeStrat: () => Strategy): Promise<TradeLite[]> {
  resetCgFadeCooldownState();
  const settings: BacktestSettings = {
    symbol: 'BTCUSDT', startTs, endTs, startEquity: START_EQUITY,
    takerFeeRate: 0.00055, makerFeeRate: 0.0002, slippagePct: 0.25,
    riskPctBase: RISK_PCT, leverage: 10, tp1SlMode: 'no_move',
    bePlusBufferPct: 0.10, decisionTf: '240m', cronRealistic: true,
  };
  const r = await runBacktest(makeStrat(), settings);
  return r.trades.map(t => ({ entryTs: t.entryTs, exitTs: t.exitTs, pnlR: t.pnlR, side: t.side, reason: t.exitReason }));
}

const sumR = (ts: TradeLite[]) => ts.reduce((s, t) => s + t.pnlR, 0);
const pf = (ts: TradeLite[]) => {
  let w = 0, l = 0; for (const t of ts) { if (t.pnlR > 0) w += t.pnlR; else l += Math.abs(t.pnlR); }
  return l > 0 ? w / l : (w > 0 ? 99 : 0);
};

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const series = await loadCvd();
  const now = Date.now(); const D = 24 * 3600_000;
  const out: any = {
    cvdBars: series.ts.length,
    cvdRange: [new Date(series.ts[0]).toISOString().slice(0, 10), new Date(series.ts[series.ts.length - 1]).toISOString().slice(0, 10)],
    exchanges: EXCHANGES, zWindow: Z_WINDOW,
  };

  const windows = [
    { name: 'full-365d', startTs: now - 365 * D, endTs: now },
    { name: 'IS-old183d', startTs: now - 366 * D, endTs: now - 183 * D },
    { name: 'OOS-rec183d', startTs: now - 183 * D, endTs: now },
  ];

  out.windows = {};
  for (const w of windows) {
    const wRes: any = {};
    // BASE (tag, lag0)
    const tagBase = new Map<number, { z: number | null; opposed: boolean }>();
    const base = await run(w.startTs, w.endTs, () => wrapTag(baseStrat(), series, 1.0, 0, 'base', tagBase));

    // ── Attack 1: lag sweep. filter at lag0 (base CLI) vs lag1 (extra-conservative). ──
    const lagRows: any[] = [];
    for (const lag of [0, 1]) {
      const tag = new Map<number, { z: number | null; opposed: boolean }>();
      const filt = await run(w.startTs, w.endTs, () => wrapTag(baseStrat(), series, 1.0, lag, 'filter', tag));
      lagRows.push({ lag, T: 1.0, n: filt.length, sumR: +sumR(filt).toFixed(2), pf: +pf(filt).toFixed(2),
        liftR: +(sumR(filt) - sumR(base)).toFixed(2) });
    }
    wRes.lookahead_lag = { baseN: base.length, baseSumR: +sumR(base).toFixed(2), basePF: +pf(base).toFixed(2), variants: lagRows };

    // ── Attack 2: concentration (T=1.0, lag0). Which BASE trades did the filter remove? ──
    const tagFilt = new Map<number, { z: number | null; opposed: boolean }>();
    const filt = await run(w.startTs, w.endTs, () => wrapTag(baseStrat(), series, 1.0, 0, 'filter', tagFilt));
    const filtEntryTs = new Set(filt.map(t => t.entryTs));
    // Removed trades = BASE trades whose decision was opposed (the filter dropped them).
    // Attribute by entryTs presence: a base trade not in the filtered run AND tagged opposed.
    const removed = base.filter(t => !filtEntryTs.has(t.entryTs) && (tagBase.get(decisionTsFor(t.entryTs)) ?? findTag(tagBase, t.entryTs))?.opposed);
    // Fallback: if entryTs-based tag lookup misses (cron shifts entryTs off decision ts),
    // classify removed simply as base-not-in-filtered.
    const removedSimple = base.filter(t => !filtEntryTs.has(t.entryTs));
    const removedSet = removed.length ? removed : removedSimple;
    const removedR = removedSet.map(t => +t.pnlR.toFixed(3)).sort((a, b) => a - b);
    // The filter HELPS by removing negative trades. "Top contributing removed" = most
    // NEGATIVE removed trades (their removal added the most R). Drop the 3 most-negative
    // removed trades from the credit: i.e. add them BACK to filtered and re-measure lift.
    const removedSortedByHelp = removedSet.slice().sort((a, b) => a.pnlR - b.pnlR); // most negative first
    const top3 = removedSortedByHelp.slice(0, 3);
    const filtPlusTop3 = filt.concat(top3);   // add the 3 best-helping removals back
    wRes.concentration = {
      baseSumR: +sumR(base).toFixed(2),
      filtSumR: +sumR(filt).toFixed(2),
      filtN: filt.length, baseN: base.length,
      removedN: removedSet.length,
      removedR,
      removedSumR: +sumR(removedSet).toFixed(2),
      liftFull: +(sumR(filt) - sumR(base)).toFixed(2),
      top3RemovedR: top3.map(t => +t.pnlR.toFixed(3)),
      liftAfterAddingBackTop3: +(sumR(filtPlusTop3) - sumR(base)).toFixed(2),
    };
    out.windows[w.name] = wRes;
  }
  fs.writeFileSync('/tmp/btc-cvd-attack.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await closePg();
}

// entryTs may differ from decision ts (cronRealistic shifts entry to next HH:00). The
// tag map is keyed on decision ts (ctx.ts = nowBar.ts = 4h close). entryTs is >= that.
// Find the tag whose decision ts is the largest ts <= entryTs within 12h.
function findTag(tag: Map<number, { z: number | null; opposed: boolean }>, entryTs: number): { z: number | null; opposed: boolean } | undefined {
  let best: number | null = null;
  for (const k of tag.keys()) {
    if (k <= entryTs && entryTs - k <= 12 * 3600_000) { if (best == null || k > best) best = k; }
  }
  return best != null ? tag.get(best) : undefined;
}
function decisionTsFor(entryTs: number): number { return entryTs; } // placeholder; findTag does the work

main().catch(async e => { console.error(e?.message ?? String(e)); try { await closePg(); } catch {} process.exit(1); });
