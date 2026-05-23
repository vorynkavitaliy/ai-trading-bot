/**
 * ETH-specific strategy search. Try different CG signal sources to find an edge.
 *
 * Sources tested:
 *   ls_top_position  — whale positioning by size (what we used on BTC)
 *   ls_top_account   — top accounts by count
 *   ls_global_account — all (retail-heavy)
 *   funding_oi_weighted — funding rate (extreme = crowd one-sided)
 *
 * Same fade logic (extreme → fade), same SL/TP structure, same costs as champion.
 * Adds BTC trend filter — crucial for altcoins (alts follow BTC).
 */
import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; o: number; h: number; l: number; c: number };
type SigPoint = { ts: number; v: number };

const TAKER_FEE = 0.00055;
const MAKER_FEE = 0.0002;
const SL_SLIP = 0.0005;
const TIME_SLIP = 0.0005;
const FUNDING_PER_4H_FACTOR = 0.5;

interface Params {
  pctHi: number;
  pctLo: number;
  windowBars: number;
  atrPeriod: number;
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldBars: number;
  trendAlignment: boolean;
  emaFast: number;
  emaSlow: number;
  btcTrendFilter: boolean;
  btcEmaFast: number;
  btcEmaSlow: number;
}

function atr(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return 0;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    sum += tr;
  }
  return sum / period;
}
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function percentile(series: number[], value: number): number {
  let cnt = 0;
  for (const v of series) if (v <= value) cnt++;
  return cnt / series.length;
}
function nearestBefore<T extends { ts: number }>(series: T[], ts: number): T | null {
  let lo = 0, hi = series.length - 1, ans: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].ts <= ts) { ans = series[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

interface Trade {
  side: 'long' | 'short';
  pnlR: number;
  reason: 'sl' | 'tp' | 'time';
  entryTs: number;
}

function runBacktest(bars: Bar[], sigHist: SigPoint[], frHist: SigPoint[], p: Params, btcBars: Bar[], inverseSig = false): Trade[] {
  const trades: Trade[] = [];
  let open: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number } | null = null;
  const sigVals = sigHist.map(x => x.v);

  for (let i = p.windowBars + p.atrPeriod; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const slHit = open.side === 'long' ? bar.l <= open.sl : bar.h >= open.sl;
      const tpHit = open.side === 'long' ? bar.h >= open.tp : bar.l <= open.tp;
      const held = i - open.idx;
      const risk = Math.abs(open.entry - open.sl);
      const fr = nearestBefore(frHist, bar.ts);
      const fundingR = fr ? (open.side === 'long' ? -1 : 1) * fr.v * FUNDING_PER_4H_FACTOR * (open.entry / risk) : 0;
      const tpFirst = open.side === 'long' ? bar.c > bar.o : bar.c < bar.o;
      const close = (fillPrice: number, isTaker: boolean, reason: 'sl' | 'tp' | 'time') => {
        const pnlPrice = open!.side === 'long' ? fillPrice - open!.entry : open!.entry - fillPrice;
        const grossR = pnlPrice / risk;
        const feeR = (MAKER_FEE * open!.entry + (isTaker ? TAKER_FEE : MAKER_FEE) * fillPrice) / risk;
        const costR = feeR - fundingR;
        trades.push({ side: open!.side, pnlR: grossR - costR, reason, entryTs: open!.entryTs });
        open = null;
      };
      if (slHit && tpHit) {
        if (tpFirst) close(open.tp, false, 'tp');
        else close(open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, 'sl');
      } else if (slHit) close(open.side === 'long' ? open.sl * (1 - SL_SLIP) : open.sl * (1 + SL_SLIP), true, 'sl');
      else if (tpHit) close(open.tp, false, 'tp');
      else if (held >= p.maxHoldBars) close(open.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP), true, 'time');
    }
    if (open) continue;

    const sigAt = nearestBefore(sigHist, bar.ts);
    if (!sigAt) continue;
    const sigIdx = sigHist.indexOf(sigAt);
    if (sigIdx < p.windowBars - 1) continue;
    const window = sigVals.slice(sigIdx - p.windowBars + 1, sigIdx + 1);
    const pct = percentile(window, sigAt.v);

    // Signal interpretation:
    //   - normal: extreme high → SHORT (fade crowd long), extreme low → LONG
    //   - inverse: opposite (use for funding where positive funding = longs paying = crowd long)
    let side: 'long' | 'short' | null = null;
    if (!inverseSig) {
      if (pct >= p.pctHi) side = 'short';
      else if (pct <= p.pctLo) side = 'long';
    } else {
      if (pct >= p.pctHi) side = 'short';   // both funding/LS: high = crowd long → fade short
      else if (pct <= p.pctLo) side = 'long';
    }
    if (!side) continue;

    // Pair-own trend
    if (p.trendAlignment) {
      const closes = bars.slice(Math.max(0, i - p.emaSlow * 3), i + 1).map(b => b.c);
      const eF = ema(closes, p.emaFast);
      const eS = ema(closes, p.emaSlow);
      if (eF == null || eS == null) continue;
      if (side === 'short' && eF > eS) continue;
      if (side === 'long' && eF <= eS) continue;
    }

    // BTC macro
    if (p.btcTrendFilter) {
      let bIdx = -1;
      for (let k = btcBars.length - 1; k >= 0; k--) { if (btcBars[k].ts <= bar.ts) { bIdx = k; break; } }
      if (bIdx < p.btcEmaSlow * 3) continue;
      const bC = btcBars.slice(Math.max(0, bIdx - p.btcEmaSlow * 3), bIdx + 1).map(b => b.c);
      const bF = ema(bC, p.btcEmaFast);
      const bS = ema(bC, p.btcEmaSlow);
      if (bF == null || bS == null) continue;
      if (side === 'short' && bF > bS) continue;
      if (side === 'long' && bF <= bS) continue;
    }

    const a = atr(bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1), p.atrPeriod);
    if (a <= 0) continue;
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    open = { side, entry: bar.c, entryTs: bar.ts, sl, tp, idx: i };
  }
  return trades;
}

