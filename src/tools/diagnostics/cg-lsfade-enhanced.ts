/**
 * Enhanced L/S Top Position Fade backtest — calibration grid.
 *
 * Goal: maximize WR while keeping reasonable trade count (≥80) and PF≥1.2.
 *
 * Baseline (from cg-btc-lsfade-backtest.ts): 0.85/0.15 percentile, no extra filters
 *   → WR 42.9%, sumR +23.10R, PF 1.26 on 163 trades.
 *
 * Filters to test:
 *   A — Tighter percentile (0.95/0.05, 0.97/0.03)
 *   B — Funding confluence: only take if funding direction confirms crowd one-sided-ness
 *       (short signal: funding > fundingMin = longs paying; long signal: funding < -fundingMin)
 *   C — OI delta filter: |OI 24h delta| > oiPctMin = crowd recently building up
 *   D — Trend alignment: take SHORT fade only if 4H trend down (EMA20<EMA50), LONG fade only if 4H trend up
 *   E — Volatility regime: skip if ATR_pct > volMax (chop) or < volMin (squeeze)
 *   F — Daily ATR check: skip if BTC moved > maxDailyMovePct in last 24h (already in extreme move)
 */
import { query, close as closePg } from '../../core/db';

type Bar = { ts: number; o: number; h: number; l: number; c: number };
type LsPoint = { ts: number; v: number };
type FrPoint = { ts: number; v: number };
type OiPoint = { ts: number; v: number };

interface Params {
  // Percentile
  pctHi: number;
  pctLo: number;
  windowBars: number;
  // ATR
  atrPeriod: number;
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldBars: number;
  // Filters
  fundingConfluence: boolean;
  fundingMinAbs: number;     // e.g. 0.00005 = ~ 0.005% per 8h
  oiConfluence: boolean;
  oiDeltaPctMin: number;     // e.g. 2.0% over 24h
  trendAlignment: boolean;
  emaFast: number;           // 20
  emaSlow: number;           // 50
  volRegimeFilter: boolean;
  atrPctMin: number;         // 0.4
  atrPctMax: number;         // 5.0
  // Round 4 — high-conviction WR boosters
  rsiFilter: boolean;
  rsiOversold: number;       // long fade only when RSI <= this (extra oversold)
  rsiOverbought: number;     // short fade only when RSI >= this
  adxFilter: boolean;
  adxMin: number;            // require strong trend (ADX > min)
  fundingExtremeFilter: boolean;
  fundingExtreme: number;    // skip unless |funding| >= this
  // Round 6 — BTC macro filter (altcoins follow BTC)
  btcTrendFilter: boolean;   // require BTC 4H trend to align with fade direction
  btcEmaFast: number;        // 20
  btcEmaSlow: number;        // 50
}

function atr(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return 0;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    );
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

function rsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function adx(bars: Bar[], period: number): number | null {
  if (bars.length < period * 2) return null;
  // Simplified Wilder's ADX: average of |+DI − −DI|/(+DI + −DI) × 100 smoothed.
  const trs: number[] = []; const pDM: number[] = []; const nDM: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const dn = bars[i - 1].l - bars[i].l;
    pDM.push(up > dn && up > 0 ? up : 0);
    nDM.push(dn > up && dn > 0 ? dn : 0);
    trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
  }
  const sumLast = (arr: number[], n: number) => arr.slice(-n).reduce((s, x) => s + x, 0);
  const trN = sumLast(trs, period);
  if (trN === 0) return null;
  const pDI = (sumLast(pDM, period) / trN) * 100;
  const nDI = (sumLast(nDM, period) / trN) * 100;
  const sum = pDI + nDI;
  if (sum === 0) return null;
  return (Math.abs(pDI - nDI) / sum) * 100;
}

function percentile(series: number[], value: number): number {
  let cnt = 0;
  for (const v of series) if (v <= value) cnt++;
  return cnt / series.length;
}

