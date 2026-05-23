/**
 * ETH multi-signal confluence search.
 *
 * Hypothesis: single CG signal gives marginal edge. Combining 2-3 signals that
 * AGREE on direction provides higher-conviction setups.
 *
 * Signals tested (each can be in "fade" or "follow" mode):
 *   F1 — funding rate (high = longs paying = crowd long)
 *   F2 — ls_top_account percentile (high = top accounts long)
 *   F3 — ls_global_account percentile (high = retail long)
 *   F4 — ls_top_position percentile (high = whales long)
 *   F5 — OI delta 24h (large positive = position buildup)
 *
 * Setup logic:
 *   Direction = fade. SHORT when ≥N signals indicate crowd-long, LONG when ≥N
 *   indicate crowd-short. N is a tunable confluence threshold.
 *
 * Uses same realistic cost model as champion (slip/fees/funding/Fix A intrabar).
 */
import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; o: number; h: number; l: number; c: number };
type SigPoint = { ts: number; v: number };

const TAKER_FEE = 0.00055;
const MAKER_FEE = 0.0002;
const SL_SLIP = 0.0005;
const TIME_SLIP = 0.0005;
const FUNDING_PER_4H = 0.5;

interface Params {
  hiPctile: number;       // 0.80
  loPctile: number;       // 0.20
  windowBars: number;     // 180
  atrPeriod: number;      // 14
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldBars: number;
  needConfluence: number; // minimum signals agreeing (e.g. 2)
  useFunding: boolean;
  useTopAccount: boolean;
  useGlobalAccount: boolean;
  useTopPosition: boolean;
  useOiDelta: boolean;
  oiDeltaPctMin: number;  // 3.0 = 3% over 24h
  btcTrendFilter: boolean;
  pairTrendFilter: boolean;
  emaFast: number;
  emaSlow: number;
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
function pctOfSeries(series: SigPoint[], values: number[], at: number, windowBars: number): { pct: number; val: number } | null {
  const sigAt = nearestBefore(series, at);
  if (!sigAt) return null;
  const idx = series.indexOf(sigAt);
  if (idx < windowBars - 1) return null;
  const window = values.slice(idx - windowBars + 1, idx + 1);
  return { pct: percentile(window, sigAt.v), val: sigAt.v };
}

interface Trade {
  side: 'long' | 'short';
  pnlR: number;
  reason: 'sl' | 'tp' | 'time';
  entryTs: number;
}

interface Sigs {
  funding?: SigPoint[];
  topAccount?: SigPoint[];
  globalAccount?: SigPoint[];
  topPosition?: SigPoint[];
  oi?: SigPoint[];
}

function runBacktest(bars: Bar[], sigs: Sigs, p: Params, btcBars: Bar[]): Trade[] {
  const trades: Trade[] = [];
  let open: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; idx: number } | null = null;
  const fundingVals = sigs.funding?.map(s => s.v) ?? [];
  const topAccVals = sigs.topAccount?.map(s => s.v) ?? [];
  const globAccVals = sigs.globalAccount?.map(s => s.v) ?? [];
  const topPosVals = sigs.topPosition?.map(s => s.v) ?? [];
  const ONE_DAY = 86_400_000;

