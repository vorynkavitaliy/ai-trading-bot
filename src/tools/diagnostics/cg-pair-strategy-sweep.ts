/**
 * Pair × Strategy sweep — find which pair-strategy combos have edge.
 *
 * Tests 6 strategies on all pairs with full CG history (13 pairs).
 * All trades constrained to CG range (last 365d) for honest comparison.
 *
 * Output: per pair, the top 2 configs sorted by per-quarter consistency + sumR.
 *
 * Strategies:
 *   S1. L/S Top Position fade + pair trend
 *   S2. L/S Top Position fade + BTC macro trend
 *   S3. Funding extreme fade + both trends + pct 0.75
 *   S4. F+TA confluence (2 of 2) + both trends + pct 0.70
 *   S5. BB squeeze 30×2 thr0.05 SL1/TP2 + both trends
 *   S6. Inverse L/S (momentum follow) top_account + pair trend
 */
import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; o: number; h: number; l: number; c: number };
type SigPoint = { ts: number; v: number };

const TAKER_FEE = 0.00055;
const MAKER_FEE = 0.0002;
const SL_SLIP = 0.0005;
const TIME_SLIP = 0.0005;
const FUNDING_PER_4H = 0.5;
const WINDOW = 180;
const ATR_P = 14;

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
function pctOf(series: number[], v: number): number {
  let c = 0; for (const x of series) if (x <= v) c++; return c / series.length;
}
function nearestBefore<T extends { ts: number }>(s: T[], ts: number): T | null {
  let lo = 0, hi = s.length - 1, ans: T | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].ts <= ts) { ans = s[m]; lo = m + 1; } else hi = m - 1; }
  return ans;
}

interface Trade { side: 'long' | 'short'; pnlR: number; entryTs: number; }

function trendUp(closes: number[], fast: number, slow: number): boolean | null {
  const eF = ema(closes, fast);
  const eS = ema(closes, slow);
  if (eF == null || eS == null) return null;
  return eF > eS;
}

function fundingR(side: 'long' | 'short', barTs: number, frHist: SigPoint[], entry: number, risk: number): number {
  const fr = nearestBefore(frHist, barTs);
  return fr ? (side === 'long' ? -1 : 1) * fr.v * FUNDING_PER_4H * (entry / risk) : 0;
}

function closeAt(pos: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number }, exitPrice: number, isTaker: boolean, fundingAccrued: number): Trade {
  const risk = Math.abs(pos.entry - pos.sl);
  const pnlPrice = pos.side === 'long' ? exitPrice - pos.entry : pos.entry - exitPrice;
  const grossR = pnlPrice / risk;
  const feeR = (MAKER_FEE * pos.entry + (isTaker ? TAKER_FEE : MAKER_FEE) * exitPrice) / risk;
  return { side: pos.side, pnlR: grossR - feeR + fundingAccrued, entryTs: pos.entryTs };
}

