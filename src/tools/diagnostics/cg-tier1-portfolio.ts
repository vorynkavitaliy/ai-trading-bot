/**
 * Tier-1 portfolio backtest — 7 pairs that passed walk-forward, BTC L/S
 * champion + funding-fade variants. Realistic costs (slip/fees/funding/Fix A).
 * Compounding equity, risk per pair = 0.5% of current equity.
 *
 * Run: npx tsx src/tools/diagnostics/cg-tier1-portfolio.ts
 *
 * NB: each pair's strategy generates trades independently. Combined trade list
 * is sorted by entryTs and applied to a shared equity pool. Natural max-parallel
 * = 7 (one per pair).
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
function pctOf(series: number[], v: number): number {
  let c = 0; for (const x of series) if (x <= v) c++; return c / series.length;
}
function nearestBefore<T extends { ts: number }>(s: T[], ts: number): T | null {
  let lo = 0, hi = s.length - 1, ans: T | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].ts <= ts) { ans = s[m]; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function trendUp(closes: number[], fast: number, slow: number): boolean | null {
  const eF = ema(closes, fast); const eS = ema(closes, slow);
  if (eF == null || eS == null) return null;
  return eF > eS;
}

interface Trade {
  pair: string;
  side: 'long' | 'short';
  entryTs: number;
  exitTs: number;
  entry: number;
  exit: number;
  sl: number;
  pnlR: number;
  reason: 'sl' | 'tp' | 'time';
}

interface Pos {
  side: 'long' | 'short';
  entry: number;
  entryTs: number;
  sl: number;
  tp: number;
  idx: number;
}

function fundingR(side: 'long' | 'short', barTs: number, frHist: SigPoint[], entry: number, risk: number): number {
  const fr = nearestBefore(frHist, barTs);
  return fr ? (side === 'long' ? -1 : 1) * fr.v * FUNDING_PER_4H * (entry / risk) : 0;
}

function closeAt(
  pos: Pos, exitPrice: number, isTaker: boolean, fundingAcc: number, exitTs: number, reason: 'sl' | 'tp' | 'time', pair: string,
): Trade {
  const risk = Math.abs(pos.entry - pos.sl);
  const pnlPrice = pos.side === 'long' ? exitPrice - pos.entry : pos.entry - exitPrice;
  const grossR = pnlPrice / risk;
  const feeR = (MAKER_FEE * pos.entry + (isTaker ? TAKER_FEE : MAKER_FEE) * exitPrice) / risk;
  return {
    pair, side: pos.side, entryTs: pos.entryTs, exitTs,
    entry: pos.entry, exit: exitPrice, sl: pos.sl,
    pnlR: grossR - feeR + fundingAcc,
    reason,
  };
}

function resolveBar(bar: Bar, pos: Pos, fR: number, exitTs: number, pair: string, maxHold: number, i: number): Trade | null {
  const slHit = pos.side === 'long' ? bar.l <= pos.sl : bar.h >= pos.sl;
  const tpHit = pos.side === 'long' ? bar.h >= pos.tp : bar.l <= pos.tp;
  const tpFirst = pos.side === 'long' ? bar.c > bar.o : bar.c < bar.o;
  const held = i - pos.idx;
  if (slHit && tpHit) {
    if (tpFirst) return closeAt(pos, pos.tp, false, fR, exitTs, 'tp', pair);
    return closeAt(pos, pos.side === 'long' ? pos.sl * (1 - SL_SLIP) : pos.sl * (1 + SL_SLIP), true, fR, exitTs, 'sl', pair);
  }
  if (slHit) return closeAt(pos, pos.side === 'long' ? pos.sl * (1 - SL_SLIP) : pos.sl * (1 + SL_SLIP), true, fR, exitTs, 'sl', pair);
  if (tpHit) return closeAt(pos, pos.tp, false, fR, exitTs, 'tp', pair);
  if (held >= maxHold) return closeAt(pos, pos.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP), true, fR, exitTs, 'time', pair);
  return null;
}

// === STRATEGY RUNNERS (each returns Trade[] for one pair) ===

// S1: L/S top position fade + pair trend (BTC champion)
function runS1(pair: string, bars: Bar[], ls: SigPoint[], fr: SigPoint[], btcBars: Bar[]): Trade[] {
  return runFade(pair, bars, ls, fr, btcBars, 0.85, 0.15, false, true, 1.5, 2.0, 12, false);
}
// S2: L/S top position fade + BTC trend (INJ)
function runS2(pair: string, bars: Bar[], ls: SigPoint[], fr: SigPoint[], btcBars: Bar[]): Trade[] {
  return runFade(pair, bars, ls, fr, btcBars, 0.85, 0.15, true, false, 1.5, 2.0, 12, false);
}
// S3: Funding fade pct 0.75 + both trends (BNB/TAO/ATOM/LTC/ARB/etc)
function runS3(pair: string, bars: Bar[], fr: SigPoint[], btcBars: Bar[]): Trade[] {
  return runFade(pair, bars, fr, fr, btcBars, 0.75, 0.25, true, true, 1.5, 2.0, 12, false);
}
// S4: F+TA confluence (need both >= pctHi or both <= pctLo) (XRP/SOL)
function runS4(pair: string, bars: Bar[], fr: SigPoint[], lsTA: SigPoint[], btcBars: Bar[]): Trade[] {
  return runConfluence(pair, bars, fr, lsTA, btcBars, 0.70, 0.30, 1.5, 2.0, 12);
}

function runFade(
  pair: string, bars: Bar[], sigHist: SigPoint[], frHist: SigPoint[], btcBars: Bar[],
  pctHi: number, pctLo: number, useBtcTrend: boolean, usePairTrend: boolean,
  slMult: number, tpMult: number, maxHold: number, inverse: boolean,
): Trade[] {
  const trades: Trade[] = [];
  let open: Pos | null = null;
  const sigVals = sigHist.map(x => x.v);
  for (let i = WINDOW + ATR_P; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const risk = Math.abs(open.entry - open.sl);
      const fR = fundingR(open.side, bar.ts, frHist, open.entry, risk);
      const closed = resolveBar(bar, open, fR, bar.ts, pair, maxHold, i);
      if (closed) { trades.push(closed); open = null; }
    }
    if (open) continue;
    const sigAt = nearestBefore(sigHist, bar.ts);
    if (!sigAt) continue;
    const idx = sigHist.indexOf(sigAt);
    if (idx < WINDOW - 1) continue;
    const pct = pctOf(sigVals.slice(idx - WINDOW + 1, idx + 1), sigAt.v);
    let side: 'long' | 'short' | null = null;
    if (!inverse) { if (pct >= pctHi) side = 'short'; else if (pct <= pctLo) side = 'long'; }
    else { if (pct >= pctHi) side = 'long'; else if (pct <= pctLo) side = 'short'; }
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
  pair: string, bars: Bar[], frHist: SigPoint[], lsTopAcc: SigPoint[], btcBars: Bar[],
  pctHi: number, pctLo: number, slMult: number, tpMult: number, maxHold: number,
): Trade[] {
  const trades: Trade[] = [];
  let open: Pos | null = null;
  const frVals = frHist.map(x => x.v);
  const taVals = lsTopAcc.map(x => x.v);
  for (let i = WINDOW + ATR_P; i < bars.length; i++) {
    const bar = bars[i];
    if (open) {
      const risk = Math.abs(open.entry - open.sl);
      const fR = fundingR(open.side, bar.ts, frHist, open.entry, risk);
      const closed = resolveBar(bar, open, fR, bar.ts, pair, maxHold, i);
      if (closed) { trades.push(closed); open = null; }
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
    // both trends
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
  const START_EQUITY = 200_000;
  const RISK_PCT = 0.5;
  // Tier 1: 7 pairs with 4/4 quarters positive and passing walk-forward
  const TIER1: Array<{ pair: string; strategy: 'S1' | 'S2' | 'S3' | 'S4' }> = [
    { pair: 'BTCUSDT',  strategy: 'S1' },
    { pair: 'TAOUSDT',  strategy: 'S3' },
    { pair: 'INJUSDT',  strategy: 'S2' },
    { pair: 'ATOMUSDT', strategy: 'S3' },
    { pair: 'ARBUSDT',  strategy: 'S3' },
    { pair: 'XRPUSDT',  strategy: 'S4' },
    { pair: 'LTCUSDT',  strategy: 'S3' },
  ];

  console.log(`=== Tier-1 portfolio backtest — fresh run ${new Date().toISOString()} ===`);
  console.log(`Universe: ${TIER1.map(t => `${t.pair}(${t.strategy})`).join(', ')}`);
  console.log(`Start equity: $${START_EQUITY.toLocaleString()}   Risk per trade: ${RISK_PCT}% (compounding)`);

  const btcBars = await loadBars('BTCUSDT');

  // 1) Generate per-pair trades
  const allTrades: Trade[] = [];
  const cgFirstByPair: Record<string, number> = {};
  const cgLastByPair: Record<string, number> = {};
  for (const cfg of TIER1) {
    const coin = cfg.pair.replace(/USDT$/, '');
    const bars = await loadBars(cfg.pair);
    const lsTop = await loadSig('cg_ls_top_position', 'pair', cfg.pair, 'ratio');
    const lsTA = await loadSig('cg_ls_top_account', 'pair', cfg.pair, 'ratio');
    const fr = await loadSig('cg_funding_oi_weighted', 'symbol', coin, 'fr_close');
    cgFirstByPair[cfg.pair] = lsTop[0]?.ts ?? 0;
    cgLastByPair[cfg.pair] = lsTop[lsTop.length - 1]?.ts ?? 0;

    let t: Trade[] = [];
    if (cfg.strategy === 'S1') t = runS1(cfg.pair, bars, lsTop, fr, btcBars);
    else if (cfg.strategy === 'S2') t = runS2(cfg.pair, bars, lsTop, fr, btcBars);
    else if (cfg.strategy === 'S3') t = runS3(cfg.pair, bars, fr, btcBars);
    else if (cfg.strategy === 'S4') t = runS4(cfg.pair, bars, fr, lsTA, btcBars);

    // Constrain to CG range
    t = t.filter(x => x.entryTs >= cgFirstByPair[cfg.pair] && x.entryTs <= cgLastByPair[cfg.pair]);
    allTrades.push(...t);
  }

  // 2) Sort chronologically by entry
  allTrades.sort((a, b) => a.entryTs - b.entryTs || a.exitTs - b.exitTs);
  console.log(`\nTotal per-pair trades (after CG range filter): ${allTrades.length}`);

  // 3) Portfolio simulation: compounding shared equity
  let equity = START_EQUITY;
  let peakEq = START_EQUITY;
  let maxDD = 0;
  let maxDDStart = 0, maxDDEnd = 0, curDDStart = 0;
  const curve: { ts: number; equity: number; dd: number }[] = [{ ts: allTrades[0]?.entryTs ?? 0, equity, dd: 0 }];
  let wins = 0, losses = 0, scratches = 0;
  let consL = 0, consW = 0, maxConsL = 0, maxConsW = 0;
  let sumR = 0;
  const monthly: Record<string, { trades: number; pnl: number }> = {};
  const byPair: Record<string, { trades: number; wins: number; pnl: number; sumR: number }> = {};

  for (const t of allTrades) {
    const riskUsd = equity * (RISK_PCT / 100);
    const pnlUsd = t.pnlR * riskUsd;
    equity += pnlUsd;
    if (equity > peakEq) { peakEq = equity; curDDStart = t.exitTs; }
    const dd = (peakEq - equity) / peakEq * 100;
    if (dd > maxDD) { maxDD = dd; maxDDStart = curDDStart; maxDDEnd = t.exitTs; }
    curve.push({ ts: t.exitTs, equity, dd });
    sumR += t.pnlR;
    if (t.pnlR > 0.05) { wins++; consW++; consL = 0; if (consW > maxConsW) maxConsW = consW; }
    else if (t.pnlR < -0.05) { losses++; consL++; consW = 0; if (consL > maxConsL) maxConsL = consL; }
    else scratches++;
    const month = new Date(t.entryTs).toISOString().slice(0, 7);
    if (!monthly[month]) monthly[month] = { trades: 0, pnl: 0 };
    monthly[month].trades++;
    monthly[month].pnl += pnlUsd;
    if (!byPair[t.pair]) byPair[t.pair] = { trades: 0, wins: 0, pnl: 0, sumR: 0 };
    byPair[t.pair].trades++;
    if (t.pnlR > 0.05) byPair[t.pair].wins++;
    byPair[t.pair].pnl += pnlUsd;
    byPair[t.pair].sumR += t.pnlR;
  }

  // === Summary ===
  const totalTrades = wins + losses + scratches;
  const wr = totalTrades > 0 ? wins / totalTrades * 100 : 0;
  const ret = (equity - START_EQUITY) / START_EQUITY * 100;
  const winSum = allTrades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossSum = Math.abs(allTrades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const pf = lossSum > 0 ? winSum / lossSum : Infinity;

  console.log('\n=== AGGREGATE ===');
  console.log(`Total trades:       ${totalTrades}  (W:${wins}  L:${losses}  scratch:${scratches})`);
  console.log(`Win Rate:           ${wr.toFixed(1)}%`);
  console.log(`Profit Factor:      ${pf.toFixed(2)}`);
  console.log(`avgR per trade:     ${(sumR / totalTrades).toFixed(3)}R`);
  console.log(`Total R:            ${sumR.toFixed(2)}R`);
  console.log();
  console.log(`Start equity:       $${START_EQUITY.toLocaleString()}`);
  console.log(`Final equity:       $${equity.toFixed(0).padStart(10).toLocaleString()}`);
  console.log(`Total return:       ${ret.toFixed(2)}%`);
  console.log(`Net P&L:            $${(equity - START_EQUITY).toFixed(0)}`);
  console.log();
  console.log(`Max Drawdown:       ${maxDD.toFixed(2)}%  ($${(peakEq * maxDD / 100).toFixed(0)})`);
  console.log(`DD period:          ${new Date(maxDDStart).toISOString().slice(0,10)} → ${new Date(maxDDEnd).toISOString().slice(0,10)}`);
  console.log(`Max consec losses:  ${maxConsL}`);
  console.log(`Max consec wins:    ${maxConsW}`);

  console.log('\n=== PER-PAIR BREAKDOWN ===');
  console.log('pair      |  n   wins  WR%    sumR    pnl$');
  for (const cfg of TIER1) {
    const s = byPair[cfg.pair];
    if (!s) { console.log(`${cfg.pair.padEnd(9)} | (no trades)`); continue; }
    console.log(`${cfg.pair.padEnd(9)} | ${String(s.trades).padStart(3)}   ${String(s.wins).padStart(3)}   ${(s.wins / s.trades * 100).toFixed(1).padStart(4)}%  ${s.sumR.toFixed(2).padStart(6)}  $${s.pnl.toFixed(0).padStart(7)}`);
  }

  console.log('\n=== MONTHLY P&L (compounding) ===');
  const months = Object.keys(monthly).sort();
  let runEq = START_EQUITY;
  for (const m of months) {
    const monthPnl = monthly[m].pnl;
    runEq += monthPnl;
    const pct = monthPnl / (runEq - monthPnl) * 100;
    console.log(`  ${m}: ${monthly[m].trades.toString().padStart(3)} trades   $${monthPnl.toFixed(0).padStart(7)} (${pct.toFixed(2).padStart(6)}%)   → equity $${runEq.toFixed(0)}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
