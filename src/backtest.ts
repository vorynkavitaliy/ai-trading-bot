/**
 * Playbook A (Range Fade) backtest — BTCUSDT 1H.
 *
 * Strategy under test:
 *   LONG  when close ≤ BB(20, σ).lower AND RSI<rsiLo AND ADX<adxMax
 *         AND lower-wick rejection ≥50% AND volume spike.
 *   SHORT symmetric at upper BB.
 *   SL: outer BB edge ± 0.5×ATR(1H).
 *   TP1 (50% size): SMA20 (middle BB).
 *   TP2 (50% size): opposite BB band.
 *   Abort: ADX cross above adxAbort before TP1.
 *
 * Fills: pessimistic — SL checked before TP on same bar.
 * Fees: 0.055% taker per side (0.11% round-trip) baked into realized P&L.
 * Risk: fixed 0.5% of running equity per trade.
 *
 * Usage:
 *   npx tsx src/backtest.ts                      # full grid sweep
 *   npx tsx src/backtest.ts --single             # single run with default params
 */

import { BybitClient } from './core/bybit-client.js';
import { AccountManager } from './core/account-manager.js';
import { Candle } from './analysis/indicators.js';
import { BollingerBands, ATR, RSI, ADX, SMA, EMA } from 'technicalindicators';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const INTERVAL = '60' as const; // 1H
const DAYS = Number(process.env.BT_DAYS) || 365;
const FEE_ROUND_TRIP = 0.0011; // 0.055% × 2
const RISK_PCT = 0.005;        // 0.5% per trade
const START_EQUITY = 100_000;

// ───────────────────────────────────────────── data fetch ─────────────────────────────────────────────

async function fetchHistory(symbol: string, days: number): Promise<Candle[]> {
  const mgr = new AccountManager();
  const client = new BybitClient(mgr);
  const needBars = days * 24;
  const bars: Candle[] = [];
  let endMs = Date.now();

  while (bars.length < needBars) {
    const page = await client.getKlinesPage(symbol, INTERVAL, endMs, 1000);
    if (page.length === 0) break;
    bars.unshift(...page);
    endMs = page[0].timestamp - 1;
    if (page.length < 1000) break;
  }

  // Deduplicate + chronological
  const seen = new Set<number>();
  const clean = bars.filter((b) => {
    if (seen.has(b.timestamp)) return false;
    seen.add(b.timestamp);
    return true;
  }).sort((a, b) => a.timestamp - b.timestamp);

  return clean.slice(-needBars);
}

// ───────────────────────────────────────────── indicator series ─────────────────────────────────────────────

interface Series {
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  rsi: number[];
  adx: number[];
  pdi: number[];
  mdi: number[];
  atr: number[];
  sma20: number[];
  volSma: number[];
  ema8: number[];
  ema21: number[];
  ema55: number[];
  ema200: number[];
}