function metrics(trades: Trade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, avgR: 0, sumR: 0, pf: 0 };
  const wins = trades.filter(t => t.pnlR > 0);
  const losses = trades.filter(t => t.pnlR < 0);
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const sumW = wins.reduce((s, t) => s + t.pnlR, 0);
  const sumL = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
  return { n: trades.length, wr: wins.length / trades.length * 100, avgR: sumR / trades.length, sumR, pf: sumL > 0 ? sumW / sumL : Infinity };
}

async function loadSig(table: string, pair: string, valColumn: string): Promise<SigPoint[]> {
  const r = await query<any>(
    `SELECT ts::text, ${valColumn}::text AS v FROM ${table} WHERE pair=$1 ORDER BY ts`,
    [pair]
  );
  return r.rows.map(row => ({ ts: Number(row.ts), v: Number(row.v) }));
}
async function loadSigBySymbol(table: string, symbol: string, valColumn: string): Promise<SigPoint[]> {
  const r = await query<any>(
    `SELECT ts::text, ${valColumn}::text AS v FROM ${table} WHERE symbol=$1 ORDER BY ts`,
    [symbol]
  );
  return r.rows.map(row => ({ ts: Number(row.ts), v: Number(row.v) }));
}

async function main() {
  const pair = process.env.BT_PAIR ?? 'ETHUSDT';
  const coin = pair.replace(/USDT$/, '');

  console.log(`Loading data for ${pair}...`);
  const bars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts`,
    [pair]
  )).rows.map(r => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));
  const btcBars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts`
  )).rows.map(r => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));
  const sigSources: { name: string; load: () => Promise<SigPoint[]>; inverse?: boolean }[] = [
    { name: 'ls_top_position ', load: () => loadSig('cg_ls_top_position', pair, 'ratio') },
    { name: 'ls_top_account  ', load: () => loadSig('cg_ls_top_account',  pair, 'ratio') },
    { name: 'ls_global_account', load: () => loadSig('cg_ls_global_account', pair, 'ratio') },
    { name: 'funding         ', load: () => loadSigBySymbol('cg_funding_oi_weighted', coin, 'fr_close') },
  ];
  const frHist = await loadSigBySymbol('cg_funding_oi_weighted', coin, 'fr_close');

  const BASE: Params = {
    pctHi: 0.85, pctLo: 0.15, windowBars: 180,
    atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
    trendAlignment: false, emaFast: 20, emaSlow: 50,
    btcTrendFilter: false, btcEmaFast: 20, btcEmaSlow: 50,
  };

  const filterCombos: Array<{ name: string; trend: boolean; btc: boolean }> = [
    { name: 'no filter   ', trend: false, btc: false },
    { name: '+pair trend ', trend: true,  btc: false },
    { name: '+BTC trend  ', trend: false, btc: true },
    { name: '+both       ', trend: true,  btc: true },
  ];

  const pctVariants = [
    { pctHi: 0.85, pctLo: 0.15 },
    { pctHi: 0.80, pctLo: 0.20 },
    { pctHi: 0.75, pctLo: 0.25 },
    { pctHi: 0.90, pctLo: 0.10 },
  ];

  console.log(`\n=== ${pair} — Signal source × Filter × Percentile grid (240m, hold 12, SL1.5/TP2) ===`);
  console.log('signal              filter        pct       | trades  WR    sumR   PF    L/S');
  console.log('--------------------------------------------|------------------------------');

  type Row = { signal: string; filter: string; pct: string; m: ReturnType<typeof metrics>; ls: string };
  const rows: Row[] = [];

  for (const src of sigSources) {
    const sigHist = await src.load();
    if (sigHist.length === 0) continue;
    for (const f of filterCombos) {
      for (const pv of pctVariants) {
        const p = { ...BASE, ...pv, trendAlignment: f.trend, btcTrendFilter: f.btc };
        const trades = runBacktest(bars, sigHist, frHist, p, btcBars);
        const m = metrics(trades);
        const longs = trades.filter(t => t.side === 'long').length;
        const shorts = trades.filter(t => t.side === 'short').length;
        const ls = `${longs}/${shorts}`;
        rows.push({ signal: src.name, filter: f.name, pct: `${pv.pctHi}/${pv.pctLo}`, m, ls });
      }
    }
  }

  rows.sort((a, b) => b.m.sumR - a.m.sumR);
  for (const r of rows.slice(0, 20)) {
    console.log(`${r.signal} ${r.filter}  ${r.pct.padEnd(9)} | ${String(r.m.n).padStart(3)}  ${r.m.wr.toFixed(1).padStart(4)}% ${r.m.sumR.toFixed(2).padStart(7)} ${r.m.pf.toFixed(2).padStart(5)}  ${r.ls}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
