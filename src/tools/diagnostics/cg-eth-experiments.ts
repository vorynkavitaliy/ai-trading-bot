/**
 * ETH experimental strategy search — broad sweep.
 *
 * Goal: find a strategy with ALL 4 QUARTERS positive on 365d (the bar that BTC champion
 * cleared but the F+TA confluence ETH config did NOT).
 *
 * Strategies tested:
 *   1. Inverse L/S (momentum-follow extreme) — opposite of fade
 *   2. Taker buy/sell delta extreme (taker exhaustion → reverse)
 *   3. OI divergence (price flat + OI growing = squeeze setup)
 *   4. Trend EMA crossover (ETH trends well)
 *   5. BB squeeze breakout (low-vol expansion)
 *   6. Funding-only mean reversion with longer hold
 *   7. ETH/BTC ratio mean reversion (ETH lags/leads BTC)
 *
 * Reports per-quarter performance prominently.
 */
import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; o: number; h: number; l: number; c: number; v: number };
type SigPoint = { ts: number; v: number };
type TakerPoint = { ts: number; buy: number; sell: number };

const TAKER_FEE = 0.00055;
const MAKER_FEE = 0.0002;
const SL_SLIP = 0.0005;
const TIME_SLIP = 0.0005;
const FUNDING_PER_4H = 0.5;

interface Trade { side: 'long' | 'short'; pnlR: number; reason: 'sl' | 'tp' | 'time'; entryTs: number; }

function atr(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return 0;
  let s = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    s += Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  }
  return s / period;
}
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}
function stddev(values: number[], period: number): number | null {
  const m = sma(values, period);
  if (m == null) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += (values[i] - m) ** 2;
  return Math.sqrt(s / period);
}
function percentile(series: number[], v: number): number {
  let c = 0; for (const x of series) if (x <= v) c++; return c / series.length;
}
function nearestBefore<T extends { ts: number }>(s: T[], ts: number): T | null {
  let lo = 0, hi = s.length - 1, ans: T | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].ts <= ts) { ans = s[m]; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// Apply realistic exit costs given a closure event.
function closeTrade(
  pos: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number },
  exitPrice: number, isTaker: boolean, reason: 'sl' | 'tp' | 'time',
  fundingR: number,
): Trade {
  const risk = Math.abs(pos.entry - pos.sl);
  const pnlPrice = pos.side === 'long' ? exitPrice - pos.entry : pos.entry - exitPrice;
  const grossR = pnlPrice / risk;
  const feeR = (MAKER_FEE * pos.entry + (isTaker ? TAKER_FEE : MAKER_FEE) * exitPrice) / risk;
  const costR = feeR - fundingR;
  return { side: pos.side, pnlR: grossR - costR, reason, entryTs: pos.entryTs };
}

interface BaseParams {
  atrPeriod: number;
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldBars: number;
  pairTrendFilter: boolean;
  btcTrendFilter: boolean;
  emaFast: number;
  emaSlow: number;
}
const DEF: BaseParams = {
  atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
  pairTrendFilter: false, btcTrendFilter: false, emaFast: 20, emaSlow: 50,
};

function applyTrendFilters(side: 'long' | 'short', i: number, bars: Bar[], p: BaseParams, btcBars: Bar[]): boolean {
  if (p.pairTrendFilter) {
    const closes = bars.slice(Math.max(0, i - p.emaSlow * 3), i + 1).map(b => b.c);
    const eF = ema(closes, p.emaFast);
    const eS = ema(closes, p.emaSlow);
    if (eF == null || eS == null) return false;
    if (side === 'short' && eF > eS) return false;
    if (side === 'long' && eF <= eS) return false;
  }
  if (p.btcTrendFilter) {
    const ts = bars[i].ts;
    let bIdx = -1;
    for (let k = btcBars.length - 1; k >= 0; k--) { if (btcBars[k].ts <= ts) { bIdx = k; break; } }
    if (bIdx < p.emaSlow * 3) return false;
    const bC = btcBars.slice(Math.max(0, bIdx - p.emaSlow * 3), bIdx + 1).map(b => b.c);
    const bF = ema(bC, p.emaFast);
    const bS = ema(bC, p.emaSlow);
    if (bF == null || bS == null) return false;
    if (side === 'short' && bF > bS) return false;
    if (side === 'long' && bF <= bS) return false;
  }
  return true;
}