  for (let i = p.windowBars + p.atrPeriod; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const slHit = open.side === 'long' ? bar.l <= open.sl : bar.h >= open.sl;
      const tpHit = open.side === 'long' ? bar.h >= open.tp : bar.l <= open.tp;
      const held = i - open.idx;
      const risk = Math.abs(open.entry - open.sl);
      const fr = sigs.funding ? nearestBefore(sigs.funding, bar.ts) : null;
      const fundingR = fr ? (open.side === 'long' ? -1 : 1) * fr.v * FUNDING_PER_4H * (open.entry / risk) : 0;
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

    // Vote count per direction
    let voteShort = 0, voteLong = 0;
    if (p.useFunding && sigs.funding) {
      const r = pctOfSeries(sigs.funding, fundingVals, bar.ts, p.windowBars);
      if (!r) continue;
      if (r.pct >= p.hiPctile) voteShort++;
      else if (r.pct <= p.loPctile) voteLong++;
    }
    if (p.useTopAccount && sigs.topAccount) {
      const r = pctOfSeries(sigs.topAccount, topAccVals, bar.ts, p.windowBars);
      if (!r) continue;
      if (r.pct >= p.hiPctile) voteShort++;
      else if (r.pct <= p.loPctile) voteLong++;
    }
    if (p.useGlobalAccount && sigs.globalAccount) {
      const r = pctOfSeries(sigs.globalAccount, globAccVals, bar.ts, p.windowBars);
      if (!r) continue;
      if (r.pct >= p.hiPctile) voteShort++;
      else if (r.pct <= p.loPctile) voteLong++;
    }
    if (p.useTopPosition && sigs.topPosition) {
      const r = pctOfSeries(sigs.topPosition, topPosVals, bar.ts, p.windowBars);
      if (!r) continue;
      if (r.pct >= p.hiPctile) voteShort++;
      else if (r.pct <= p.loPctile) voteLong++;
    }
    if (p.useOiDelta && sigs.oi) {
      const oiNow = nearestBefore(sigs.oi, bar.ts);
      const oi24 = nearestBefore(sigs.oi, bar.ts - ONE_DAY);
      if (!oiNow || !oi24 || oi24.v <= 0) continue;
      const pctChg = ((oiNow.v - oi24.v) / oi24.v) * 100;
      // High OI growth = position buildup = ripe for unwind. Direction determined by other signals.
      // OI alone doesn't tell direction — only confirms crowd buildup. Treat as confluence multiplier.
      if (Math.abs(pctChg) < p.oiDeltaPctMin) continue;
    }

    let side: 'long' | 'short' | null = null;
    if (voteShort >= p.needConfluence) side = 'short';
    else if (voteLong >= p.needConfluence) side = 'long';
    if (!side) continue;

    // Pair trend
    if (p.pairTrendFilter) {
      const closes = bars.slice(Math.max(0, i - p.emaSlow * 3), i + 1).map(b => b.c);
      const eF = ema(closes, p.emaFast);
      const eS = ema(closes, p.emaSlow);
      if (eF == null || eS == null) continue;
      if (side === 'short' && eF > eS) continue;
      if (side === 'long' && eF <= eS) continue;
    }
    // BTC trend
    if (p.btcTrendFilter) {
      let bIdx = -1;
      for (let k = btcBars.length - 1; k >= 0; k--) { if (btcBars[k].ts <= bar.ts) { bIdx = k; break; } }
      if (bIdx < p.emaSlow * 3) continue;
      const bC = btcBars.slice(Math.max(0, bIdx - p.emaSlow * 3), bIdx + 1).map(b => b.c);
      const bF = ema(bC, p.emaFast);
      const bS = ema(bC, p.emaSlow);
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

async function loadSig(table: string, key: 'pair' | 'symbol', keyVal: string, valCol: string): Promise<SigPoint[]> {
  const r = await query<any>(
    `SELECT ts::text, ${valCol}::text AS v FROM ${table} WHERE ${key}=$1 ORDER BY ts`,
    [keyVal]
  );
  return r.rows.map((row: any) => ({ ts: Number(row.ts), v: Number(row.v) }));
}

async function main() {
  const pair = 'ETHUSDT';
  const coin = 'ETH';

  const bars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts`,
    [pair]
  )).rows.map((r: any) => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));
  const btcBars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts`
  )).rows.map((r: any) => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));
  const sigs: Sigs = {
    funding:        await loadSig('cg_funding_oi_weighted', 'symbol', coin, 'fr_close'),
    topAccount:     await loadSig('cg_ls_top_account',      'pair',   pair, 'ratio'),
    globalAccount:  await loadSig('cg_ls_global_account',   'pair',   pair, 'ratio'),
    topPosition:    await loadSig('cg_ls_top_position',     'pair',   pair, 'ratio'),
    oi:             await loadSig('cg_oi_aggregated',       'symbol', coin, 'oi_close'),
  };
  console.log(`${pair} bars: ${bars.length}, sigs: F:${sigs.funding?.length} TA:${sigs.topAccount?.length} GA:${sigs.globalAccount?.length} TP:${sigs.topPosition?.length} OI:${sigs.oi?.length}`);

  const BASE: Params = {
    hiPctile: 0.80, loPctile: 0.20, windowBars: 180,
    atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12,
    needConfluence: 2,
    useFunding: false, useTopAccount: false, useGlobalAccount: false, useTopPosition: false, useOiDelta: false, oiDeltaPctMin: 3.0,
    btcTrendFilter: false, pairTrendFilter: false, emaFast: 20, emaSlow: 50,
  };