function computeSeries(candles: Candle[], bbStd: number): Series {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volume);

  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: bbStd });
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const volSma = SMA.calculate({ values: vols, period: 20 });

  // Pad to align with candles array length (indicators return shorter arrays)
  const pad = (arr: any[], len: number, valKey?: string) => {
    const out: number[] = new Array(len - arr.length).fill(NaN);
    for (const v of arr) out.push(valKey ? v[valKey] : v);
    return out;
  };

  const ema8 = EMA.calculate({ values: closes, period: 8 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema55 = EMA.calculate({ values: closes, period: 55 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });

  return {
    bbUpper: pad(bb, candles.length, 'upper'),
    bbMiddle: pad(bb, candles.length, 'middle'),
    bbLower: pad(bb, candles.length, 'lower'),
    rsi: pad(rsi, candles.length),
    adx: pad(adx, candles.length, 'adx'),
    pdi: pad(adx, candles.length, 'pdi'),
    mdi: pad(adx, candles.length, 'mdi'),
    atr: pad(atr, candles.length),
    sma20: pad(sma20, candles.length),
    volSma: pad(volSma, candles.length),
    ema8: pad(ema8, candles.length),
    ema21: pad(ema21, candles.length),
    ema55: pad(ema55, candles.length),
    ema200: pad(ema200, candles.length),
  };
}

// ───────────────────────────────────────────── trade simulation ─────────────────────────────────────────────

interface Params {
  // Playbook A (range fade)
  bbStd: number;
  rsiLo: number;
  rsiHi: number;
  adxMax: number;          // A: enter only if ADX < this
  adxAbort: number;        // A: abort if ADX rises above this
  atrBufferMult: number;
  volSpikeMult: number;
  wickPctMin: number;
}

interface ParamsB {
  // Playbook B (trend pullback)
  adxMin: number;          // B: enter only if ADX > this
  adxAbortB: number;       // B: abort if ADX falls below this
  pullbackEma: 21 | 55;    // which EMA to pullback-to
  pullbackTolPct: number;  // price within tol × EMA
  rsiMid: number;          // LONG: RSI must be > this (not oversold)
  slAtrMult: number;       // SL = swing low/high + mult × ATR
  tp1R: number;            // TP1 = entry ± r × risk
  trailAtrMult: number;    // Chandelier trail after TP1
}

interface Trade {
  side: 'LONG' | 'SHORT';
  entryIdx: number;
  exitIdx: number;
  entryPrice: number;
  exitPrice: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  sizeUsd: number;         // notional
  realizedR: number;       // realized return in "R" (where 1R = risked amount)
  pnlUsd: number;          // gross P&L after fees
  exitReason: 'sl' | 'tp1+tp2' | 'tp1+trail' | 'tp1+sl' | 'abort' | 'eod';
  entryTs: number;
  exitTs: number;
}

function lowerWickPct(c: Candle): number {
  const range = Math.max(c.high - c.low, 1e-9);
  return (Math.min(c.open, c.close) - c.low) / range;
}

function upperWickPct(c: Candle): number {
  const range = Math.max(c.high - c.low, 1e-9);
  return (c.high - Math.max(c.open, c.close)) / range;
}

function runStrategy(candles: Candle[], s: Series, p: Params): Trade[] {
  const trades: Trade[] = [];
  let equity = START_EQUITY;
  const warmup = 40; // enough for all indicators

  for (let i = warmup; i < candles.length - 1; i++) {
    const c = candles[i];
    const bbU = s.bbUpper[i];
    const bbL = s.bbLower[i];
    const bbM = s.bbMiddle[i];
    const rsi = s.rsi[i];
    const adx = s.adx[i];
    const atr = s.atr[i];
    const volAvg = s.volSma[i];
    if ([bbU, bbL, bbM, rsi, adx, atr, volAvg].some(Number.isNaN)) continue;

    const volOk = c.volume >= volAvg * p.volSpikeMult;
    const regimeOk = adx < p.adxMax;

    let side: 'LONG' | 'SHORT' | null = null;
    let entry = c.close, sl = 0, tp1 = bbM, tp2 = 0;

    if (regimeOk && volOk) {
      if (c.low <= bbL && rsi < p.rsiLo && lowerWickPct(c) >= p.wickPctMin) {
        side = 'LONG';
        sl = bbL - p.atrBufferMult * atr;
        tp2 = bbU;
      } else if (c.high >= bbU && rsi > p.rsiHi && upperWickPct(c) >= p.wickPctMin) {
        side = 'SHORT';
        sl = bbU + p.atrBufferMult * atr;
        tp2 = bbL;
      }
    }
    if (!side) continue;

    // Validate stop distance (sanity: SL must be beyond entry in correct direction)
    const stopDist = Math.abs(entry - sl);
    if (stopDist < atr * 0.3) continue; // refuse absurdly tight stops

    const riskUsd = equity * RISK_PCT;
    const sizeUsd = (riskUsd / stopDist) * entry; // notional
    if (sizeUsd > equity * 10) continue; // cap at 10× equity (leverage sanity)

    // Walk forward to resolve the trade
    let filledTp1 = false;
    let exitIdx = -1, exitPrice = 0;
    let exitReason: Trade['exitReason'] = 'eod';
    let remainingSize = sizeUsd;
    let realizedPnl = 0;

    for (let j = i + 1; j < candles.length; j++) {
      const next = candles[j];
      const nextAdx = s.adx[j];

      // Abort if ADX crosses above threshold before TP1
      if (!filledTp1 && !Number.isNaN(nextAdx) && nextAdx >= p.adxAbort) {
        exitIdx = j; exitPrice = next.close; exitReason = 'abort';
        realizedPnl += signedPnl(side, entry, exitPrice, remainingSize);
        break;
      }

      // LONG exits
      if (side === 'LONG') {
        const slHit = next.low <= sl;
        const tp1Hit = !filledTp1 && next.high >= tp1;
        const tp2Hit = filledTp1 && next.high >= tp2;

        if (slHit) {
          // Pessimistic: SL first
          realizedPnl += signedPnl('LONG', entry, sl, remainingSize);
          exitIdx = j; exitPrice = sl;
          exitReason = filledTp1 ? 'tp1+sl' : 'sl';
          break;
        }
        if (!filledTp1 && tp1Hit) {
          const halfSize = sizeUsd / 2;
          realizedPnl += signedPnl('LONG', entry, tp1, halfSize);
          remainingSize -= halfSize;
          filledTp1 = true;
          // trail SL to breakeven
          sl = entry;
          continue;
        }
        if (filledTp1 && tp2Hit) {
          realizedPnl += signedPnl('LONG', entry, tp2, remainingSize);
          exitIdx = j; exitPrice = tp2; exitReason = 'tp1+tp2';
          break;
        }
      }

      // SHORT exits
      if (side === 'SHORT') {
        const slHit = next.high >= sl;
        const tp1Hit = !filledTp1 && next.low <= tp1;
        const tp2Hit = filledTp1 && next.low <= tp2;

        if (slHit) {
          realizedPnl += signedPnl('SHORT', entry, sl, remainingSize);
          exitIdx = j; exitPrice = sl;
          exitReason = filledTp1 ? 'tp1+sl' : 'sl';
          break;
        }
        if (!filledTp1 && tp1Hit) {
          const halfSize = sizeUsd / 2;
          realizedPnl += signedPnl('SHORT', entry, tp1, halfSize);
          remainingSize -= halfSize;
          filledTp1 = true;
          sl = entry;
          continue;
        }
        if (filledTp1 && tp2Hit) {
          realizedPnl += signedPnl('SHORT', entry, tp2, remainingSize);
          exitIdx = j; exitPrice = tp2; exitReason = 'tp1+tp2';
          break;
        }
      }
    }

    if (exitIdx === -1) {
      // Force close at end
      const last = candles[candles.length - 1];
      realizedPnl += signedPnl(side, entry, last.close, remainingSize);
      exitIdx = candles.length - 1; exitPrice = last.close;
    }

    // Fees: round-trip on notional
    const fees = sizeUsd * FEE_ROUND_TRIP;
    realizedPnl -= fees;

    const realizedR = realizedPnl / riskUsd;

    trades.push({
      side,
      entryIdx: i, exitIdx,
      entryPrice: entry, exitPrice,
      slPrice: sl, tp1Price: tp1, tp2Price: tp2,
      sizeUsd, realizedR, pnlUsd: realizedPnl,
      exitReason,
      entryTs: c.timestamp, exitTs: candles[exitIdx].timestamp,
    });
    equity += realizedPnl;

    // Skip ahead so we don't overlap positions
    i = exitIdx;
  }

  return trades;
}

function signedPnl(side: 'LONG' | 'SHORT', entry: number, exit: number, notional: number): number {
  const qty = notional / entry;
  return side === 'LONG' ? qty * (exit - entry) : qty * (entry - exit);
}

// ───────────────────────────────────────────── Playbook B (trend pullback) ─────────────────────────────────────────────

function swingLow(candles: Candle[], endIdx: number, look = 10): number {
  let lo = candles[endIdx].low;
  for (let i = Math.max(0, endIdx - look); i < endIdx; i++) {
    if (candles[i].low < lo) lo = candles[i].low;
  }
  return lo;
}

function swingHigh(candles: Candle[], endIdx: number, look = 10): number {
  let hi = candles[endIdx].high;
  for (let i = Math.max(0, endIdx - look); i < endIdx; i++) {
    if (candles[i].high > hi) hi = candles[i].high;
  }
  return hi;
}

function runStrategyB(candles: Candle[], s: Series, p: ParamsB): Trade[] {
  const trades: Trade[] = [];
  let equity = START_EQUITY;
  const warmup = 200; // EMA200 warmup

  for (let i = warmup; i < candles.length - 1; i++) {
    const c = candles[i];
    const adx = s.adx[i], pdi = s.pdi[i], mdi = s.mdi[i];
    const e8 = s.ema8[i], e21 = s.ema21[i], e55 = s.ema55[i], e200 = s.ema200[i];
    const rsi = s.rsi[i], atr = s.atr[i];
    if ([adx, pdi, mdi, e8, e21, e55, e200, rsi, atr].some(Number.isNaN)) continue;

    if (adx < p.adxMin) continue;

    const longStack = e8 > e21 && e21 > e55 && e55 > e200 && pdi > mdi;
    const shortStack = e8 < e21 && e21 < e55 && e55 < e200 && mdi > pdi;

    const targetEma = p.pullbackEma === 21 ? e21 : e55;
    const touchLong = c.low <= targetEma * (1 + p.pullbackTolPct) && c.close > targetEma;
    const touchShort = c.high >= targetEma * (1 - p.pullbackTolPct) && c.close < targetEma;

    let side: 'LONG' | 'SHORT' | null = null;
    let entry = c.close, sl = 0;

    if (longStack && touchLong && rsi > p.rsiMid) {
      side = 'LONG';
      const swLo = swingLow(candles, i, 10);
      sl = Math.min(swLo, targetEma) - p.slAtrMult * atr;
    } else if (shortStack && touchShort && rsi < (100 - p.rsiMid)) {
      side = 'SHORT';
      const swHi = swingHigh(candles, i, 10);
      sl = Math.max(swHi, targetEma) + p.slAtrMult * atr;
    }
    if (!side) continue;

    const stopDist = Math.abs(entry - sl);
    if (stopDist < atr * 0.5) continue;

    const riskUsd = equity * RISK_PCT;
    const sizeUsd = (riskUsd / stopDist) * entry;
    if (sizeUsd > equity * 10) continue;

    const tp1 = side === 'LONG' ? entry + p.tp1R * stopDist : entry - p.tp1R * stopDist;

    let filledTp1 = false;
    let trailStop = sl;
    let exitIdx = -1, exitPrice = 0;
    let exitReason: Trade['exitReason'] = 'eod';
    let remainingSize = sizeUsd;
    let realizedPnl = 0;
    let highWaterMark = side === 'LONG' ? entry : entry;

    for (let j = i + 1; j < candles.length; j++) {
      const next = candles[j];
      const nextAdx = s.adx[j];
      const nextAtr = s.atr[j];

      // Abort if ADX drops (trend broken) before TP1
      if (!filledTp1 && !Number.isNaN(nextAdx) && nextAdx < p.adxAbortB) {
        exitIdx = j; exitPrice = next.close; exitReason = 'abort';
        realizedPnl += signedPnl(side, entry, exitPrice, remainingSize);
        break;
      }

      // Update high-water for trail
      if (side === 'LONG') {
        highWaterMark = Math.max(highWaterMark, next.high);
        if (filledTp1 && !Number.isNaN(nextAtr)) {
          const chandelier = highWaterMark - p.trailAtrMult * nextAtr;
          trailStop = Math.max(trailStop, chandelier);
        }
        if (next.low <= trailStop) {
          realizedPnl += signedPnl('LONG', entry, trailStop, remainingSize);
          exitIdx = j; exitPrice = trailStop;
          exitReason = filledTp1 ? 'tp1+trail' : 'sl';
          break;
        }
        if (!filledTp1 && next.high >= tp1) {
          const halfSize = sizeUsd / 2;
          realizedPnl += signedPnl('LONG', entry, tp1, halfSize);
          remainingSize -= halfSize;
          filledTp1 = true;
          trailStop = entry; // move to breakeven
          continue;
        }
      } else {
        highWaterMark = Math.min(highWaterMark, next.low);
        if (filledTp1 && !Number.isNaN(nextAtr)) {
          const chandelier = highWaterMark + p.trailAtrMult * nextAtr;
          trailStop = Math.min(trailStop, chandelier);
        }
        if (next.high >= trailStop) {
          realizedPnl += signedPnl('SHORT', entry, trailStop, remainingSize);
          exitIdx = j; exitPrice = trailStop;
          exitReason = filledTp1 ? 'tp1+trail' : 'sl';
          break;
        }
        if (!filledTp1 && next.low <= tp1) {
          const halfSize = sizeUsd / 2;
          realizedPnl += signedPnl('SHORT', entry, tp1, halfSize);
          remainingSize -= halfSize;
          filledTp1 = true;
          trailStop = entry;
          continue;
        }
      }
    }

    if (exitIdx === -1) {
      const last = candles[candles.length - 1];
      realizedPnl += signedPnl(side, entry, last.close, remainingSize);
      exitIdx = candles.length - 1; exitPrice = last.close;
    }

    const fees = sizeUsd * FEE_ROUND_TRIP;
    realizedPnl -= fees;
    const realizedR = realizedPnl / riskUsd;

    trades.push({
      side, entryIdx: i, exitIdx, entryPrice: entry, exitPrice,
      slPrice: sl, tp1Price: tp1, tp2Price: 0,
      sizeUsd, realizedR, pnlUsd: realizedPnl, exitReason,
      entryTs: c.timestamp, exitTs: candles[exitIdx].timestamp,
    });
    equity += realizedPnl;
    i = exitIdx;
  }

  return trades;
}

// ───────────────────────────────────────────── Regime-gated combined ─────────────────────────────────────────────

function runCombined(candles: Candle[], s: Series, pA: Params, pB: ParamsB): Trade[] {
  // Run both; merge by non-overlapping selection (B takes priority at high ADX, A at low)
  const a = runStrategy(candles, s, pA);
  const b = runStrategyB(candles, s, pB);
  const all = [...a.map(t => ({ ...t, source: 'A' })), ...b.map(t => ({ ...t, source: 'B' }))];
  all.sort((x, y) => x.entryIdx - y.entryIdx);

  // Filter overlapping: keep earlier one
  const out: Trade[] = [];
  let lastExit = -1;
  for (const t of all) {
    if (t.entryIdx <= lastExit) continue;
    out.push(t);
    lastExit = t.exitIdx;
  }
  return out;
}

// ───────────────────────────────────────────── metrics ─────────────────────────────────────────────

interface Metrics {
  params: Params;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  sumR: number;
  profitFactor: number;
  maxDdPct: number;
  finalEquity: number;
  equityGrowthPct: number;
  longs: number;
  shorts: number;
  longWr: number;
  shortWr: number;
  sharpeDaily: number;
  avgHoldBars: number;
}

function computeMetrics(params: Params, trades: Trade[]): Metrics {
  if (trades.length === 0) {
    return { params, trades: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, sumR: 0, profitFactor: 0,
      maxDdPct: 0, finalEquity: START_EQUITY, equityGrowthPct: 0,
      longs: 0, shorts: 0, longWr: 0, shortWr: 0, sharpeDaily: 0, avgHoldBars: 0 };
  }

  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  // Equity curve + max DD
  let eq = START_EQUITY, peak = eq, maxDdPct = 0;
  const equityCurve: number[] = [eq];
  for (const t of trades) {
    eq += t.pnlUsd;
    peak = Math.max(peak, eq);
    const dd = (peak - eq) / peak;
    maxDdPct = Math.max(maxDdPct, dd);
    equityCurve.push(eq);
  }

  // Daily returns approximation for Sharpe (from equity curve, per-trade)
  const returns = trades.map((t) => t.pnlUsd / START_EQUITY);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  // Annualize assuming ~trades/day rate based on 90d period
  const days = (trades[trades.length - 1].exitTs - trades[0].entryTs) / 86400000;
  const tradesPerDay = trades.length / Math.max(days, 1);
  const sharpeDaily = stdev > 0 ? (mean / stdev) * Math.sqrt(tradesPerDay * 365) : 0;

  const longs = trades.filter((t) => t.side === 'LONG');
  const shorts = trades.filter((t) => t.side === 'SHORT');
  const longWr = longs.length ? longs.filter((t) => t.pnlUsd > 0).length / longs.length : 0;
  const shortWr = shorts.length ? shorts.filter((t) => t.pnlUsd > 0).length / shorts.length : 0;

  const avgHoldBars = trades.reduce((s, t) => s + (t.exitIdx - t.entryIdx), 0) / trades.length;

  return {
    params,
    trades: trades.length,
    wins: wins.length, losses: losses.length,
    winRate: wins.length / trades.length,
    avgR: trades.reduce((s, t) => s + t.realizedR, 0) / trades.length,
    sumR: trades.reduce((s, t) => s + t.realizedR, 0),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    maxDdPct: maxDdPct * 100,
    finalEquity: eq,
    equityGrowthPct: ((eq - START_EQUITY) / START_EQUITY) * 100,
    longs: longs.length, shorts: shorts.length,
    longWr, shortWr,
    sharpeDaily,
    avgHoldBars,
  };
}

// ───────────────────────────────────────────── grid search ─────────────────────────────────────────────

const GRID_BB_STD = [2.0, 2.25, 2.5, 3.0];
const GRID_RSI = [
  { lo: 30, hi: 70 },
  { lo: 35, hi: 65 },
  { lo: 40, hi: 60 },
];
const GRID_ADX_MAX = [20, 22, 25];
const GRID_WICK = [0.0, 0.2];       // 0.0 = disabled filter
const GRID_VOL = [1.0, 1.3];        // 1.0 = disabled filter
const DEFAULT_EXTRA: Omit<Params, 'bbStd' | 'rsiLo' | 'rsiHi' | 'adxMax' | 'wickPctMin' | 'volSpikeMult'> = {
  adxAbort: 28,
  atrBufferMult: 0.5,
};

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(d);
}