function resolveBar(bar: Bar, pos: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number }, held: number, maxHold: number, fundingR: number): Trade | null {
  const slHit = pos.side === 'long' ? bar.l <= pos.sl : bar.h >= pos.sl;
  const tpHit = pos.side === 'long' ? bar.h >= pos.tp : bar.l <= pos.tp;
  const tpFirst = pos.side === 'long' ? bar.c > bar.o : bar.c < bar.o;
  if (slHit && tpHit) {
    if (tpFirst) return closeTrade(pos, pos.tp, false, 'tp', fundingR);
    return closeTrade(pos, pos.side === 'long' ? pos.sl * (1 - SL_SLIP) : pos.sl * (1 + SL_SLIP), true, 'sl', fundingR);
  }
  if (slHit) return closeTrade(pos, pos.side === 'long' ? pos.sl * (1 - SL_SLIP) : pos.sl * (1 + SL_SLIP), true, 'sl', fundingR);
  if (tpHit) return closeTrade(pos, pos.tp, false, 'tp', fundingR);
  if (held >= maxHold) return closeTrade(pos, pos.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP), true, 'time', fundingR);
  return null;
}

function fundingRPerBar(side: 'long' | 'short', barTs: number, frHist: SigPoint[], entry: number, risk: number): number {
  const fr = nearestBefore(frHist, barTs);
  return fr ? (side === 'long' ? -1 : 1) * fr.v * FUNDING_PER_4H * (entry / risk) : 0;
}

// ============================================================================
// STRATEGY 1: Inverse L/S — momentum follow when crowd extreme (opposite of fade)
// ============================================================================
function strategyInverseLs(
  bars: Bar[], lsHist: SigPoint[], frHist: SigPoint[], btcBars: Bar[],
  pctHi: number, pctLo: number, p: BaseParams,
): Trade[] {
  const trades: Trade[] = [];
  let open: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number } | null = null;
  const lsVals = lsHist.map(x => x.v);
  const WINDOW = 180;
  for (let i = WINDOW + p.atrPeriod; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const fr = fundingRPerBar(open.side, bar.ts, frHist, open.entry, Math.abs(open.entry - open.sl));
      const closed = resolveBar(bar, open, i - open.idx, p.maxHoldBars, fr);
      if (closed) { trades.push(closed); open = null; }
    }
    if (open) continue;

    const lsAt = nearestBefore(lsHist, bar.ts);
    if (!lsAt) continue;
    const idx = lsHist.indexOf(lsAt);
    if (idx < WINDOW - 1) continue;
    const pct = percentile(lsVals.slice(idx - WINDOW + 1, idx + 1), lsAt.v);
    // INVERSE: extreme long = follow long; extreme short = follow short
    let side: 'long' | 'short' | null = null;
    if (pct >= pctHi) side = 'long';     // crowd long → go long (momentum follow)
    else if (pct <= pctLo) side = 'short';
    if (!side) continue;
    if (!applyTrendFilters(side, i, bars, p, btcBars)) continue;
    const a = atr(bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1), p.atrPeriod);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