function runFadeStrategy(
  bars: Bar[], sigHist: SigPoint[], frHist: SigPoint[], btcBars: Bar[],
  pctHi: number, pctLo: number, useBtcTrend: boolean, usePairTrend: boolean,
  slMult: number, tpMult: number, maxHold: number, inverse = false,
): Trade[] {
  const trades: Trade[] = [];
  let open: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number } | null = null;
  const sigVals = sigHist.map(x => x.v);
  for (let i = WINDOW + ATR_P; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const risk = Math.abs(open.entry - open.sl);
      const fR = fundingR(open.side, bar.ts, frHist, open.entry, risk);
      const slHit = open.side === 'long' ? bar.l <= open.sl : bar.h >= open.sl;
      const tpHit = open.side === 'long' ? bar.h >= open.tp : bar.l <= open.tp;
      const tpFirst = open.side === 'long' ? bar.c > bar.o : bar.c < bar.o;
      const held = i - open.idx;
      if (slHit && tpHit) {
        if (tpFirst) { trades.push(closeAt(open, open.tp, false, fR)); open = null; }
        else { trades.push(closeAt(open, open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, fR)); open = null; }
      } else if (slHit) { trades.push(closeAt(open, open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, fR)); open = null; }
      else if (tpHit) { trades.push(closeAt(open, open.tp, false, fR)); open = null; }
      else if (held >= maxHold) { trades.push(closeAt(open, open.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP), true, fR)); open = null; }
    }
    if (open) continue;

    const sigAt = nearestBefore(sigHist, bar.ts);
    if (!sigAt) continue;
    const idx = sigHist.indexOf(sigAt);
    if (idx < WINDOW - 1) continue;
    const pct = pctOf(sigVals.slice(idx - WINDOW + 1, idx + 1), sigAt.v);
    let side: 'long' | 'short' | null = null;
    if (!inverse) {
      if (pct >= pctHi) side = 'short'; else if (pct <= pctLo) side = 'long';
    } else {
      if (pct >= pctHi) side = 'long'; else if (pct <= pctLo) side = 'short';
    }
    if (!side) continue;

    if (usePairTrend) {
      const c = bars.slice(Math.max(0, i - 150), i + 1).map(b => b.c);
      const t = trendUp(c, 20, 50);
      if (t == null) continue;
      if (side === 'short' && t) continue;
      if (side === 'long' && !t) continue;
    }
    if (useBtcTrend) {
      let bIdx = -1;
      for (let k = btcBars.length - 1; k >= 0; k--) { if (btcBars[k].ts <= bar.ts) { bIdx = k; break; } }
      if (bIdx < 150) continue;
      const bc = btcBars.slice(Math.max(0, bIdx - 150), bIdx + 1).map(b => b.c);
      const t = trendUp(bc, 20, 50);
      if (t == null) continue;
      if (side === 'short' && t) continue;
      if (side === 'long' && !t) continue;
    }
    const a = atr(bars.slice(Math.max(0, i - ATR_P * 2), i + 1), ATR_P);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - slMult * a : bar.c + slMult * a;
    const tp = side === 'long' ? bar.c + tpMult * a : bar.c - tpMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

function runConfluence(
  bars: Bar[], frHist: SigPoint[], lsTopAcc: SigPoint[], btcBars: Bar[],
  pctHi: number, pctLo: number, slMult: number, tpMult: number, maxHold: number,
): Trade[] {
  const trades: Trade[] = [];
  let open: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number } | null = null;
  const frVals = frHist.map(x => x.v);
  const taVals = lsTopAcc.map(x => x.v);
  for (let i = WINDOW + ATR_P; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const risk = Math.abs(open.entry - open.sl);
      const fR = fundingR(open.side, bar.ts, frHist, open.entry, risk);
      const slHit = open.side === 'long' ? bar.l <= open.sl : bar.h >= open.sl;
      const tpHit = open.side === 'long' ? bar.h >= open.tp : bar.l <= open.tp;
      const tpFirst = open.side === 'long' ? bar.c > bar.o : bar.c < bar.o;
      const held = i - open.idx;
      if (slHit && tpHit) {
        if (tpFirst) { trades.push(closeAt(open, open.tp, false, fR)); open = null; }
        else { trades.push(closeAt(open, open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, fR)); open = null; }
      } else if (slHit) { trades.push(closeAt(open, open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, fR)); open = null; }
      else if (tpHit) { trades.push(closeAt(open, open.tp, false, fR)); open = null; }
      else if (held >= maxHold) { trades.push(closeAt(open, open.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP), true, fR)); open = null; }
    }
    if (open) continue;

    const frAt = nearestBefore(frHist, bar.ts);
    const taAt = nearestBefore(lsTopAcc, bar.ts);
    if (!frAt || !taAt) continue;
    const fIdx = frHist.indexOf(frAt);
    const tIdx = lsTopAcc.indexOf(taAt);
    if (fIdx < WINDOW - 1 || tIdx < WINDOW - 1) continue;
    const fPct = pctOf(frVals.slice(fIdx - WINDOW + 1, fIdx + 1), frAt.v);
    const tPct = pctOf(taVals.slice(tIdx - WINDOW + 1, tIdx + 1), taAt.v);
    let side: 'long' | 'short' | null = null;
    if (fPct >= pctHi && tPct >= pctHi) side = 'short';
    else if (fPct <= pctLo && tPct <= pctLo) side = 'long';
    if (!side) continue;

    const c = bars.slice(Math.max(0, i - 150), i + 1).map(b => b.c);
    const pt = trendUp(c, 20, 50);
    if (pt == null) continue;
    if (side === 'short' && pt) continue;
    if (side === 'long' && !pt) continue;
    let bIdx = -1;
    for (let k = btcBars.length - 1; k >= 0; k--) { if (btcBars[k].ts <= bar.ts) { bIdx = k; break; } }
    if (bIdx < 150) continue;
    const bc = btcBars.slice(Math.max(0, bIdx - 150), bIdx + 1).map(b => b.c);
    const bt = trendUp(bc, 20, 50);
    if (bt == null) continue;
    if (side === 'short' && bt) continue;
    if (side === 'long' && !bt) continue;

    const a = atr(bars.slice(Math.max(0, i - ATR_P * 2), i + 1), ATR_P);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - slMult * a : bar.c + slMult * a;
    const tp = side === 'long' ? bar.c + tpMult * a : bar.c - tpMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