interface SymbolResult {
  symbol: string;
  bhReturnPct: number;
  results: Metrics[];
}

function gridSearch(candles: Candle[]): Metrics[] {
  const results: Metrics[] = [];
  for (const bbStd of GRID_BB_STD) {
    const series = computeSeries(candles, bbStd);
    for (const rsi of GRID_RSI) {
      for (const adxMax of GRID_ADX_MAX) {
        for (const wickPctMin of GRID_WICK) {
          for (const volSpikeMult of GRID_VOL) {
            const params: Params = {
              bbStd, rsiLo: rsi.lo, rsiHi: rsi.hi, adxMax,
              wickPctMin, volSpikeMult,
              ...DEFAULT_EXTRA,
            };
            const trades = runStrategy(candles, series, params);
            results.push(computeMetrics(params, trades));
          }
        }
      }
    }
  }
  return results;
}

function paramKey(p: Params): string {
  return `bb=${p.bbStd}_rsi=${p.rsiLo}/${p.rsiHi}_adx=${p.adxMax}_wick=${p.wickPctMin}_vol=${p.volSpikeMult}`;
}

function printTopGrid(perSymbol: SymbolResult[], topN: number) {
  for (const sr of perSymbol) {
    console.log(`\n═══ ${sr.symbol}  (buy-hold ${fmt(sr.bhReturnPct)}%) ═══`);
    const sorted = [...sr.results].sort((a, b) => b.sumR - a.sumR);
    console.log(' BB σ | RSI    | ADX | wick| vol | N   | WR    | sumR  | PF   | maxDD | Eq %  | L/S   | Sharpe');
    console.log('─'.repeat(110));
    for (const m of sorted.slice(0, topN)) {
      const p = m.params;
      console.log(
        ` ${p.bbStd.toFixed(2)} | ${p.rsiLo}/${p.rsiHi}  |  ${p.adxMax} | ${p.wickPctMin.toFixed(1)} | ${p.volSpikeMult.toFixed(1)} | ${String(m.trades).padStart(3)} | ${fmt(m.winRate*100)}% | ${fmt(m.sumR, 2).padStart(5)} | ${fmt(m.profitFactor).padStart(4)} | ${fmt(m.maxDdPct).padStart(4)}% | ${fmt(m.equityGrowthPct).padStart(5)} | ${m.longs}/${m.shorts} | ${fmt(m.sharpeDaily)}`,
      );
    }
  }
}