// ============================================================================
// STRATEGY 2: Taker delta extreme (taker imbalance reversal)
// ============================================================================
function strategyTakerDelta(
  bars: Bar[], takerHist: TakerPoint[], frHist: SigPoint[], btcBars: Bar[],
  pctHi: number, pctLo: number, p: BaseParams,
): Trade[] {
  const trades: Trade[] = [];
  let open: any = null;
  const WINDOW = 180;
  const deltas = takerHist.map(t => (t.buy - t.sell) / (t.buy + t.sell + 1e-9));
  for (let i = WINDOW + p.atrPeriod; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const fr = fundingRPerBar(open.side, bar.ts, frHist, open.entry, Math.abs(open.entry - open.sl));
      const closed = resolveBar(bar, open, i - open.idx, p.maxHoldBars, fr);
      if (closed) { trades.push(closed); open = null; }
    }
    if (open) continue;
    let tkIdx = -1;
    for (let k = takerHist.length - 1; k >= 0; k--) { if (takerHist[k].ts <= bar.ts) { tkIdx = k; break; } }
    if (tkIdx < WINDOW - 1) continue;
    const pct = percentile(deltas.slice(tkIdx - WINDOW + 1, tkIdx + 1), deltas[tkIdx]);
    // FADE taker extreme: big buy taker delta = buying exhausted = reverse short
    let side: 'long' | 'short' | null = null;
    if (pct >= pctHi) side = 'short';
    else if (pct <= pctLo) side = 'long';
    if (!side) continue;
    if (!applyTrendFilters(side, i, bars, p, btcBars)) continue;
    const a = atr(bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1), p.atrPeriod);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

// ============================================================================
// STRATEGY 3: BB squeeze breakout (volatility expansion)
// ============================================================================
function strategyBbBreakout(
  bars: Bar[], frHist: SigPoint[], btcBars: Bar[],
  bbPeriod: number, bbStdev: number, squeezeThresh: number, p: BaseParams,
): Trade[] {
  const trades: Trade[] = [];
  let open: any = null;
  for (let i = Math.max(bbPeriod + 5, p.atrPeriod * 2); i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const fr = fundingRPerBar(open.side, bar.ts, frHist, open.entry, Math.abs(open.entry - open.sl));
      const closed = resolveBar(bar, open, i - open.idx, p.maxHoldBars, fr);
      if (closed) { trades.push(closed); open = null; }
    }
    if (open) continue;
    const closes = bars.slice(Math.max(0, i - bbPeriod), i + 1).map(b => b.c);
    const mid = sma(closes, bbPeriod);
    const sd = stddev(closes, bbPeriod);
    if (mid == null || sd == null) continue;
    const upper = mid + bbStdev * sd;
    const lower = mid - bbStdev * sd;
    const bandwidth = (upper - lower) / mid;
    // Squeeze: low bandwidth → wait for breakout
    if (bandwidth > squeezeThresh) continue;
    // Breakout direction: close > upper → long; close < lower → short
    let side: 'long' | 'short' | null = null;
    if (bar.c > upper) side = 'long';
    else if (bar.c < lower) side = 'short';
    if (!side) continue;
    if (!applyTrendFilters(side, i, bars, p, btcBars)) continue;
    const a = atr(bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1), p.atrPeriod);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

// ============================================================================
// STRATEGY 4: EMA crossover trend follow
// ============================================================================
function strategyEmaTrend(
  bars: Bar[], frHist: SigPoint[], btcBars: Bar[],
  emaFast: number, emaSlow: number, p: BaseParams,
): Trade[] {
  const trades: Trade[] = [];
  let open: any = null;
  let prevTrend: 'up' | 'dn' | null = null;
  for (let i = emaSlow * 3; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const fr = fundingRPerBar(open.side, bar.ts, frHist, open.entry, Math.abs(open.entry - open.sl));
      const closed = resolveBar(bar, open, i - open.idx, p.maxHoldBars, fr);
      if (closed) { trades.push(closed); open = null; }
    }
    if (open) continue;
    const closes = bars.slice(Math.max(0, i - emaSlow * 3), i + 1).map(b => b.c);
    const eF = ema(closes, emaFast);
    const eS = ema(closes, emaSlow);
    if (eF == null || eS == null) continue;
    const trend = eF > eS ? 'up' : 'dn';
    let side: 'long' | 'short' | null = null;
    // Trade only on CROSSOVER (state change)
    if (prevTrend === 'dn' && trend === 'up') side = 'long';
    else if (prevTrend === 'up' && trend === 'dn') side = 'short';
    prevTrend = trend;
    if (!side) continue;
    if (!applyTrendFilters(side, i, bars, p, btcBars)) continue;
    const a = atr(bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1), p.atrPeriod);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