function runBbSqueeze(
  bars: Bar[], frHist: SigPoint[], btcBars: Bar[],
  bbPer: number, bbStd: number, thr: number, slMult: number, tpMult: number, maxHold: number,
): Trade[] {
  const trades: Trade[] = [];
  let open: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number } | null = null;
  for (let i = Math.max(bbPer + 5, ATR_P * 2); i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const risk = Math.abs(open.entry - open.sl);
      const fR = fundingR(open.side, bar.ts, frHist, open.entry, risk);
      const slHit = open.side === 'long' ? bar.l <= open.sl : bar.h >= open.sl;
      const tpHit = open.side === 'long' ? bar.h >= open.tp : bar.l <= open.tp;
      const tpFirst = open.side === 'long' ? bar.c > bar.o : bar.c < bar.o;
      const held = i - open.idx;
      if (slHit && tpHit) {
        if (tpFirst) { trades.push(closeAt(open, open.tp, false, fR)); open = null; }
        else { trades.push(closeAt(open, open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, fR)); open = null; }
      } else if (slHit) { trades.push(closeAt(open, open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, fR)); open = null; }
      else if (tpHit) { trades.push(closeAt(open, open.tp, false, fR)); open = null; }
      else if (held >= maxHold) { trades.push(closeAt(open, open.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP), true, fR)); open = null; }
    }
    if (open) continue;
    const closes = bars.slice(Math.max(0, i - bbPer), i + 1).map(b => b.c);
    const mid = sma(closes, bbPer);
    const sd = stddev(closes, bbPer);
    if (mid == null || sd == null) continue;
    const upper = mid + bbStd * sd;
    const lower = mid - bbStd * sd;
    const bandwidth = (upper - lower) / mid;
    if (bandwidth > thr) continue;
    let side: 'long' | 'short' | null = null;
    if (bar.c > upper) side = 'long';
    else if (bar.c < lower) side = 'short';
    if (!side) continue;
    // BTC trend filter
    let bIdx = -1;
    for (let k = btcBars.length - 1; k >= 0; k--) { if (btcBars[k].ts <= bar.ts) { bIdx = k; break; } }
    if (bIdx < 150) continue;
    const bc = btcBars.slice(Math.max(0, bIdx - 150), bIdx + 1).map(b => b.c);
    const bt = trendUp(bc, 20, 50);
    if (bt == null) continue;
    if (side === 'short' && bt) continue;
    if (side === 'long' && !bt) continue;
    const a = atr(bars.slice(Math.max(0, i - ATR_P * 2), i + 1), ATR_P);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - slMult * a : bar.c + slMult * a;
    const tp = side === 'long' ? bar.c + tpMult * a : bar.c - tpMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