/** Cross-symbol robustness: find params that rank consistently across all 3 pairs */
function findRobustParams(perSymbol: SymbolResult[]): Array<{ key: string; totalSumR: number; avgPF: number; avgWR: number; totalTrades: number; perSym: Metrics[] }> {
  const byKey = new Map<string, { key: string; metrics: Metrics[] }>();
  for (const sr of perSymbol) {
    for (const m of sr.results) {
      const k = paramKey(m.params);
      if (!byKey.has(k)) byKey.set(k, { key: k, metrics: [] });
      byKey.get(k)!.metrics.push(m);
    }
  }
  const rows = [];
  for (const { key, metrics } of byKey.values()) {
    if (metrics.length !== perSymbol.length) continue;
    const totalTrades = metrics.reduce((s, m) => s + m.trades, 0);
    const totalSumR = metrics.reduce((s, m) => s + m.sumR, 0);
    const validPFs = metrics.filter((m) => Number.isFinite(m.profitFactor) && m.profitFactor > 0).map((m) => m.profitFactor);
    const avgPF = validPFs.length ? validPFs.reduce((s, v) => s + v, 0) / validPFs.length : 0;
    const totalWins = metrics.reduce((s, m) => s + m.wins, 0);
    const avgWR = totalTrades > 0 ? totalWins / totalTrades : 0;
    rows.push({ key, totalSumR, avgPF, avgWR, totalTrades, perSym: metrics });
  }
  return rows.sort((a, b) => b.totalSumR - a.totalSumR);
}