// ============================================================================
// STRATEGY 5: OI accumulation/distribution
// ============================================================================
function strategyOiDivergence(
  bars: Bar[], oiHist: SigPoint[], frHist: SigPoint[], btcBars: Bar[],
  oiDeltaPct: number, p: BaseParams,
): Trade[] {
  const trades: Trade[] = [];
  let open: any = null;
  const ONE_DAY = 86_400_000;
  for (let i = p.atrPeriod * 2; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const fr = fundingRPerBar(open.side, bar.ts, frHist, open.entry, Math.abs(open.entry - open.sl));
      const closed = resolveBar(bar, open, i - open.idx, p.maxHoldBars, fr);
      if (closed) { trades.push(closed); open = null; }
    }
    if (open) continue;
    const oiNow = nearestBefore(oiHist, bar.ts);
    const oi24 = nearestBefore(oiHist, bar.ts - ONE_DAY);
    if (!oiNow || !oi24 || oi24.v <= 0) continue;
    const oiPct = ((oiNow.v - oi24.v) / oi24.v) * 100;
    // Price change over same 24h
    let p24idx = -1;
    for (let k = i - 1; k >= 0; k--) { if (bars[k].ts <= bar.ts - ONE_DAY) { p24idx = k; break; } }
    if (p24idx < 0) continue;
    const pricePct = ((bar.c - bars[p24idx].c) / bars[p24idx].c) * 100;
    // Divergence: OI up sharply + price flat → squeeze pending; direction = OPPOSITE of price trend
    let side: 'long' | 'short' | null = null;
    if (oiPct >= oiDeltaPct && Math.abs(pricePct) < 2.0) {
      // OI accumulating, price flat — fade the dominant funding side
      const fr = nearestBefore(frHist, bar.ts);
      if (!fr) continue;
      side = fr.v > 0 ? 'short' : 'long';   // funding positive = longs paying = fade short
    }
    if (!side) continue;
    if (!applyTrendFilters(side, i, bars, p, btcBars)) continue;
    const a = atr(bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1), p.atrPeriod);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

function metrics(trades: Trade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, avgR: 0, sumR: 0, pf: 0, longs: 0, shorts: 0 };
  const wins = trades.filter(t => t.pnlR > 0);
  const losses = trades.filter(t => t.pnlR < 0);
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const sumW = wins.reduce((s, t) => s + t.pnlR, 0);
  const sumL = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
  return {
    n: trades.length, wr: wins.length / trades.length * 100, avgR: sumR / trades.length, sumR,
    pf: sumL > 0 ? sumW / sumL : Infinity,
    longs: trades.filter(t => t.side === 'long').length,
    shorts: trades.filter(t => t.side === 'short').length,
  };
}

function perQuarter(trades: Trade[], firstTs: number, lastTs: number): number[] {
  const span = lastTs - firstTs;
  const out: number[] = [];
  for (let q = 0; q < 4; q++) {
    const qS = firstTs + q * Math.floor(span / 4);
    const qE = q === 3 ? lastTs : firstTs + (q + 1) * Math.floor(span / 4);
    const qT = trades.filter(t => t.entryTs >= qS && t.entryTs < qE);
    const m = metrics(qT);
    out.push(m.sumR);
  }
  return out;
}