function nearestBefore<T extends { ts: number }>(series: T[], targetTs: number): T | null {
  // Series sorted ascending by ts. Returns last item with ts <= targetTs.
  let lo = 0, hi = series.length - 1, ans: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].ts <= targetTs) { ans = series[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

interface ClosedTrade {
  entryTs: number; exitTs: number;
  side: 'long' | 'short';
  pnlR: number;          // net R after all costs
  pnlRGross: number;     // R before costs (for transparency)
  costR: number;         // total cost in R units
  exitReason: 'sl' | 'tp' | 'time';
}

// Realistic cost model — based on live Bybit rates and our engine fixes.
// SL fills via market trigger (taker fee + slip). TP fills via reduce-only limit
// order (maker fee, no slip). Entry placed as limit per auto-execute.ts:117
// (maker fee, no slip). Time-stop exit at market (taker + slip).
const TAKER_FEE = 0.00055;   // 0.055%
const MAKER_FEE = 0.0002;    // 0.020%
const SL_SLIP = 0.0005;      // 0.05% adverse slip on SL trigger
const TIME_SLIP = 0.0005;    // 0.05% on time-stop market exit
// Funding rates are pulled from CG history and applied at each 4H funding boundary
// crossed during the hold. (Bybit funding cadence is every 8H so 4H rate = boundary
// half-life. Conservatively we apply pulled rate per 4H bar held.)
const FUNDING_PER_4H_FACTOR = 0.5;   // 4H window receives half of the 8H funding rate
const LEVERAGE = 10;

function runBacktest(
  bars: Bar[],
  lsHist: LsPoint[],
  frHist: FrPoint[],
  oiHist: OiPoint[],
  p: Params,
  btcBars?: Bar[],
): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  let openPos: { side: 'long' | 'short'; entry: number; entryTs: number; sl: number; tp: number; entryIdx: number } | null = null;

  const lsValues = lsHist.map(x => x.v);
  const ONE_DAY_MS = 86_400_000;

  for (let i = p.windowBars + p.atrPeriod; i < bars.length; i++) {
    const bar = bars[i];

    // 1) Resolve open position — REALISTIC costs applied.
    if (openPos) {
      const slHit = openPos.side === 'long' ? bar.l <= openPos.sl : bar.h >= openPos.sl;
      const tpHit = openPos.side === 'long' ? bar.h >= openPos.tp : bar.l <= openPos.tp;
      const heldBars = i - openPos.entryIdx;
      const risk = Math.abs(openPos.entry - openPos.sl);

      // Compute funding accrued during this bar (entered last bar, accrue now).
      // Funding charges direction * funding_rate * notional. Convert to R by
      // dividing by riskedUsd. notional / risked = leverage / (stop_pct / 100) ≈ 1/stop_pct%
      // For BTC stop ~2% of price: notional/risked = 1/0.02 = 50. funding 0.01% × 50 = 0.5% of risked = 0.005R per 4H.
      const fr = nearestBefore(frHist, bar.ts);
      const fundingR = fr ? (openPos.side === 'long' ? -1 : 1) * fr.v * FUNDING_PER_4H_FACTOR * (openPos.entry / risk) : 0;

      // Determine fill order using Fix A logic: bar direction.
      // For LONG: bullish bar (close > open) → price went UP first → TP-then-SL.
      //           bearish bar → SL first.
      // For SHORT: bullish bar → SL first.  bearish → TP first.
      const bullish = bar.c > bar.o;
      const tpFirst = openPos.side === 'long' ? bullish : !bullish;

      if (slHit && tpHit) {
        if (tpFirst) {
          const tpFillPrice = openPos.tp;   // limit, no slip
          const pnlPrice = openPos.side === 'long' ? tpFillPrice - openPos.entry : openPos.entry - tpFillPrice;
          const grossR = pnlPrice / risk;
          const feeR = (MAKER_FEE * openPos.entry + MAKER_FEE * tpFillPrice) / risk;
          const costR = feeR - fundingR;
          trades.push({ entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side, pnlR: grossR - costR, pnlRGross: grossR, costR, exitReason: 'tp' });
        } else {
          const slFillPrice = openPos.side === 'long' ? openPos.sl * (1 - SL_SLIP) : openPos.sl * (1 + SL_SLIP);
          const pnlPrice = openPos.side === 'long' ? slFillPrice - openPos.entry : openPos.entry - slFillPrice;
          const grossR = pnlPrice / risk;
          const feeR = (MAKER_FEE * openPos.entry + TAKER_FEE * slFillPrice) / risk;
          const costR = feeR - fundingR;
          trades.push({ entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side, pnlR: grossR - costR, pnlRGross: grossR, costR, exitReason: 'sl' });
        }
        openPos = null;
      } else if (slHit) {
        const slFillPrice = openPos.side === 'long' ? openPos.sl * (1 - SL_SLIP) : openPos.sl * (1 + SL_SLIP);
        const pnlPrice = openPos.side === 'long' ? slFillPrice - openPos.entry : openPos.entry - slFillPrice;
        const grossR = pnlPrice / risk;
        const feeR = (MAKER_FEE * openPos.entry + TAKER_FEE * slFillPrice) / risk;
        const costR = feeR - fundingR;
        trades.push({ entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side, pnlR: grossR - costR, pnlRGross: grossR, costR, exitReason: 'sl' });
        openPos = null;
      } else if (tpHit) {
        const tpFillPrice = openPos.tp;   // limit, no slip
        const pnlPrice = openPos.side === 'long' ? tpFillPrice - openPos.entry : openPos.entry - tpFillPrice;
        const grossR = pnlPrice / risk;
        const feeR = (MAKER_FEE * openPos.entry + MAKER_FEE * tpFillPrice) / risk;
        const costR = feeR - fundingR;
        trades.push({ entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side, pnlR: grossR - costR, pnlRGross: grossR, costR, exitReason: 'tp' });
        openPos = null;
      } else if (heldBars >= p.maxHoldBars) {
        const closeFillPrice = openPos.side === 'long' ? bar.c * (1 - TIME_SLIP) : bar.c * (1 + TIME_SLIP);
        const pnlPrice = openPos.side === 'long' ? closeFillPrice - openPos.entry : openPos.entry - closeFillPrice;
        const grossR = pnlPrice / risk;
        const feeR = (MAKER_FEE * openPos.entry + TAKER_FEE * closeFillPrice) / risk;
        const costR = feeR - fundingR;
        trades.push({ entryTs: openPos.entryTs, exitTs: bar.ts, side: openPos.side, pnlR: grossR - costR, pnlRGross: grossR, costR, exitReason: 'time' });
        openPos = null;
      }
    }
    if (openPos) continue;

    // 2) Compute signal
    const decisionTs = bar.ts;
    const lsAt = nearestBefore(lsHist, decisionTs);
    if (!lsAt) continue;
    const lsWindow = lsValues.slice(Math.max(0, lsHist.indexOf(lsAt) - p.windowBars + 1), lsHist.indexOf(lsAt) + 1);
    if (lsWindow.length < p.windowBars) continue;
    const pct = percentile(lsWindow, lsAt.v);

    let side: 'long' | 'short' | null = null;
    if (pct >= p.pctHi) side = 'short';
    else if (pct <= p.pctLo) side = 'long';
    if (!side) continue;

    // 3) Apply filters
    // B — Funding confluence
    if (p.fundingConfluence) {
      const fr = nearestBefore(frHist, decisionTs);
      if (!fr) continue;
      if (side === 'short' && fr.v < p.fundingMinAbs) continue;   // short fade: want funding positive (longs paying)
      if (side === 'long' && fr.v > -p.fundingMinAbs) continue;   // long fade: want funding negative (shorts paying)
    }

    // C — OI delta confluence
    if (p.oiConfluence) {
      const oiNow = nearestBefore(oiHist, decisionTs);
      const oi24 = nearestBefore(oiHist, decisionTs - ONE_DAY_MS);
      if (!oiNow || !oi24 || oi24.v <= 0) continue;
      const pctChg = ((oiNow.v - oi24.v) / oi24.v) * 100;
      if (Math.abs(pctChg) < p.oiDeltaPctMin) continue;
    }

    // D — Trend alignment (pair's own 4H trend)
    if (p.trendAlignment) {
      const closes = bars.slice(Math.max(0, i - p.emaSlow * 3), i + 1).map(b => b.c);
      const eF = ema(closes, p.emaFast);
      const eS = ema(closes, p.emaSlow);
      if (eF == null || eS == null) continue;
      const trendUp = eF > eS;
      if (side === 'short' && trendUp) continue;
      if (side === 'long' && !trendUp) continue;
    }

    // D2 — BTC macro filter (altcoins follow BTC — only fade aligned with BTC trend)
    if (p.btcTrendFilter && btcBars && btcBars.length > 0) {
      // Find latest BTC bar at or before decisionTs
      let btcIdx = -1;
      for (let k = btcBars.length - 1; k >= 0; k--) {
        if (btcBars[k].ts <= decisionTs) { btcIdx = k; break; }
      }
      if (btcIdx < p.btcEmaSlow * 3) continue;
      const btcCloses = btcBars.slice(Math.max(0, btcIdx - p.btcEmaSlow * 3), btcIdx + 1).map(b => b.c);
      const beF = ema(btcCloses, p.btcEmaFast);
      const beS = ema(btcCloses, p.btcEmaSlow);
      if (beF == null || beS == null) continue;
      const btcTrendUp = beF > beS;
      // Same logic: SHORT fade requires BTC down, LONG fade requires BTC up.
      if (side === 'short' && btcTrendUp) continue;
      if (side === 'long' && !btcTrendUp) continue;
    }

    // 4) Compute ATR for SL/TP
    const lookbackBars = bars.slice(Math.max(0, i - p.atrPeriod * 2), i + 1);
    const a = atr(lookbackBars, p.atrPeriod);
    if (a <= 0) continue;
    const atrPct = (a / bar.c) * 100;

    // E — Volatility regime
    if (p.volRegimeFilter) {
      if (atrPct < p.atrPctMin || atrPct > p.atrPctMax) continue;
    }

    // F — RSI filter (extreme position confirmation)
    if (p.rsiFilter) {
      const closes = bars.slice(Math.max(0, i - 30), i + 1).map(b => b.c);
      const r = rsi(closes, 14);
      if (r == null) continue;
      if (side === 'long' && r > p.rsiOversold) continue;     // long fade only when extra oversold
      if (side === 'short' && r < p.rsiOverbought) continue;
    }

    // G — ADX filter (require strong trend)
    if (p.adxFilter) {
      const adxVal = adx(bars.slice(Math.max(0, i - 60), i + 1), 14);
      if (adxVal == null || adxVal < p.adxMin) continue;
    }

    // H — Funding extreme (only the strongest crowd skew)
    if (p.fundingExtremeFilter) {
      const fr = nearestBefore(frHist, decisionTs);
      if (!fr) continue;
      if (Math.abs(fr.v) < p.fundingExtreme) continue;
      // Direction must match: short fade wants funding positive (longs paying)
      if (side === 'short' && fr.v < 0) continue;
      if (side === 'long' && fr.v > 0) continue;
    }

    // 5) Open
    const sl = side === 'long' ? bar.c - p.slAtrMult * a : bar.c + p.slAtrMult * a;
    const tp = side === 'long' ? bar.c + p.tpAtrMult * a : bar.c - p.tpAtrMult * a;
    openPos = { side, entry: bar.c, entryTs: bar.ts, sl, tp, entryIdx: i };
  }

  return trades;
}

function metrics(trades: ClosedTrade[]) {
  if (trades.length === 0) return { n: 0, wr: 0, avgR: 0, sumR: 0, pf: 0, longs: 0, shorts: 0, byReason: {} };
  const wins = trades.filter(t => t.pnlR > 0);
  const losses = trades.filter(t => t.pnlR < 0);
  const sumR = trades.reduce((s, t) => s + t.pnlR, 0);
  const sumWin = wins.reduce((s, t) => s + t.pnlR, 0);
  const sumLoss = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
  const pf = sumLoss > 0 ? sumWin / sumLoss : Infinity;
  return {
    n: trades.length,
    wr: wins.length / trades.length * 100,
    avgR: sumR / trades.length,
    sumR,
    pf,
    longs: trades.filter(t => t.side === 'long').length,
    shorts: trades.filter(t => t.side === 'short').length,
  };
}

// Compute equity curve and drawdown for a sorted-by-time trade series and a
// given riskPct (compounding: each trade risks riskPct of CURRENT equity).
function equityMetrics(trades: ClosedTrade[], startEquity: number, riskPct: number) {
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);
  let equity = startEquity;
  let peak = startEquity;
  let maxDD = 0;
  let maxDDStartTs = 0;
  let maxDDEndTs = 0;
  let curDDStart = 0;
  let consLoss = 0, maxConsLoss = 0;
  let consWin = 0, maxConsWin = 0;
  const curve: { ts: number; equity: number; dd: number }[] = [{ ts: sorted[0]?.entryTs ?? 0, equity, dd: 0 }];
  for (const t of sorted) {
    const riskUsd = equity * (riskPct / 100);
    const pnlUsd = t.pnlR * riskUsd;
    equity += pnlUsd;
    if (equity > peak) { peak = equity; curDDStart = t.exitTs; }
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) { maxDD = dd; maxDDStartTs = curDDStart; maxDDEndTs = t.exitTs; }
    curve.push({ ts: t.exitTs, equity, dd });
    if (t.pnlR > 0) { consWin++; consLoss = 0; if (consWin > maxConsWin) maxConsWin = consWin; }
    else if (t.pnlR < 0) { consLoss++; consWin = 0; if (consLoss > maxConsLoss) maxConsLoss = consLoss; }
  }
  const ret = (equity - startEquity) / startEquity * 100;
  return { startEquity, finalEquity: equity, ret, maxDD, maxDDStartTs, maxDDEndTs, maxConsLoss, maxConsWin, curve };
}