const BEST_A: Params = {
  bbStd: 2.0, rsiLo: 35, rsiHi: 65, adxMax: 22,
  adxAbort: 28, atrBufferMult: 0.5,
  volSpikeMult: 1.3, wickPctMin: 0.0,
};

const DEFAULT_B: ParamsB = {
  adxMin: 25, adxAbortB: 20,
  pullbackEma: 55, pullbackTolPct: 0.005,
  rsiMid: 45,
  slAtrMult: 1.0, tp1R: 3.0, trailAtrMult: 2.5,
};

// Grid for Playbook B
const GRID_B_ADX_MIN = [25, 30];
const GRID_B_EMA: Array<21 | 55> = [21, 55];
const GRID_B_SL_ATR = [1.0, 1.5];
const GRID_B_TP1R = [1.5, 2.0, 3.0];
const GRID_B_TRAIL = [2.5, 3.5];

function gridSearchB(candles: Candle[], s: Series): Array<{ params: ParamsB; metrics: Metrics }> {
  const out: Array<{ params: ParamsB; metrics: Metrics }> = [];
  for (const adxMin of GRID_B_ADX_MIN) {
    for (const pullbackEma of GRID_B_EMA) {
      for (const slAtrMult of GRID_B_SL_ATR) {
        for (const tp1R of GRID_B_TP1R) {
          for (const trailAtrMult of GRID_B_TRAIL) {
            const params: ParamsB = {
              adxMin, adxAbortB: adxMin - 5,
              pullbackEma, pullbackTolPct: 0.005,
              rsiMid: 45, slAtrMult, tp1R, trailAtrMult,
            };
            const trades = runStrategyB(candles, s, params);
            const metrics = computeMetrics(BEST_A, trades);
            out.push({ params, metrics });
          }
        }
      }
    }
  }
  return out;
}