function metrics(trades: Trade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, sumR: 0, pf: 0 };
  const wins = trades.filter(t => t.pnlR > 0);
  const losses = trades.filter(t => t.pnlR < 0);
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const sumW = wins.reduce((s, t) => s + t.pnlR, 0);
  const sumL = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
  return { n: trades.length, wr: wins.length / trades.length * 100, sumR, pf: sumL > 0 ? sumW / sumL : Infinity };
}

function perQuarter(trades: Trade[], first: number, last: number): number[] {
  const span = last - first;
  const out: number[] = [];
  for (let q = 0; q < 4; q++) {
    const qS = first + q * Math.floor(span / 4);
    const qE = q === 3 ? last : first + (q + 1) * Math.floor(span / 4);
    const qT = trades.filter(t => t.entryTs >= qS && t.entryTs < qE);
    const m = metrics(qT);
    out.push(m.sumR);
  }
  return out;
}

async function loadBars(symbol: string): Promise<Bar[]> {
  const r = await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts`,
    [symbol]
  );
  return r.rows.map((x: any) => ({ ts: Number(x.ts), o: Number(x.open), h: Number(x.high), l: Number(x.low), c: Number(x.close) }));
}
async function loadSig(table: string, key: 'pair' | 'symbol', val: string, col: string): Promise<SigPoint[]> {
  const r = await query<any>(
    `SELECT ts::text, ${col}::text AS v FROM ${table} WHERE ${key}=$1 ORDER BY ts`,
    [val]
  );
  return r.rows.map((row: any) => ({ ts: Number(row.ts), v: Number(row.v) }));
}

async function main() {
  const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'LTCUSDT', 'TONUSDT', 'DOGEUSDT', 'APTUSDT', 'ARBUSDT', 'TAOUSDT', 'INJUSDT', 'ATOMUSDT'];
  const btcBars = await loadBars('BTCUSDT');

  console.log('PAIR | STRATEGY                        |  n   WR%   sumR    PF    | Q1     Q2     Q3     Q4    | +Q | $/y@0.5%');
  console.log('-'.repeat(120));

  type Row = { pair: string; strat: string; m: any; q: number[]; pq: number };
  const allRows: Row[] = [];

  for (const pair of PAIRS) {
    const coin = pair.replace(/USDT$/, '');
    const bars = await loadBars(pair);
    const lsTop = await loadSig('cg_ls_top_position', 'pair', pair, 'ratio');
    const lsTA = await loadSig('cg_ls_top_account', 'pair', pair, 'ratio');
    const fr = await loadSig('cg_funding_oi_weighted', 'symbol', coin, 'fr_close');
    if (lsTop.length === 0 || fr.length === 0) continue;

    const cgFirst = lsTop[0].ts;
    const cgLast = lsTop[lsTop.length - 1].ts;

    // Run 6 strategies — constrain trades to CG range
    const strategies: { name: string; trades: Trade[] }[] = [
      { name: 'S1: L/S TopPos fade +pair trend  ', trades: runFadeStrategy(bars, lsTop, fr, btcBars, 0.85, 0.15, false, true, 1.5, 2.0, 12) },
      { name: 'S2: L/S TopPos fade +BTC trend   ', trades: runFadeStrategy(bars, lsTop, fr, btcBars, 0.85, 0.15, true, false, 1.5, 2.0, 12) },
      { name: 'S3: Funding fade pct0.75 +trends ', trades: runFadeStrategy(bars, fr, fr, btcBars, 0.75, 0.25, true, true, 1.5, 2.0, 12) },
      { name: 'S4: F+TA conf pct0.70 +trends    ', trades: runConfluence(bars, fr, lsTA, btcBars, 0.70, 0.30, 1.5, 2.0, 12) },
      { name: 'S5: BB squeeze SL1/TP2 +BTC trend', trades: runBbSqueeze(bars, fr, btcBars, 30, 2, 0.05, 1.0, 2.0, 12) },
      { name: 'S6: Inverse-LS TopAcc 0.85       ', trades: runFadeStrategy(bars, lsTA, fr, btcBars, 0.85, 0.15, false, true, 1.5, 2.0, 12, true) },
    ];

    for (const s of strategies) {
      // Constrain to CG range only
      const cgTrades = s.trades.filter(t => t.entryTs >= cgFirst && t.entryTs <= cgLast);
      const m = metrics(cgTrades);
      if (m.n < 15) continue;  // skip too-few-trade configs (statistically meaningless)
      const q = perQuarter(cgTrades, cgFirst, cgLast);
      const pq = q.filter(x => x > 0).length;
      allRows.push({ pair, strat: s.name, m, q, pq });
    }
  }

  // Sort by per-pair: first by +Q desc, then sumR desc
  // But we want to see ALL good rows globally. Show only rows with PF >= 1.1 and sumR > 0
  const good = allRows.filter(r => r.m.pf >= 1.1 && r.m.sumR > 0).sort((a, b) => {
    if (a.pair !== b.pair) return a.pair.localeCompare(b.pair);
    return (b.pq - a.pq) || (b.m.sumR - a.m.sumR);
  });

  let lastPair = '';
  for (const r of good) {
    if (r.pair !== lastPair) { console.log(); lastPair = r.pair; }
    const qstr = r.q.map(x => x.toFixed(1).padStart(5)).join('  ');
    const dollar = (r.m.sumR * 0.005 * 50000).toFixed(0);
    console.log(
      `${r.pair.padEnd(8)} | ${r.strat}| ${String(r.m.n).padStart(3)}  ${r.m.wr.toFixed(1).padStart(4)}% ${r.m.sumR.toFixed(2).padStart(6)} ${r.m.pf.toFixed(2).padStart(5)}  | ${qstr}  | ${r.pq}/4 | $${dollar.padStart(6)}`
    );
  }

  // Summary: BEST per pair (1 config each)
  console.log('\n\n=== BEST CONFIG PER PAIR (by +Q then sumR) ===');
  const bestByPair = new Map<string, Row>();
  for (const r of good) {
    const cur = bestByPair.get(r.pair);
    if (!cur || r.pq > cur.pq || (r.pq === cur.pq && r.m.sumR > cur.m.sumR)) {
      bestByPair.set(r.pair, r);
    }
  }
  const sortedBest = Array.from(bestByPair.values()).sort((a, b) => (b.pq - a.pq) || (b.m.sumR - a.m.sumR));
  console.log('PAIR | STRATEGY                        |  n   WR%   sumR    PF    | +Q | $/y@0.5%');
  for (const r of sortedBest) {
    const dollar = (r.m.sumR * 0.005 * 50000).toFixed(0);
    console.log(`${r.pair.padEnd(8)} | ${r.strat}| ${String(r.m.n).padStart(3)}  ${r.m.wr.toFixed(1).padStart(4)}% ${r.m.sumR.toFixed(2).padStart(6)} ${r.m.pf.toFixed(2).padStart(5)}  | ${r.pq}/4 | $${dollar.padStart(6)}`);
  }

  // Aggregate if we ran top per pair (sumR sum)
  const totalR = sortedBest.reduce((s, r) => s + r.m.sumR, 0);
  const totalD = sortedBest.reduce((s, r) => s + r.m.sumR * 0.005 * 50000, 0);
  console.log(`\nIn-sample combined (0.5% each): sumR ${totalR.toFixed(1)}, total ~$${totalD.toFixed(0)}/yr on $50k base`);

  // ============================================================
  // WALK-FORWARD on best config per pair (50/50 train/test)
  // ============================================================
  console.log('\n\n=== WALK-FORWARD VALIDATION (train 50% / test 50%) ===');
  console.log('PAIR     | STRATEGY                        | IS  trades  WR   sumR   |  OOS trades  WR   sumR  | gap   | OOS stable?');
  console.log('-'.repeat(135));

  let passCount = 0;
  let totalOosR = 0;
  type WfRow = { pair: string; strat: string; isM: any; osM: any; gap: number; pass: boolean };
  const wfRows: WfRow[] = [];

  for (const r of sortedBest) {
    const pair = r.pair;
    const coin = pair.replace(/USDT$/, '');
    const bars = await loadBars(pair);
    const lsTop = await loadSig('cg_ls_top_position', 'pair', pair, 'ratio');
    const lsTA = await loadSig('cg_ls_top_account', 'pair', pair, 'ratio');
    const fr = await loadSig('cg_funding_oi_weighted', 'symbol', coin, 'fr_close');
    if (lsTop.length === 0 || fr.length === 0) continue;
    const cgFirst = lsTop[0].ts;
    const cgLast = lsTop[lsTop.length - 1].ts;
    const splitTs = cgFirst + Math.floor((cgLast - cgFirst) * 0.5);

    // Map strategy name -> rebuild trades with same config
    let trades: Trade[] = [];
    if (r.strat.includes('S1:')) trades = runFadeStrategy(bars, lsTop, fr, btcBars, 0.85, 0.15, false, true, 1.5, 2.0, 12);
    else if (r.strat.includes('S2:')) trades = runFadeStrategy(bars, lsTop, fr, btcBars, 0.85, 0.15, true, false, 1.5, 2.0, 12);
    else if (r.strat.includes('S3:')) trades = runFadeStrategy(bars, fr, fr, btcBars, 0.75, 0.25, true, true, 1.5, 2.0, 12);
    else if (r.strat.includes('S4:')) trades = runConfluence(bars, fr, lsTA, btcBars, 0.70, 0.30, 1.5, 2.0, 12);
    else if (r.strat.includes('S5:')) trades = runBbSqueeze(bars, fr, btcBars, 30, 2, 0.05, 1.0, 2.0, 12);
    else if (r.strat.includes('S6:')) trades = runFadeStrategy(bars, lsTA, fr, btcBars, 0.85, 0.15, false, true, 1.5, 2.0, 12, true);

    const cgTrades = trades.filter(t => t.entryTs >= cgFirst && t.entryTs <= cgLast);
    const isT = cgTrades.filter(t => t.entryTs < splitTs);
    const oosT = cgTrades.filter(t => t.entryTs >= splitTs);
    const isM = metrics(isT);
    const osM = metrics(oosT);
    const gap = (isM.sumR / Math.max(1, isM.n)) - (osM.sumR / Math.max(1, osM.n));
    const pass = osM.sumR > 0 && osM.n >= 10;
    wfRows.push({ pair, strat: r.strat, isM, osM, gap, pass });
    if (pass) passCount++;
    totalOosR += osM.sumR;
  }

  for (const w of wfRows) {
    const mark = w.pass ? '✓ pass' : w.osM.sumR > 0 ? '~ low-n' : '✗ fail';
    console.log(
      `${w.pair.padEnd(8)} | ${w.strat}| ${String(w.isM.n).padStart(3)}     ${w.isM.wr.toFixed(1).padStart(4)}% ${w.isM.sumR.toFixed(2).padStart(6)}  | ${String(w.osM.n).padStart(4)}     ${w.osM.wr.toFixed(1).padStart(4)}% ${w.osM.sumR.toFixed(2).padStart(6)}  | ${w.gap.toFixed(3).padStart(6)} | ${mark}`
    );
  }

  console.log(`\n=== WALK-FORWARD VERDICT ===`);
  console.log(`Pairs passing OOS test: ${passCount} / ${wfRows.length}`);
  console.log(`Total OOS sumR (= second 6 months): ${totalOosR.toFixed(2)}R`);
  const oosDollarRiskHalfYear = totalOosR * 0.005 * 50000;
  console.log(`On $50k @ 0.5% per pair, OOS half-year P&L: $${oosDollarRiskHalfYear.toFixed(0)}`);
  console.log(`Annualized projection (×2): $${(oosDollarRiskHalfYear * 2).toFixed(0)} = ${(oosDollarRiskHalfYear * 2 / 500).toFixed(1)}% on $50k`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