async function main() {
  const pair = process.env.BT_PAIR ?? 'BTCUSDT';
  const coin = pair.replace(/USDT$/, '');
  console.log(`Loading data for ${pair}...`);
  const bars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts`,
    [pair]
  )).rows.map(r => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));
  const lsHist: LsPoint[] = (await query<any>(
    `SELECT ts::text, ratio::text FROM cg_ls_top_position WHERE pair=$1 ORDER BY ts`,
    [pair]
  )).rows.map(r => ({ ts: Number(r.ts), v: Number(r.ratio) }));
  const frHist: FrPoint[] = (await query<any>(
    `SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol=$1 ORDER BY ts`,
    [coin]
  )).rows.map(r => ({ ts: Number(r.ts), v: Number(r.fr_close) }));
  const oiHist: OiPoint[] = (await query<any>(
    `SELECT ts::text, oi_close::text FROM cg_oi_aggregated WHERE symbol=$1 ORDER BY ts`,
    [coin]
  )).rows.map(r => ({ ts: Number(r.ts), v: Number(r.v ?? r.oi_close) }));

  // Always load BTC bars too — used as macro filter for altcoins
  const btcBars: Bar[] = (await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts`
  )).rows.map(r => ({ ts: Number(r.ts), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close) }));
  console.log(`${pair} 4H bars: ${bars.length}  L/S: ${lsHist.length}  funding: ${frHist.length}  OI: ${oiHist.length}   BTC bars (macro): ${btcBars.length}`);

  const BASE: Params = {
    pctHi: 0.85, pctLo: 0.15, windowBars: 180,
    atrPeriod: 14, slAtrMult: 1.5, tpAtrMult: 3.0, maxHoldBars: 18,
    fundingConfluence: false, fundingMinAbs: 0.00005,
    oiConfluence: false, oiDeltaPctMin: 2.0,
    trendAlignment: false, emaFast: 20, emaSlow: 50,
    volRegimeFilter: false, atrPctMin: 0.4, atrPctMax: 5.0,
    rsiFilter: false, rsiOversold: 30, rsiOverbought: 70,
    adxFilter: false, adxMin: 20,
    fundingExtremeFilter: false, fundingExtreme: 0.0001,
    btcTrendFilter: false, btcEmaFast: 20, btcEmaSlow: 50,
  };

  const variants: Array<{ name: string; p: Partial<Params> }> = [
    { name: 'Baseline 0.85/0.15           ', p: {} },
    { name: 'Tighter 0.90/0.10            ', p: { pctHi: 0.90, pctLo: 0.10 } },
    { name: 'Tighter 0.95/0.05            ', p: { pctHi: 0.95, pctLo: 0.05 } },
    { name: 'Tighter 0.97/0.03            ', p: { pctHi: 0.97, pctLo: 0.03 } },
    { name: '+Funding conf               ', p: { fundingConfluence: true } },
    { name: '+OI conf (delta>2%)         ', p: { oiConfluence: true } },
    { name: '+Trend align                 ', p: { trendAlignment: true } },
    { name: '+Vol regime (0.4..5%)        ', p: { volRegimeFilter: true } },
    { name: 'Trend + Funding              ', p: { trendAlignment: true, fundingConfluence: true } },
    { name: 'Trend + OI                   ', p: { trendAlignment: true, oiConfluence: true } },
    { name: 'Trend + Funding + OI         ', p: { trendAlignment: true, fundingConfluence: true, oiConfluence: true } },
    { name: '0.95 + Trend                 ', p: { pctHi: 0.95, pctLo: 0.05, trendAlignment: true } },
    { name: '0.95 + Trend + Funding       ', p: { pctHi: 0.95, pctLo: 0.05, trendAlignment: true, fundingConfluence: true } },
    { name: '0.95 + Trend + OI + Vol      ', p: { pctHi: 0.95, pctLo: 0.05, trendAlignment: true, oiConfluence: true, volRegimeFilter: true } },
    { name: 'TP 4x (1.5sl/4tp)            ', p: { tpAtrMult: 4.0 } },
    { name: 'TP 2x +Trend                 ', p: { tpAtrMult: 2.0, trendAlignment: true } },
    // Round 2 — combine best
    { name: 'TP 2x +Trend +OI             ', p: { tpAtrMult: 2.0, trendAlignment: true, oiConfluence: true } },
    { name: 'TP 2x +Trend +Funding        ', p: { tpAtrMult: 2.0, trendAlignment: true, fundingConfluence: true } },
    { name: 'TP 2x +Trend +OI +Funding    ', p: { tpAtrMult: 2.0, trendAlignment: true, oiConfluence: true, fundingConfluence: true } },
    { name: 'TP 1.5x +Trend               ', p: { tpAtrMult: 1.5, trendAlignment: true } },
    { name: 'TP 2.5x +Trend               ', p: { tpAtrMult: 2.5, trendAlignment: true } },
    { name: 'SL 1.2 TP 2.0 +Trend         ', p: { slAtrMult: 1.2, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'SL 1.8 TP 2.4 +Trend         ', p: { slAtrMult: 1.8, tpAtrMult: 2.4, trendAlignment: true } },
    { name: 'Window 90 + TP 2x +Trend     ', p: { windowBars: 90, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'Window 120 + TP 2x +Trend    ', p: { windowBars: 120, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'pct 0.80/0.20 + TP 2x +Trend ', p: { pctHi: 0.80, pctLo: 0.20, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'pct 0.90/0.10 + TP 2x +Trend ', p: { pctHi: 0.90, pctLo: 0.10, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'hold 12 + TP 2x +Trend       ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'hold 24 + TP 2x +Trend       ', p: { maxHoldBars: 24, tpAtrMult: 2.0, trendAlignment: true } },
    // Round 3 — Combine top-2 (pct 0.80 + hold 12)
    { name: 'pct 0.80 hold 12 +Trend      ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'pct 0.75 hold 12 +Trend      ', p: { pctHi: 0.75, pctLo: 0.25, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'pct 0.80 hold 12 +Trend +OI  ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, oiConfluence: true } },
    { name: 'pct 0.80 hold 12 +Trend +Fnd ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, fundingConfluence: true } },
    { name: 'pct 0.80 hold 8 +Trend       ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 8, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'pct 0.80 hold 18 +Trend      ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 18, tpAtrMult: 2.0, trendAlignment: true } },
    // EMA fast/slow variations
    { name: 'EMA 50/200 + TP 2x +Trend    ', p: { tpAtrMult: 2.0, trendAlignment: true, emaFast: 50, emaSlow: 200 } },
    { name: 'EMA 10/30 + TP 2x +Trend     ', p: { tpAtrMult: 2.0, trendAlignment: true, emaFast: 10, emaSlow: 30 } },
    // Round 4 — WR boosters (sacrifice trades for quality)
    { name: 'BEST +RSI 30/70              ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, rsiFilter: true, rsiOversold: 30, rsiOverbought: 70 } },
    { name: 'BEST +RSI 35/65              ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, rsiFilter: true, rsiOversold: 35, rsiOverbought: 65 } },
    { name: 'BEST +RSI 40/60 (loose)      ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, rsiFilter: true, rsiOversold: 40, rsiOverbought: 60 } },
    { name: 'BEST +ADX 20                 ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, adxFilter: true, adxMin: 20 } },
    { name: 'BEST +ADX 25                 ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, adxFilter: true, adxMin: 25 } },
    { name: 'BEST +Fund extreme           ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, fundingExtremeFilter: true, fundingExtreme: 0.0001 } },
    { name: 'BEST +Vol 0.4..3             ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, volRegimeFilter: true, atrPctMin: 0.4, atrPctMax: 3.0 } },
    { name: 'BEST +OI delta>3             ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, oiConfluence: true, oiDeltaPctMin: 3.0 } },
    { name: 'BEST +RSI 35/65 +OI 3        ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, rsiFilter: true, rsiOversold: 35, rsiOverbought: 65, oiConfluence: true, oiDeltaPctMin: 3.0 } },
    { name: 'BEST +RSI 35/65 +ADX 20      ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, rsiFilter: true, rsiOversold: 35, rsiOverbought: 65, adxFilter: true, adxMin: 20 } },
    { name: 'pct 0.80 hold 8 +RSI 35/65   ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 8, tpAtrMult: 2.0, trendAlignment: true, rsiFilter: true, rsiOversold: 35, rsiOverbought: 65 } },
    // Round 5 — Aggressive TP for WR boost (low R/R)
    { name: 'SL 1.5 TP 1.5 +Trend (1:1)  ', p: { slAtrMult: 1.5, tpAtrMult: 1.5, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'SL 1.5 TP 1.2 +Trend (0.8)  ', p: { slAtrMult: 1.5, tpAtrMult: 1.2, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'SL 2.0 TP 1.5 +Trend (0.75) ', p: { slAtrMult: 2.0, tpAtrMult: 1.5, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'SL 2.0 TP 1.0 +Trend (0.5)  ', p: { slAtrMult: 2.0, tpAtrMult: 1.0, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'SL 2.5 TP 1.5 +Trend (0.6)  ', p: { slAtrMult: 2.5, tpAtrMult: 1.5, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'SL 1.2 TP 1.0 +Trend (0.83) ', p: { slAtrMult: 1.2, tpAtrMult: 1.0, trendAlignment: true, maxHoldBars: 12 } },
    // 0.80/0.20 pct variants with low TP
    { name: 'pct 0.80 SL1.5 TP1.5 +Trend ', p: { pctHi: 0.80, pctLo: 0.20, slAtrMult: 1.5, tpAtrMult: 1.5, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'pct 0.80 SL2 TP1.5 +Trend   ', p: { pctHi: 0.80, pctLo: 0.20, slAtrMult: 2.0, tpAtrMult: 1.5, trendAlignment: true, maxHoldBars: 12 } },
    { name: 'pct 0.80 SL2 TP1 +Trend     ', p: { pctHi: 0.80, pctLo: 0.20, slAtrMult: 2.0, tpAtrMult: 1.0, trendAlignment: true, maxHoldBars: 12 } },
    // Round 6 — BTC macro filter (especially important for altcoins)
    { name: 'Champion +BTC trend         ', p: { maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, btcTrendFilter: true } },
    { name: 'BTC trend ONLY (no pair-T)  ', p: { maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true } },
    { name: 'Champ +BTC trend +pct 0.80  ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true, btcTrendFilter: true } },
    { name: 'BTC trend +pct 0.80 only    ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true } },
    { name: 'BTC trend +pct 0.75 only    ', p: { pctHi: 0.75, pctLo: 0.25, maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true } },
    { name: 'BTC trend +pct 0.70 only    ', p: { pctHi: 0.70, pctLo: 0.30, maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true } },
    { name: 'BTC EMA10/30 +pct 0.80      ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true, btcEmaFast: 10, btcEmaSlow: 30 } },
    { name: 'BTC EMA50/200 +pct 0.80     ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true, btcEmaFast: 50, btcEmaSlow: 200 } },
    // pair-specific exploration
    { name: 'pct 0.70 SL2 TP1.5 +BTC     ', p: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 1.5, maxHoldBars: 12, btcTrendFilter: true } },
    { name: 'pct 0.70 SL2 TP2 +BTC       ', p: { pctHi: 0.70, pctLo: 0.30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, btcTrendFilter: true } },
    { name: 'pct 0.85 SL1.5 TP2 +BTC     ', p: { maxHoldBars: 12, tpAtrMult: 2.0, btcTrendFilter: true } }, // same as 'BTC trend ONLY'
    { name: 'hold 8 +BTC trend           ', p: { maxHoldBars: 8, tpAtrMult: 2.0, btcTrendFilter: true } },
    { name: 'pct 0.80 hold 8 +BTC trend  ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 8, tpAtrMult: 2.0, btcTrendFilter: true } },
    { name: 'pct 0.80 hold 6 +BTC trend  ', p: { pctHi: 0.80, pctLo: 0.20, maxHoldBars: 6, tpAtrMult: 2.0, btcTrendFilter: true } },
  ];

  console.log('\n=== Grid (sorted by sumR desc) ===');
  const results: { name: string; m: ReturnType<typeof metrics> }[] = [];
  for (const v of variants) {
    const p = { ...BASE, ...v.p };
    const trades = runBacktest(bars, lsHist, frHist, oiHist, p, btcBars);
    const m = metrics(trades);
    results.push({ name: v.name, m });
  }
  results.sort((a, b) => b.m.sumR - a.m.sumR);
  console.log('name                            |  n   WR%   avgR  sumR    PF    L/S');
  console.log('---------------------------------------------------------------------');
  for (const r of results) {
    const m = r.m;
    console.log(
      `${r.name.padEnd(32)}| ${String(m.n).padStart(3)}  ${m.wr.toFixed(1).padStart(4)}% ${m.avgR.toFixed(3).padStart(6)} ${m.sumR.toFixed(2).padStart(6)} ${m.pf.toFixed(2).padStart(5)}  ${m.longs}/${m.shorts}`
    );
  }

  // Champion deep-dive: equity curve + DD across risk levels
  const championP: Params = { ...BASE, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true };
  const champTrades = runBacktest(bars, lsHist, frHist, oiHist, championP, btcBars);
  console.log('\n=== CHAMPION DEEP-DIVE (hold 12 + TP 2× + Trend, BTC 365d) ===');
  const cm = metrics(champTrades);
  console.log(`Trades: ${cm.n} (W:${Math.round(cm.wr * cm.n / 100)}, L:${cm.n - Math.round(cm.wr * cm.n / 100)})`);
  console.log(`WR: ${cm.wr.toFixed(1)}%   avgR: ${cm.avgR.toFixed(3)}   sumR: ${cm.sumR.toFixed(2)}   PF: ${cm.pf.toFixed(2)}`);
  console.log(`Longs/Shorts: ${cm.longs}/${cm.shorts}`);

  console.log('\n--- Risk scenarios (startEquity $50,000) ---');
  console.log('risk%  | finalEq    return%   MaxDD%   DD start → end          maxConsL  maxConsW');
  for (const risk of [0.25, 0.375, 0.5, 0.75, 1.0, 1.5]) {
    const em = equityMetrics(champTrades, 50_000, risk);
    const ddStart = em.maxDDStartTs ? new Date(em.maxDDStartTs).toISOString().slice(0, 10) : 'n/a';
    const ddEnd = em.maxDDEndTs ? new Date(em.maxDDEndTs).toISOString().slice(0, 10) : 'n/a';
    console.log(
      `${risk.toFixed(3).padStart(5)}  | $${em.finalEquity.toFixed(0).padStart(8)}  ${em.ret.toFixed(2).padStart(6)}%   ${em.maxDD.toFixed(2).padStart(5)}%   ${ddStart} → ${ddEnd}   ${String(em.maxConsLoss).padStart(8)}  ${String(em.maxConsWin).padStart(8)}`
    );
  }

  // ===================================================================
  // IS / OOS analysis — multiple splits on the CHAMPION config
  // ===================================================================
  console.log('\n=== IS / OOS ANALYSIS (Champion: hold 12 + TP 2× + Trend) ===');
  const champFullTrades = runBacktest(bars, lsHist, frHist, oiHist, championP, btcBars);
  const cgFirst = lsHist[0].ts;
  const cgLast = lsHist[lsHist.length - 1].ts;
  const span = cgLast - cgFirst;

  console.log('\n--- A. Train/Test splits (anchored) ---');
  console.log('  split   | IS trades  WR    sumR    avgR  |  OOS trades  WR    sumR    avgR  | IS-OOS gap');
  for (const ratio of [0.5, 0.6, 0.7, 0.8]) {
    const splitTs = cgFirst + Math.floor(span * ratio);
    const isTrades  = champFullTrades.filter(t => t.entryTs <  splitTs);
    const oosTrades = champFullTrades.filter(t => t.entryTs >= splitTs);
    const mi = metrics(isTrades);
    const mo = metrics(oosTrades);
    const gap = (mi.avgR - mo.avgR);
    const gapColor = Math.abs(gap) < 0.10 ? '✓' : Math.abs(gap) < 0.20 ? '~' : '✗';
    console.log(
      `  ${ratio.toFixed(1)}/${(1-ratio).toFixed(1)}   | ${String(mi.n).padStart(3)}  ${mi.wr.toFixed(1).padStart(4)}% ${mi.sumR.toFixed(2).padStart(7)} ${mi.avgR.toFixed(3).padStart(6)}  | ${String(mo.n).padStart(4)}    ${mo.wr.toFixed(1).padStart(4)}% ${mo.sumR.toFixed(2).padStart(7)} ${mo.avgR.toFixed(3).padStart(6)}  | ${gap.toFixed(3)} ${gapColor}`
    );
  }

  console.log('\n--- B. Per-quarter performance ---');
  console.log('  quarter             | trades  WR     sumR    avgR    PF');
  const quarterStart = cgFirst;
  const quarterMs = Math.floor(span / 4);
  for (let q = 0; q < 4; q++) {
    const qStart = quarterStart + q * quarterMs;
    const qEnd = q === 3 ? cgLast : quarterStart + (q + 1) * quarterMs;
    const qTrades = champFullTrades.filter(t => t.entryTs >= qStart && t.entryTs < qEnd);
    const m = metrics(qTrades);
    const label = `${new Date(qStart).toISOString().slice(0,7)} → ${new Date(qEnd).toISOString().slice(0,7)}`;
    console.log(
      `  ${label.padEnd(20)} | ${String(m.n).padStart(3)}     ${m.wr.toFixed(1).padStart(4)}% ${m.sumR.toFixed(2).padStart(7)} ${m.avgR.toFixed(3).padStart(7)} ${m.pf.toFixed(2).padStart(5)}`
    );
  }

  console.log('\n--- C. Rolling walk-forward: train 6mo / test next 1mo ---');
  console.log('  (each row: train on N months ending at split, test on 1 month after)');
  console.log('  test period          | IS sumR  IS WR  | OOS trades OOS WR  OOS sumR  | stable?');
  // Skip first 6 months (used as initial train) — start testing from month 7
  const monthMs = quarterMs / 3;  // approx 1 month
  for (let m = 6; m < 12; m++) {
    const splitTs = cgFirst + Math.floor(m * monthMs);
    const trainEnd = splitTs;
    const testEnd  = Math.min(cgLast, splitTs + Math.floor(monthMs));
    const trainTs  = splitTs - Math.floor(6 * monthMs);
    const isTrades  = champFullTrades.filter(t => t.entryTs >= trainTs && t.entryTs < trainEnd);
    const oosTrades = champFullTrades.filter(t => t.entryTs >= trainEnd && t.entryTs < testEnd);
    const mi = metrics(isTrades);
    const mo = metrics(oosTrades);
    const stable = mo.sumR >= 0 ? '✓' : '✗';
    const label = `${new Date(trainEnd).toISOString().slice(0,7)} → ${new Date(testEnd).toISOString().slice(0,7)}`;
    console.log(
      `  ${label.padEnd(20)} | ${mi.sumR.toFixed(2).padStart(7)}  ${mi.wr.toFixed(1).padStart(4)}%  | ${String(mo.n).padStart(4)}      ${mo.wr.toFixed(1).padStart(4)}%   ${mo.sumR.toFixed(2).padStart(7)}  | ${stable}`
    );
  }

  // Walk-forward on top candidates
  console.log('\n=== Walk-forward (train 50% / test 50%) on top-3 ===');
  const finalists: Array<{ name: string; p: Params }> = [
    { name: 'pct 0.80 hold 8 +Trend', p: { ...BASE, pctHi: 0.80, pctLo: 0.20, maxHoldBars: 8, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'hold 12 + TP 2x +Trend', p: { ...BASE, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true } },
    { name: 'pct 0.80 hold 12 +Trend', p: { ...BASE, pctHi: 0.80, pctLo: 0.20, maxHoldBars: 12, tpAtrMult: 2.0, trendAlignment: true } },
  ];

  // Split within CG history window (since signals only exist there)
  const cgFirstTs = lsHist[0].ts;
  const cgLastTs = lsHist[lsHist.length - 1].ts;
  const splitTs = cgFirstTs + Math.floor((cgLastTs - cgFirstTs) * 0.5);
  console.log(`CG span: ${new Date(cgFirstTs).toISOString().slice(0,10)} → ${new Date(cgLastTs).toISOString().slice(0,10)}, split: ${new Date(splitTs).toISOString().slice(0,10)}`);
  console.log('config                       | TRAIN trades WR%  sumR | TEST trades WR%  sumR | stability');
  for (const f of finalists) {
    const trades = runBacktest(bars, lsHist, frHist, oiHist, f.p, btcBars);
    const train = trades.filter(t => t.entryTs < splitTs);
    const test  = trades.filter(t => t.entryTs >= splitTs);
    const m1 = metrics(train);
    const m2 = metrics(test);
    const stable = (m1.sumR > 0 && m2.sumR > 0) ? '✓ both +' : (m1.sumR > 0 || m2.sumR > 0) ? '~ mixed' : '✗ both −';
    console.log(
      `${f.name.padEnd(28)} | ${String(m1.n).padStart(6)} ${m1.wr.toFixed(1).padStart(4)}% ${m1.sumR.toFixed(2).padStart(6)} | ${String(m2.n).padStart(5)} ${m2.wr.toFixed(1).padStart(4)}% ${m2.sumR.toFixed(2).padStart(6)} | ${stable}`
    );
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