async function runBGridSearch() {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(` PLAYBOOK B GRID SEARCH — ${DAYS}d period`);
  console.log('══════════════════════════════════════════════════════════════════');
  for (const sym of SYMBOLS) {
    const candles = await fetchHistory(sym, DAYS);
    const bhReturnPct = ((candles[candles.length - 1].close / candles[0].close) - 1) * 100;
    const series = computeSeries(candles, 2.0);
    const results = gridSearchB(candles, series);
    results.sort((a, b) => b.metrics.sumR - a.metrics.sumR);
    console.log(`\n${sym} (buy-hold ${fmt(bhReturnPct)}% over ${DAYS}d):`);
    console.log(' ADX | EMA | slATR | TP1R | trail | N   | WR    | sumR   | PF    | maxDD | Eq %');
    console.log('─'.repeat(90));
    for (const r of results.slice(0, 8)) {
      const p = r.params, m = r.metrics;
      console.log(
        ` ${p.adxMin.toString().padStart(3)} | ${p.pullbackEma.toString().padStart(3)} | ${p.slAtrMult.toFixed(1).padStart(5)} | ${p.tp1R.toFixed(1).padStart(4)} | ${p.trailAtrMult.toFixed(1).padStart(4)}  | ${String(m.trades).padStart(3)} | ${fmt(m.winRate*100)}% | ${fmt(m.sumR,2).padStart(6)} | ${fmt(m.profitFactor).padStart(5)} | ${fmt(m.maxDdPct).padStart(4)}% | ${fmt(m.equityGrowthPct)}%`,
      );
    }
  }
}