  type V = { name: string; p: Partial<Params> };
  const variants: V[] = [
    // === Single signal baselines ===
    { name: 'F only (funding fade)        ', p: { useFunding: true, needConfluence: 1, pairTrendFilter: true, btcTrendFilter: true, hiPctile: 0.75, loPctile: 0.25 } },
    { name: 'TA only (top account)        ', p: { useTopAccount: true, needConfluence: 1, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'GA only (global account)     ', p: { useGlobalAccount: true, needConfluence: 1, pairTrendFilter: true, btcTrendFilter: true, hiPctile: 0.90, loPctile: 0.10 } },
    { name: 'TP only (top position)       ', p: { useTopPosition: true, needConfluence: 1, pairTrendFilter: true, btcTrendFilter: true } },

    // === 2-signal confluence (need 2 agreeing) ===
    { name: 'F+TA  (2-conf)               ', p: { useFunding: true, useTopAccount: true, needConfluence: 2 } },
    { name: 'F+GA  (2-conf)               ', p: { useFunding: true, useGlobalAccount: true, needConfluence: 2 } },
    { name: 'F+TP  (2-conf)               ', p: { useFunding: true, useTopPosition: true, needConfluence: 2 } },
    { name: 'TA+GA (2-conf)               ', p: { useTopAccount: true, useGlobalAccount: true, needConfluence: 2 } },
    { name: 'TA+TP (2-conf)               ', p: { useTopAccount: true, useTopPosition: true, needConfluence: 2 } },
    { name: 'GA+TP (2-conf)               ', p: { useGlobalAccount: true, useTopPosition: true, needConfluence: 2 } },
    // With trend filters
    { name: 'F+TA +trends                 ', p: { useFunding: true, useTopAccount: true, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'F+GA +trends                 ', p: { useFunding: true, useGlobalAccount: true, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'TA+GA +trends                ', p: { useTopAccount: true, useGlobalAccount: true, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'F+TP +trends                 ', p: { useFunding: true, useTopPosition: true, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'GA+TP +trends                ', p: { useGlobalAccount: true, useTopPosition: true, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },

    // === 3-signal confluence (need 3) ===
    { name: 'F+TA+GA (3-conf)             ', p: { useFunding: true, useTopAccount: true, useGlobalAccount: true, needConfluence: 3 } },
    { name: 'F+TA+TP (3-conf)             ', p: { useFunding: true, useTopAccount: true, useTopPosition: true, needConfluence: 3 } },
    { name: 'F+GA+TP (3-conf)             ', p: { useFunding: true, useGlobalAccount: true, useTopPosition: true, needConfluence: 3 } },
    { name: 'TA+GA+TP (3-conf)            ', p: { useTopAccount: true, useGlobalAccount: true, useTopPosition: true, needConfluence: 3 } },
    { name: 'F+TA+GA +trends              ', p: { useFunding: true, useTopAccount: true, useGlobalAccount: true, needConfluence: 3, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'F+TA+GA+TP (4-conf)          ', p: { useFunding: true, useTopAccount: true, useGlobalAccount: true, useTopPosition: true, needConfluence: 4 } },

    // === With OI confirmation ===
    { name: 'F+TA +OI delta 3% +trends    ', p: { useFunding: true, useTopAccount: true, useOiDelta: true, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'F+TA +OI delta 5% +trends    ', p: { useFunding: true, useTopAccount: true, useOiDelta: true, oiDeltaPctMin: 5.0, needConfluence: 2, pairTrendFilter: true, btcTrendFilter: true } },

    // === Looser threshold for 2-conf (catch more setups) ===
    { name: 'F+TA  pct 0.70 +trends       ', p: { useFunding: true, useTopAccount: true, needConfluence: 2, hiPctile: 0.70, loPctile: 0.30, pairTrendFilter: true, btcTrendFilter: true } },
    { name: 'F+GA  pct 0.70 +trends       ', p: { useFunding: true, useGlobalAccount: true, needConfluence: 2, hiPctile: 0.70, loPctile: 0.30, pairTrendFilter: true, btcTrendFilter: true } },

    // === Tighter threshold for 2-conf ===
    { name: 'F+TA  pct 0.90 +trends       ', p: { useFunding: true, useTopAccount: true, needConfluence: 2, hiPctile: 0.90, loPctile: 0.10, pairTrendFilter: true, btcTrendFilter: true } },
  ];

  console.log('\nname                            |  n   WR%   avgR   sumR    PF    L/S');
  console.log('-------------------------------------------------------------------');
  const rows: { name: string; m: ReturnType<typeof metrics>; longs: number; shorts: number }[] = [];
  for (const v of variants) {
    const p = { ...BASE, ...v.p };
    const trades = runBacktest(bars, sigs, p, btcBars);
    const m = metrics(trades);
    rows.push({ name: v.name, m, longs: m.longs, shorts: m.shorts });
  }
  rows.sort((a, b) => b.m.sumR - a.m.sumR);
  for (const r of rows) {
    console.log(
      `${r.name}| ${String(r.m.n).padStart(3)}  ${r.m.wr.toFixed(1).padStart(4)}% ${r.m.avgR.toFixed(3).padStart(6)} ${r.m.sumR.toFixed(2).padStart(7)} ${r.m.pf.toFixed(2).padStart(5)}  ${r.longs}/${r.shorts}`
    );
  }

  // ===========================================================
  // CHAMPION DEEP-DIVE: walk-forward + per-quarter + DD analysis
  // ===========================================================
  const champP: Params = {
    ...BASE, useFunding: true, useTopAccount: true, needConfluence: 2,
    hiPctile: 0.70, loPctile: 0.30,
    pairTrendFilter: true, btcTrendFilter: true,
  };
  const champTrades = runBacktest(bars, sigs, champP, btcBars);
  console.log(`\n=== ETH CHAMPION DEEP-DIVE (F+TA pct 0.70 + trends) ===`);
  const cm = metrics(champTrades);
  console.log(`Trades: ${cm.n}  WR: ${cm.wr.toFixed(1)}%  avgR: ${cm.avgR.toFixed(3)}  sumR: ${cm.sumR.toFixed(2)}  PF: ${cm.pf.toFixed(2)}  L/S: ${cm.longs}/${cm.shorts}`);

  // Period bounds from signal coverage
  const cgFirst = (sigs.funding && sigs.funding.length > 0) ? sigs.funding[0].ts : bars[0].ts;
  const cgLast = (sigs.funding && sigs.funding.length > 0) ? sigs.funding[sigs.funding.length - 1].ts : bars[bars.length - 1].ts;
  const span = cgLast - cgFirst;

  // A. Anchored Train/Test splits
  console.log('\n--- A. Train/Test splits (anchored) ---');
  console.log('  split   | IS trades  WR    sumR    avgR  |  OOS trades  WR    sumR    avgR  | IS-OOS gap');
  for (const ratio of [0.5, 0.6, 0.7, 0.8]) {
    const splitTs = cgFirst + Math.floor(span * ratio);
    const isT  = champTrades.filter(t => t.entryTs <  splitTs);
    const oosT = champTrades.filter(t => t.entryTs >= splitTs);
    const mi = metrics(isT), mo = metrics(oosT);
    const gap = mi.avgR - mo.avgR;
    const gapMark = Math.abs(gap) < 0.10 ? '✓' : Math.abs(gap) < 0.20 ? '~' : '✗';
    console.log(
      `  ${ratio.toFixed(1)}/${(1-ratio).toFixed(1)}   | ${String(mi.n).padStart(3)}  ${mi.wr.toFixed(1).padStart(4)}% ${mi.sumR.toFixed(2).padStart(7)} ${mi.avgR.toFixed(3).padStart(6)}  | ${String(mo.n).padStart(4)}    ${mo.wr.toFixed(1).padStart(4)}% ${mo.sumR.toFixed(2).padStart(7)} ${mo.avgR.toFixed(3).padStart(6)}  | ${gap.toFixed(3)} ${gapMark}`
    );
  }

  // B. Per-quarter
  console.log('\n--- B. Per-quarter performance ---');
  console.log('  quarter             | trades  WR     sumR    avgR    PF');
  const qStep = Math.floor(span / 4);
  for (let q = 0; q < 4; q++) {
    const qStart = cgFirst + q * qStep;
    const qEnd = q === 3 ? cgLast : cgFirst + (q + 1) * qStep;
    const qT = champTrades.filter(t => t.entryTs >= qStart && t.entryTs < qEnd);
    const m = metrics(qT);
    const label = `${new Date(qStart).toISOString().slice(0,7)} → ${new Date(qEnd).toISOString().slice(0,7)}`;
    console.log(
      `  ${label.padEnd(20)} | ${String(m.n).padStart(3)}     ${m.wr.toFixed(1).padStart(4)}% ${m.sumR.toFixed(2).padStart(7)} ${m.avgR.toFixed(3).padStart(7)} ${m.pf.toFixed(2).padStart(5)}`
    );
  }

  // C. Risk × equity table
  console.log('\n--- C. Risk scenarios (compounding, $50k start) ---');
  console.log('risk%  | finalEq    return%   MaxDD%   maxConsL  maxConsW');
  for (const risk of [0.25, 0.375, 0.5, 0.75, 1.0]) {
    const sorted = [...champTrades].sort((a, b) => a.entryTs - b.entryTs);
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