async function main() {
  const bars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text, volume::text FROM candles WHERE symbol='ETHUSDT' AND tf='240m' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume) }));
  const btcBars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text, volume::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume) }));
  const frHist: SigPoint[] = (await query<any>(
    `SELECT ts::text, fr_close::text AS v FROM cg_funding_oi_weighted WHERE symbol='ETH' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), v: Number(r.v) }));
  const lsTopAcc: SigPoint[] = (await query<any>(
    `SELECT ts::text, ratio::text AS v FROM cg_ls_top_account WHERE pair='ETHUSDT' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), v: Number(r.v) }));
  const lsGlobalAcc: SigPoint[] = (await query<any>(
    `SELECT ts::text, ratio::text AS v FROM cg_ls_global_account WHERE pair='ETHUSDT' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), v: Number(r.v) }));
  const oiHist: SigPoint[] = (await query<any>(
    `SELECT ts::text, oi_close::text AS v FROM cg_oi_aggregated WHERE symbol='ETH' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), v: Number(r.v) }));
  const takerHist: TakerPoint[] = (await query<any>(
    `SELECT ts::text, buy_usd::text AS buy, sell_usd::text AS sell FROM cg_taker_pair WHERE pair='ETHUSDT' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), buy: Number(r.buy), sell: Number(r.sell) }));

  console.log(`ETHUSDT 4H bars: ${bars.length}  funding: ${frHist.length}  LS TA: ${lsTopAcc.length}  LS GA: ${lsGlobalAcc.length}  OI: ${oiHist.length}  taker: ${takerHist.length}`);
  const cgFirst = frHist[0]?.ts ?? bars[0].ts;
  const cgLast = frHist[frHist.length - 1]?.ts ?? bars[bars.length - 1].ts;

  const TRENDS = { pairTrendFilter: true, btcTrendFilter: true };
  const NO_TREND = { pairTrendFilter: false, btcTrendFilter: false };

  type V = { name: string; trades: Trade[] };
  const results: V[] = [];

  // STRATEGY 1: Inverse L/S (momentum follow)
  results.push({ name: 'INV-LS top_acc 0.85/0.15 +trends ', trades: strategyInverseLs(bars, lsTopAcc, frHist, btcBars, 0.85, 0.15, { ...DEF, ...TRENDS }) });
  results.push({ name: 'INV-LS top_acc 0.90/0.10 +trends ', trades: strategyInverseLs(bars, lsTopAcc, frHist, btcBars, 0.90, 0.10, { ...DEF, ...TRENDS }) });
  results.push({ name: 'INV-LS global 0.85/0.15 +trends  ', trades: strategyInverseLs(bars, lsGlobalAcc, frHist, btcBars, 0.85, 0.15, { ...DEF, ...TRENDS }) });
  results.push({ name: 'INV-LS global 0.90/0.10 +trends  ', trades: strategyInverseLs(bars, lsGlobalAcc, frHist, btcBars, 0.90, 0.10, { ...DEF, ...TRENDS }) });
  results.push({ name: 'INV-LS top_acc no trends         ', trades: strategyInverseLs(bars, lsTopAcc, frHist, btcBars, 0.85, 0.15, { ...DEF, ...NO_TREND }) });

  // STRATEGY 2: Taker delta fade
  results.push({ name: 'TAKER fade 0.85/0.15             ', trades: strategyTakerDelta(bars, takerHist, frHist, btcBars, 0.85, 0.15, { ...DEF, ...NO_TREND }) });
  results.push({ name: 'TAKER fade 0.85/0.15 +trends     ', trades: strategyTakerDelta(bars, takerHist, frHist, btcBars, 0.85, 0.15, { ...DEF, ...TRENDS }) });
  results.push({ name: 'TAKER fade 0.90/0.10 +trends     ', trades: strategyTakerDelta(bars, takerHist, frHist, btcBars, 0.90, 0.10, { ...DEF, ...TRENDS }) });
  results.push({ name: 'TAKER fade 0.95/0.05 +trends     ', trades: strategyTakerDelta(bars, takerHist, frHist, btcBars, 0.95, 0.05, { ...DEF, ...TRENDS }) });
  results.push({ name: 'TAKER fade 0.75/0.25 +trends     ', trades: strategyTakerDelta(bars, takerHist, frHist, btcBars, 0.75, 0.25, { ...DEF, ...TRENDS }) });

  // STRATEGY 3: BB squeeze breakout — round 1
  results.push({ name: 'BB squeeze 20×2 thr0.05 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 20, 2, 0.05, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 20×2 thr0.04 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 20, 2, 0.04, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 30×2 thr0.05 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, ...TRENDS }) });
  // STRATEGY 3: BB squeeze breakout — round 2 (calibration around champion)
  results.push({ name: 'BB squeeze 30×2 thr0.06 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.06, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 30×2 thr0.07 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.07, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 30×2 thr0.04 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.04, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 40×2 thr0.05 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 40, 2, 0.05, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 40×2 thr0.06 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 40, 2, 0.06, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 50×2 thr0.05 +trends  ', trades: strategyBbBreakout(bars, frHist, btcBars, 50, 2, 0.05, { ...DEF, ...TRENDS }) });
  // Tighter stddev (less squeeze required)
  results.push({ name: 'BB squeeze 30×1.5 thr0.05 +trends', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 1.5, 0.05, { ...DEF, ...TRENDS }) });
  results.push({ name: 'BB squeeze 30×2.5 thr0.05 +trends', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2.5, 0.05, { ...DEF, ...TRENDS }) });
  // Different SL/TP
  results.push({ name: 'BB 30×2 thr0.05 SL2/TP3 +trends ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, slAtrMult: 2.0, tpAtrMult: 3.0, ...TRENDS }) });
  results.push({ name: 'BB 30×2 thr0.05 SL1/TP2 +trends ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, slAtrMult: 1.0, tpAtrMult: 2.0, ...TRENDS }) });
  results.push({ name: 'BB 30×2 thr0.05 SL1.5/TP3 +trends', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, slAtrMult: 1.5, tpAtrMult: 3.0, ...TRENDS }) });
  // Different hold
  results.push({ name: 'BB 30×2 thr0.05 hold18 +trends   ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, maxHoldBars: 18, ...TRENDS }) });
  results.push({ name: 'BB 30×2 thr0.05 hold8 +trends    ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, maxHoldBars: 8, ...TRENDS }) });
  results.push({ name: 'BB 30×2 thr0.05 hold24 +trends   ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, maxHoldBars: 24, ...TRENDS }) });
  // Without trend filters
  results.push({ name: 'BB 30×2 thr0.05 NO trends        ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, ...NO_TREND }) });
  results.push({ name: 'BB 30×2 thr0.05 +BTC only        ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, btcTrendFilter: true }) });
  results.push({ name: 'BB 30×2 thr0.05 +pair only       ', trades: strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, pairTrendFilter: true }) });

  // STRATEGY 4: EMA crossover trend follow
  results.push({ name: 'EMA cross 20/50                  ', trades: strategyEmaTrend(bars, frHist, btcBars, 20, 50, { ...DEF, ...NO_TREND }) });
  results.push({ name: 'EMA cross 10/30                  ', trades: strategyEmaTrend(bars, frHist, btcBars, 10, 30, { ...DEF, ...NO_TREND }) });
  results.push({ name: 'EMA cross 20/50 +BTC trend       ', trades: strategyEmaTrend(bars, frHist, btcBars, 20, 50, { ...DEF, btcTrendFilter: true }) });

  // STRATEGY 5: OI divergence
  results.push({ name: 'OI div 3% +trends                ', trades: strategyOiDivergence(bars, oiHist, frHist, btcBars, 3.0, { ...DEF, ...TRENDS }) });
  results.push({ name: 'OI div 5% +trends                ', trades: strategyOiDivergence(bars, oiHist, frHist, btcBars, 5.0, { ...DEF, ...TRENDS }) });
  results.push({ name: 'OI div 7% +trends                ', trades: strategyOiDivergence(bars, oiHist, frHist, btcBars, 7.0, { ...DEF, ...TRENDS }) });

  // Display sorted by `consistency score` = how many quarters positive (4 max) ties broken by sumR
  console.log('\n=== ETH experimental sweep — sorted by per-quarter stability ===');
  console.log('name                              |  n   WR%   sumR    PF    | Q1     Q2     Q3     Q4    | +Q');
  console.log('---------------------------------------------------------------------------');
  type Out = { name: string; m: any; q: number[]; pq: number };
  const sortable: Out[] = results.map(r => {
    const m = metrics(r.trades);
    const q = perQuarter(r.trades, cgFirst, cgLast);
    const pq = q.filter(x => x > 0).length;
    return { name: r.name, m, q, pq };
  }).filter(x => x.m.n >= 20);
  sortable.sort((a, b) => b.pq - a.pq || b.m.sumR - a.m.sumR);
  for (const r of sortable) {
    const qstr = r.q.map(x => x.toFixed(1).padStart(5)).join('  ');
    console.log(
      `${r.name}| ${String(r.m.n).padStart(3)}  ${r.m.wr.toFixed(1).padStart(4)}% ${r.m.sumR.toFixed(2).padStart(6)} ${r.m.pf.toFixed(2).padStart(5)}  | ${qstr}  | ${r.pq}/4`
    );
  }

  // =============================================================
  // DEEP WALK-FORWARD on BB squeeze champion: SL 1.0 / TP 2.0
  // =============================================================
  console.log('\n=== ETH BB CHAMPION DEEP-DIVE (30×2 thr0.05 SL1/TP2 +trends) ===');
  const champTrades = strategyBbBreakout(bars, frHist, btcBars, 30, 2, 0.05, { ...DEF, slAtrMult: 1.0, tpAtrMult: 2.0, ...TRENDS });
  const cm = metrics(champTrades);
  console.log(`Trades: ${cm.n}  WR: ${cm.wr.toFixed(1)}%  avgR: ${cm.avgR.toFixed(3)}  sumR: ${cm.sumR.toFixed(2)}  PF: ${cm.pf.toFixed(2)}  L/S: ${cm.longs}/${cm.shorts}`);

  // Data range for splits (use BTC bars since strategy doesn't need CG, but trend filter needs BTC)
  const dataFirst = bars[0].ts;
  const dataLast = bars[bars.length - 1].ts;
  // Use CG range for fair comparison with BTC champion analysis
  const wfFirst = cgFirst;
  const wfLast = cgLast;
  const span = wfLast - wfFirst;
  console.log(`Range: ${new Date(wfFirst).toISOString().slice(0,10)} → ${new Date(wfLast).toISOString().slice(0,10)}`);

  // A. Anchored train/test splits
  console.log('\n--- A. Anchored train/test splits ---');
  console.log('  split   | IS trades  WR    sumR    avgR  |  OOS trades  WR    sumR    avgR  | IS-OOS gap');
  for (const ratio of [0.5, 0.6, 0.7, 0.8]) {
    const splitTs = wfFirst + Math.floor(span * ratio);
    const isT  = champTrades.filter(t => t.entryTs <  splitTs);
    const oosT = champTrades.filter(t => t.entryTs >= splitTs);
    const mi = metrics(isT), mo = metrics(oosT);
    const gap = mi.avgR - mo.avgR;
    const gapMark = Math.abs(gap) < 0.10 ? '✓' : Math.abs(gap) < 0.20 ? '~' : '✗';
    console.log(
      `  ${ratio.toFixed(1)}/${(1-ratio).toFixed(1)}   | ${String(mi.n).padStart(3)}  ${mi.wr.toFixed(1).padStart(4)}% ${mi.sumR.toFixed(2).padStart(7)} ${mi.avgR.toFixed(3).padStart(6)}  | ${String(mo.n).padStart(4)}    ${mo.wr.toFixed(1).padStart(4)}% ${mo.sumR.toFixed(2).padStart(7)} ${mo.avgR.toFixed(3).padStart(6)}  | ${gap.toFixed(3)} ${gapMark}`
    );
  }

  // B. Rolling walk-forward
  console.log('\n--- B. Rolling walk-forward (test 1 month after) ---');
  console.log('  test period          | OOS trades OOS WR  OOS sumR  | stable?');
  const monthMs = Math.floor(span / 12);
  for (let m = 6; m < 12; m++) {
    const tEnd = wfFirst + Math.floor(m * monthMs);
    const tNext = Math.min(wfLast, tEnd + monthMs);
    const oosT = champTrades.filter(t => t.entryTs >= tEnd && t.entryTs < tNext);
    const mo = metrics(oosT);
    const stable = mo.sumR >= 0 ? '✓' : '✗';
    const label = `${new Date(tEnd).toISOString().slice(0,7)} → ${new Date(tNext).toISOString().slice(0,7)}`;
    console.log(
      `  ${label.padEnd(20)} | ${String(mo.n).padStart(4)}      ${mo.wr.toFixed(1).padStart(4)}%   ${mo.sumR.toFixed(2).padStart(7)}  | ${stable}`
    );
  }

  // C. Per-quarter detail (already shown in grid but with R-by-R)
  console.log('\n--- C. Per-quarter detail ---');
  console.log('  quarter             | trades  WR     sumR    avgR    PF');
  const qStep = Math.floor(span / 4);
  for (let q = 0; q < 4; q++) {
    const qS = wfFirst + q * qStep;
    const qE = q === 3 ? wfLast : wfFirst + (q + 1) * qStep;
    const qT = champTrades.filter(t => t.entryTs >= qS && t.entryTs < qE);
    const mq = metrics(qT);
    const label = `${new Date(qS).toISOString().slice(0,7)} → ${new Date(qE).toISOString().slice(0,7)}`;
    console.log(
      `  ${label.padEnd(20)} | ${String(mq.n).padStart(3)}     ${mq.wr.toFixed(1).padStart(4)}% ${mq.sumR.toFixed(2).padStart(7)} ${mq.avgR.toFixed(3).padStart(7)} ${mq.pf.toFixed(2).padStart(5)}`
    );
  }

  // D. Risk × equity table
  console.log('\n--- D. Risk scenarios (compounding, $50k start) ---');
  console.log('risk%  | finalEq    return%   MaxDD%   maxConsL  maxConsW');
  const sorted = [...champTrades].sort((a, b) => a.entryTs - b.entryTs);
  for (const risk of [0.25, 0.375, 0.5, 0.75, 1.0]) {
    let eq = 50_000, peak = 50_000, maxDD = 0, cL = 0, cW = 0, mcL = 0, mcW = 0;
    for (const t of sorted) {
      eq += t.pnlR * eq * (risk / 100);
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak * 100;
      if (dd > maxDD) maxDD = dd;
      if (t.pnlR > 0) { cW++; cL = 0; if (cW > mcW) mcW = cW; }
      else if (t.pnlR < 0) { cL++; cW = 0; if (cL > mcL) mcL = cL; }
    }
    const ret = (eq - 50_000) / 50_000 * 100;
    console.log(
      `${risk.toFixed(3).padStart(5)}  | $${eq.toFixed(0).padStart(8)}  ${ret.toFixed(2).padStart(6)}%   ${maxDD.toFixed(2).padStart(5)}%   ${String(mcL).padStart(8)}  ${String(mcW).padStart(8)}`
    );
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