async function runCombinedPipeline() {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(' COMBINED A (range-fade) + B (trend-pullback) — regime-gated');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  A params: BB=${BEST_A.bbStd}, RSI ${BEST_A.rsiLo}/${BEST_A.rsiHi}, ADX<${BEST_A.adxMax}, vol×${BEST_A.volSpikeMult}`);
  console.log(`  B params: ADX>${DEFAULT_B.adxMin}, pullback EMA${DEFAULT_B.pullbackEma} tol ${DEFAULT_B.pullbackTolPct*100}%, TP1 ${DEFAULT_B.tp1R}R, trail ${DEFAULT_B.trailAtrMult}×ATR`);

  let totalR = 0, totalTrades = 0, totalWins = 0;
  for (const sym of SYMBOLS) {
    const candles = await fetchHistory(sym, DAYS);
    const series = computeSeries(candles, BEST_A.bbStd);
    const tradesA = runStrategy(candles, series, BEST_A);
    const tradesB = runStrategyB(candles, series, DEFAULT_B);
    const combined = runCombined(candles, series, BEST_A, DEFAULT_B);
    const mA = computeMetrics(BEST_A as any, tradesA);
    const mC = computeMetrics(BEST_A as any, combined);
    const bWins = tradesB.filter(t=>t.pnlUsd>0).length;
    const bSumR = tradesB.reduce((s,t)=>s+t.realizedR,0);

    console.log(`\n  ${sym}:`);
    console.log(`    A only: ${mA.trades} trades, WR ${fmt(mA.winRate*100)}%, sumR ${fmt(mA.sumR,2)}, PF ${fmt(mA.profitFactor)}, maxDD ${fmt(mA.maxDdPct)}%`);
    console.log(`    B only: ${tradesB.length} trades, WR ${tradesB.length ? fmt(bWins/tradesB.length*100) : '0.00'}%, sumR ${fmt(bSumR,2)}`);
    console.log(`    Combined: ${mC.trades} trades, WR ${fmt(mC.winRate*100)}%, sumR ${fmt(mC.sumR,2)}, PF ${fmt(mC.profitFactor)}, maxDD ${fmt(mC.maxDdPct)}%`);
    totalR += mC.sumR;
    totalTrades += mC.trades;
    totalWins += mC.wins;
  }
  console.log(`\n  TOTAL COMBINED: ${totalTrades} trades, WR ${fmt(totalWins/Math.max(totalTrades,1)*100)}%, sumR ${fmt(totalR,2)}`);
}

/** Walk-forward: train on [0, splitIdx), test on [splitIdx, end) */
async function runWalkForward() {
  const trainFrac = 0.75;
  const trainDays = Math.floor(DAYS * trainFrac);
  const testDays = DAYS - trainDays;
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(` WALK-FORWARD VALIDATION — train ${trainDays}d / test ${testDays}d`);
  console.log('══════════════════════════════════════════════════════════════════');

  let totalTestR = 0, totalTestTrades = 0, totalTestWins = 0;
  for (const sym of SYMBOLS) {
    const candles = await fetchHistory(sym, DAYS);
    const splitIdx = Math.floor(candles.length * trainFrac);
    const train = candles.slice(0, splitIdx);
    const test = candles.slice(splitIdx);
    console.log(`\n${sym}:  train ${train.length} bars | test ${test.length} bars`);
    console.log(`  train period: ${new Date(train[0].timestamp).toISOString().slice(0,10)} → ${new Date(train[train.length-1].timestamp).toISOString().slice(0,10)}`);
    console.log(`  test  period: ${new Date(test[0].timestamp).toISOString().slice(0,10)} → ${new Date(test[test.length-1].timestamp).toISOString().slice(0,10)}`);

    // Find best A on train
    const trainResults = gridSearch(train);
    const bestA = trainResults.sort((a,b) => b.sumR - a.sumR)[0];
    console.log(`  best A on TRAIN: BB=${bestA.params.bbStd}, RSI ${bestA.params.rsiLo}/${bestA.params.rsiHi}, ADX<${bestA.params.adxMax}, vol×${bestA.params.volSpikeMult}, wick≥${bestA.params.wickPctMin}`);
    console.log(`    train: ${bestA.trades} trades, WR ${fmt(bestA.winRate*100)}%, sumR ${fmt(bestA.sumR,2)}, PF ${fmt(bestA.profitFactor)}`);

    // Apply same params to test
    const testSeries = computeSeries(test, bestA.params.bbStd);
    const testTradesA = runStrategy(test, testSeries, bestA.params);
    const testM = computeMetrics(bestA.params, testTradesA);
    console.log(`    TEST A:  ${testM.trades} trades, WR ${fmt(testM.winRate*100)}%, sumR ${fmt(testM.sumR,2)}, PF ${fmt(testM.profitFactor)}, maxDD ${fmt(testM.maxDdPct)}%, eq ${fmt(testM.equityGrowthPct)}%`);

    // B on test
    const testTradesB = runStrategyB(test, testSeries, DEFAULT_B);
    const bWins = testTradesB.filter(t=>t.pnlUsd>0).length;
    const bSumR = testTradesB.reduce((s,t)=>s+t.realizedR,0);
    console.log(`    TEST B:  ${testTradesB.length} trades, WR ${testTradesB.length ? fmt(bWins/testTradesB.length*100) : '0.00'}%, sumR ${fmt(bSumR,2)}`);

    // Combined on test
    const combinedTest = runCombined(test, testSeries, bestA.params, DEFAULT_B);
    const combM = computeMetrics(bestA.params, combinedTest);
    console.log(`    TEST A+B: ${combM.trades} trades, WR ${fmt(combM.winRate*100)}%, sumR ${fmt(combM.sumR,2)}, PF ${fmt(combM.profitFactor)}, maxDD ${fmt(combM.maxDdPct)}%, eq ${fmt(combM.equityGrowthPct)}%`);
    totalTestR += combM.sumR;
    totalTestTrades += combM.trades;
    totalTestWins += combM.wins;
  }
  console.log(`\n  TOTAL TEST COMBINED: ${totalTestTrades} trades, WR ${fmt(totalTestWins/Math.max(totalTestTrades,1)*100)}%, sumR ${fmt(totalTestR,2)}`);
}

async function main() {
  if (process.argv.includes('--walkforward')) {
    await runWalkForward();
    return;
  }
  if (process.argv.includes('--combined')) {
    await runCombinedPipeline();
    return;
  }
  if (process.argv.includes('--gridB')) {
    await runBGridSearch();
    return;
  }

  const perSymbol: SymbolResult[] = [];
  for (const sym of SYMBOLS) {
    console.log(`Fetching ${DAYS} days of 1H ${sym}…`);
    const candles = await fetchHistory(sym, DAYS);
    const first = new Date(candles[0].timestamp).toISOString();
    const last = new Date(candles[candles.length - 1].timestamp).toISOString();
    const bhReturnPct = ((candles[candles.length - 1].close / candles[0].close) - 1) * 100;
    console.log(`  ${candles.length} bars: ${first.slice(0,10)} → ${last.slice(0,10)} | buy-hold ${fmt(bhReturnPct)}%`);
    const results = gridSearch(candles);
    perSymbol.push({ symbol: sym, bhReturnPct, results });
  }

  // Per-symbol top-10
  printTopGrid(perSymbol, 10);

  // Cross-symbol robustness
  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' CROSS-SYMBOL ROBUSTNESS — params ranked by TOTAL sumR across all 3 pairs');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  const robust = findRobustParams(perSymbol);
  console.log(' Rank | Params                                           | N    | totalSumR | avgPF | avgWR  | per-symbol sumR');
  console.log('─'.repeat(115));
  for (let i = 0; i < Math.min(15, robust.length); i++) {
    const r = robust[i];
    const per = r.perSym.map((m, j) => `${SYMBOLS[j].slice(0,3)}:${fmt(m.sumR, 1)}`).join(' ');
    console.log(
      ` ${String(i+1).padStart(4)} | ${r.key.padEnd(48)} | ${String(r.totalTrades).padStart(4)} | ${fmt(r.totalSumR, 2).padStart(8)}  | ${fmt(r.avgPF).padStart(4)} | ${fmt(r.avgWR*100)}% | ${per}`,
    );
  }

  // Best robust param — detailed breakdown
  console.log('\n═ BEST ROBUST PARAMS — per-symbol detail ═');
  const best = robust[0];
  console.log(`Params: ${best.key}`);
  for (let i = 0; i < best.perSym.length; i++) {
    console.log(`\n  ${SYMBOLS[i]}:`);
    printMetrics(best.perSym[i]);
  }
}

function printMetrics(m: Metrics) {
  console.log(`\n  Params: BB σ=${m.params.bbStd}, RSI ${m.params.rsiLo}/${m.params.rsiHi}, ADX<${m.params.adxMax}, ATR buf ${m.params.atrBufferMult}, vol×${m.params.volSpikeMult}, wick≥${m.params.wickPctMin}`);
  console.log(`  Trades: ${m.trades} (${m.longs}L / ${m.shorts}S)`);
  console.log(`  Win Rate: ${fmt(m.winRate*100)}% (LONG ${fmt(m.longWr*100)}%, SHORT ${fmt(m.shortWr*100)}%)`);
  console.log(`  Avg R: ${fmt(m.avgR, 3)}    Sum R: ${fmt(m.sumR, 2)}`);
  console.log(`  Profit Factor: ${fmt(m.profitFactor)}    Sharpe(annual): ${fmt(m.sharpeDaily)}`);
  console.log(`  Max DD: ${fmt(m.maxDdPct)}%    Equity: ${fmt(m.equityGrowthPct)}%`);
  console.log(`  Avg hold: ${fmt(m.avgHoldBars, 1)} bars (≈${fmt(m.avgHoldBars, 1)}h)`);
}

function printTradeList(trades: Trade[]) {
  console.log('\n  First 20 trades:');
  console.log('  # |  side  |   entry → exit    |  R   | reason    | ts');
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const ts = new Date(t.entryTs).toISOString().slice(0, 16);
    console.log(`  ${String(i+1).padStart(2)} |  ${t.side.padEnd(5)} | ${t.entryPrice.toFixed(0)} → ${t.exitPrice.toFixed(0)} | ${fmt(t.realizedR, 2).padStart(5)} | ${t.exitReason.padEnd(9)} | ${ts}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
