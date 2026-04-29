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

const SYMBOLS = (process.env.BT_SYMBOLS?.split(',').map(s => s.trim()).filter(Boolean))
  ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'OPUSDT', 'NEARUSDT', 'AVAXUSDT', 'SUIUSDT', 'XLMUSDT', 'TAOUSDT'];
const INTERVAL = '60' as const; // 1H
const DAYS = Number(process.env.BT_DAYS) || 365;
const FEE_MULT = Number(process.env.BT_FEE_MULT) || 1; // stress-test slippage: 1x base, 2x, 3x
const FEE_ROUND_TRIP = 0.0011 * FEE_MULT; // 0.055% × 2 base; multiplied for stress
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

// ───────────────────────────────────────────── filter context (cross-pair + BTC bias) ─────────────────────────────────────────────

interface FilterCtx {
  // For symbol S at its local idx i: +1 = bullish push, -1 = bearish push, 0 = neutral
  pairBiasBySym: Map<string, Int8Array>;
  // For each timestamp present in BTC: bull/bear flags
  btcBullByTs: Map<number, boolean>;
  btcBearByTs: Map<number, boolean>;
  // ts → array index for each symbol (for cross-pair lookups by ts)
  tsToIdxBySym: Map<string, Map<number, number>>;
  // Per-symbol regime age (consecutive bars in TREND): 0 if not in TREND
  regimeAgeBySym: Map<string, Int32Array>;
  symbols: string[];
  // Toggle which filters to apply
  useCrossPair: boolean;
  useBtcBias: boolean;
  useAdxTrajectory: boolean;   // H1: skip B if ADX falling at entry
  useEmaStabilizer: boolean;   // H4: B requires aligned-stack history + spread > min
  useTrendAge: boolean;        // H6: skip B if regime mature (>maxHrs)
  // Parameters
  crossPairOppositeMin: number; // default 7
  adxTrajLookback: number;     // default 6 bars (H1)
  emaStackBars: number;        // default 3 prior bars (H4)
  emaSpreadMin: number;        // default 0.0005 (0.05% of price, H4)
  trendAgeMaxHrs: number;      // default 12 (H6)
  // Live-bot session blocks (dead zone 22-00 UTC, funding ±10min @00/08/16, FOMC blackouts)
  useLiveBlocks: boolean;
  fomcRanges: Array<{ startTs: number; endTs: number }>;
}

function checkLiveBlocksVeto(ctx: FilterCtx | null, barTs: number): boolean {
  if (!ctx || !ctx.useLiveBlocks) return false;
  // Bar timestamp is bar OPEN. Strategy enters at bar CLOSE = open + 1h.
  const entryTs = barTs + 3600_000;
  const d = new Date(entryTs);
  const h = d.getUTCHours();
  // Dead zone 22:00-00:00 UTC (entries at 22, 23 hours)
  if (h === 22 || h === 23) return true;
  // Funding window: 1H bar closes always at minute=0, so block exact funding hours
  if (h === 0 || h === 8 || h === 16) return true;
  // FOMC blackouts (manual catalysts)
  for (const r of ctx.fomcRanges) {
    if (entryTs >= r.startTs && entryTs <= r.endTs) return true;
  }
  return false;
}

function computePairBias(candles: Candle[], s: Series): Int8Array {
  // +1 if close > ema21 AND close > close[-3]
  // -1 if close < ema21 AND close < close[-3]
  // 0 otherwise (sideways/conflicted)
  const out = new Int8Array(candles.length);
  for (let i = 3; i < candles.length; i++) {
    const c = candles[i].close;
    const ema21 = s.ema21[i];
    const past = candles[i - 3].close;
    if (Number.isNaN(ema21)) continue;
    if (c > ema21 && c > past) out[i] = 1;
    else if (c < ema21 && c < past) out[i] = -1;
  }
  return out;
}

function computeRegimeAge(s: Series): Int32Array {
  // Consecutive bars in TREND regime (ADX>=25 + EMA stack aligned). 0 when not TREND. (H6)
  const out = new Int32Array(s.adx.length);
  for (let i = 1; i < s.adx.length; i++) {
    const adx = s.adx[i];
    const e8 = s.ema8[i], e21 = s.ema21[i], e55 = s.ema55[i], e200 = s.ema200[i];
    if ([adx, e8, e21, e55, e200].some(Number.isNaN)) { out[i] = 0; continue; }
    const isTrend = adx >= 25 && (
      (e8 > e21 && e21 > e55 && e55 > e200) ||
      (e8 < e21 && e21 < e55 && e55 < e200)
    );
    out[i] = isTrend ? (out[i - 1] || 0) + 1 : 0;
  }
  return out;
}

function checkAdxTrajectoryVeto(ctx: FilterCtx | null, s: Series, i: number): boolean {
  // H1: skip B entry if ADX trending DOWN over last N bars (mature/exhausted trend)
  if (!ctx || !ctx.useAdxTrajectory) return false;
  const past = i - ctx.adxTrajLookback;
  if (past < 0) return true;
  const a0 = s.adx[past], a1 = s.adx[i];
  if (Number.isNaN(a0) || Number.isNaN(a1)) return false;
  return a1 - a0 < 0;
}

function checkTrendAgeVeto(ctx: FilterCtx | null, sym: string, idx: number): boolean {
  // H6: skip B entry if regime has been TREND for >maxHrs (mature trend)
  if (!ctx || !ctx.useTrendAge) return false;
  const ages = ctx.regimeAgeBySym.get(sym);
  if (!ages) return false;
  return ages[idx] > ctx.trendAgeMaxHrs;
}

function checkEmaStabilizerVeto(
  ctx: FilterCtx | null,
  s: Series,
  i: number,
  side: 'LONG' | 'SHORT',
  closePx: number,
): boolean {
  // H4: require prior N bars same-aligned stack AND ema8/21 spread > minimum (kill boundary noise)
  if (!ctx || !ctx.useEmaStabilizer) return false;
  for (let k = 1; k <= ctx.emaStackBars; k++) {
    const ji = i - k;
    if (ji < 0) return true;
    const e8j = s.ema8[ji], e21j = s.ema21[ji], e55j = s.ema55[ji], e200j = s.ema200[ji];
    if ([e8j, e21j, e55j, e200j].some(Number.isNaN)) return true;
    const longJ = e8j > e21j && e21j > e55j && e55j > e200j;
    const shortJ = e8j < e21j && e21j < e55j && e55j < e200j;
    if (side === 'LONG' && !longJ) return true;
    if (side === 'SHORT' && !shortJ) return true;
  }
  const e8 = s.ema8[i], e21 = s.ema21[i];
  if (Number.isNaN(e8) || Number.isNaN(e21)) return true;
  const spread = Math.abs(e8 - e21) / closePx;
  return spread < ctx.emaSpreadMin;
}

function checkCrossPairVeto(
  ctx: FilterCtx | null,
  side: 'LONG' | 'SHORT',
  ts: number,
): boolean {
  // returns TRUE if the trade should be vetoed
  if (!ctx || !ctx.useCrossPair) return false;
  let bull = 0, bear = 0;
  for (const sym of ctx.symbols) {
    const idxMap = ctx.tsToIdxBySym.get(sym);
    if (!idxMap) continue;
    const idx = idxMap.get(ts);
    if (idx === undefined) continue;
    const bias = ctx.pairBiasBySym.get(sym)?.[idx] ?? 0;
    if (bias > 0) bull++;
    else if (bias < 0) bear++;
  }
  // SHORT trade is at counter-flow when many pairs are bullish: veto
  if (side === 'SHORT' && bull >= ctx.crossPairOppositeMin) return true;
  // LONG trade is at counter-flow when many pairs are bearish: veto
  if (side === 'LONG' && bear >= ctx.crossPairOppositeMin) return true;
  return false;
}

function checkBtcBiasVeto(
  ctx: FilterCtx | null,
  side: 'LONG' | 'SHORT',
  ts: number,
): boolean {
  if (!ctx || !ctx.useBtcBias) return false;
  // SHORT vetoed when BTC is in confirmed bull state
  if (side === 'SHORT' && ctx.btcBullByTs.get(ts) === true) return true;
  // LONG vetoed when BTC is in confirmed bear state
  if (side === 'LONG' && ctx.btcBearByTs.get(ts) === true) return true;
  return false;
}

// ───────────────────────────────────────────── trade simulation ─────────────────────────────────────────────

function runStrategy(candles: Candle[], s: Series, p: Params, filterCtx: FilterCtx | null = null): Trade[] {
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

    // Live session blocks (dead zone, funding, FOMC)
    if (checkLiveBlocksVeto(filterCtx, c.timestamp)) continue;
    // Cross-pair / BTC bias filters
    if (checkCrossPairVeto(filterCtx, side, c.timestamp)) continue;
    if (checkBtcBiasVeto(filterCtx, side, c.timestamp)) continue;

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

function runStrategyB(candles: Candle[], s: Series, p: ParamsB, filterCtx: FilterCtx | null = null, sym: string = ''): Trade[] {
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

    // Live session blocks (dead zone, funding, FOMC)
    if (checkLiveBlocksVeto(filterCtx, c.timestamp)) continue;
    // Cross-pair / BTC bias filters (Playbook B)
    if (checkCrossPairVeto(filterCtx, side, c.timestamp)) continue;
    if (checkBtcBiasVeto(filterCtx, side, c.timestamp)) continue;
    // H1: ADX trajectory — skip if ADX falling (trend exhausted)
    if (checkAdxTrajectoryVeto(filterCtx, s, i)) continue;
    // H4: EMA-stack stabilizer (boundary-noise filter)
    if (checkEmaStabilizerVeto(filterCtx, s, i, side, c.close)) continue;
    // H6: trend age — skip if regime mature
    if (checkTrendAgeVeto(filterCtx, sym, i)) continue;

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

function runCombined(candles: Candle[], s: Series, pA: Params, pB: ParamsB, filterCtx: FilterCtx | null = null): Trade[] {
  // Run both; merge by non-overlapping selection (B takes priority at high ADX, A at low)
  const a = runStrategy(candles, s, pA, filterCtx);
  const b = runStrategyB(candles, s, pB, filterCtx);
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

// ───────────────────────────────────────────── RIGOROUS — full OOS audit ─────────────────────────────────────────────
// Maximum-skepticism backtest. Run via:
//   BT_DAYS=365 npx tsx src/backtest.ts --rigorous
//
// Phases:
//   1. Walk-forward UNIFIED (BEST_A + DEFAULT_B applied to test 92d, no per-pair tuning)
//      — matches what runs live. The honest baseline.
//   2. Per-pair detail: train sumR, test sumR, retention, PF, DD, trade R distribution
//   3. Slippage stress flag in console: hint to re-run with BT_FEE_MULT=2,3 manually
//   4. Trade distribution: best/worst R, max consecutive losses, win/loss split
//   5. Final realistic monthly projection on $250k

async function runRigorous() {
  const trainFrac = 0.75;
  const trainDays = Math.floor(DAYS * trainFrac);
  const testDays = DAYS - trainDays;

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(` RIGOROUS WALK-FORWARD — ${SYMBOLS.length} pairs, train ${trainDays}d / test ${testDays}d`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  BEST_A:    BB=${BEST_A.bbStd}, RSI ${BEST_A.rsiLo}/${BEST_A.rsiHi}, ADX<${BEST_A.adxMax}, vol×${BEST_A.volSpikeMult}`);
  console.log(`  DEFAULT_B: ADX≥${DEFAULT_B.adxMin}, EMA${DEFAULT_B.pullbackEma} pullback, slATR ${DEFAULT_B.slAtrMult}, TP1 ${DEFAULT_B.tp1R}R, trail ${DEFAULT_B.trailAtrMult}×ATR`);
  console.log(`  FEE round-trip: ${(FEE_ROUND_TRIP * 100).toFixed(3)}% (multiplier ×${FEE_MULT}); RISK 0.5%/trade`);

  const trainResults: Array<{ sym: string; trades: Trade[]; metrics: Metrics }> = [];
  const testResults: Array<{ sym: string; trades: Trade[]; metrics: Metrics }> = [];

  for (const sym of SYMBOLS) {
    const candles = await fetchHistory(sym, DAYS);
    const splitIdx = Math.floor(candles.length * trainFrac);
    const train = candles.slice(0, splitIdx);
    const test = candles.slice(splitIdx);
    const trainSeries = computeSeries(train, BEST_A.bbStd);
    const testSeries = computeSeries(test, BEST_A.bbStd);

    const trainTrades = runCombined(train, trainSeries, BEST_A, DEFAULT_B);
    const testTrades = runCombined(test, testSeries, BEST_A, DEFAULT_B);
    const trainM = computeMetrics(BEST_A as any, trainTrades);
    const testM = computeMetrics(BEST_A as any, testTrades);

    trainResults.push({ sym, trades: trainTrades, metrics: trainM });
    testResults.push({ sym, trades: testTrades, metrics: testM });
  }

  // ─── Phase 1+2: per-pair train/test summary ───
  console.log('\n─── Per-pair train vs OOS test ───');
  console.log(`${'Pair'.padEnd(10)} | ${'Train R'.padStart(8)} | ${'Test R'.padStart(7)} | ${'Test WR'.padStart(8)} | ${'Test PF'.padStart(8)} | ${'Test DD'.padStart(7)} | ${'Test Eq%'.padStart(8)} | Retention`);
  console.log('-'.repeat(95));

  let trainTotalR = 0, testTotalR = 0, trainTotalTrades = 0, testTotalTrades = 0;
  let testTotalWins = 0;
  let worstTestDd = 0;

  for (let i = 0; i < SYMBOLS.length; i++) {
    const tr = trainResults[i];
    const te = testResults[i];
    const trainPerDay = tr.metrics.sumR / trainDays;
    const testPerDay = te.metrics.sumR / testDays;
    const retention = trainPerDay !== 0 ? (testPerDay / trainPerDay) * 100 : 0;
    const verdict = te.metrics.sumR > 5 ? '✓' : te.metrics.sumR < -2 ? '✗' : '~';

    console.log(
      `${tr.sym.padEnd(10)} | ${fmt(tr.metrics.sumR, 2).padStart(8)} | ${fmt(te.metrics.sumR, 2).padStart(7)} | ${fmt(te.metrics.winRate*100).padStart(7)}% | ${fmt(te.metrics.profitFactor).padStart(8)} | ${fmt(te.metrics.maxDdPct).padStart(6)}% | ${fmt(te.metrics.equityGrowthPct).padStart(7)}% | ${fmt(retention).padStart(5)}% ${verdict}`,
    );

    trainTotalR += tr.metrics.sumR;
    testTotalR += te.metrics.sumR;
    trainTotalTrades += tr.metrics.trades;
    testTotalTrades += te.metrics.trades;
    testTotalWins += te.metrics.wins;
    worstTestDd = Math.max(worstTestDd, te.metrics.maxDdPct);
  }

  const overallRetention = trainTotalR / trainDays !== 0
    ? ((testTotalR / testDays) / (trainTotalR / trainDays)) * 100
    : 0;
  console.log('-'.repeat(95));
  console.log(`${'TOTAL'.padEnd(10)} | ${fmt(trainTotalR, 2).padStart(8)} | ${fmt(testTotalR, 2).padStart(7)} | ${fmt(testTotalWins/Math.max(testTotalTrades,1)*100).padStart(7)}% |          | ${fmt(worstTestDd).padStart(6)}% |          | ${fmt(overallRetention).padStart(5)}%`);

  // ─── Phase 4: trade R distribution ───
  console.log('\n─── Trade R distribution (TEST 92d, all pairs combined) ───');
  const allTestTrades = testResults.flatMap((r) => r.trades);
  const sortedR = allTestTrades.map((t) => t.realizedR).sort((a, b) => a - b);
  const worst5 = sortedR.slice(0, 5);
  const best5 = sortedR.slice(-5).reverse();
  console.log(`  Total trades: ${allTestTrades.length}`);
  console.log(`  Worst 5 R: ${worst5.map((r) => fmt(r, 2)).join(', ')}`);
  console.log(`  Best  5 R: ${best5.map((r) => fmt(r, 2)).join(', ')}`);
  console.log(`  R buckets:`);
  const buckets = [
    { label: 'R ≤ −2',   pred: (r: number) => r <= -2 },
    { label: '−2 < R ≤ −1', pred: (r: number) => r > -2 && r <= -1 },
    { label: '−1 < R ≤ 0',  pred: (r: number) => r > -1 && r <= 0 },
    { label: '0 < R ≤ 1',   pred: (r: number) => r > 0 && r <= 1 },
    { label: '1 < R ≤ 2',   pred: (r: number) => r > 1 && r <= 2 },
    { label: '2 < R ≤ 3',   pred: (r: number) => r > 2 && r <= 3 },
    { label: 'R > 3',       pred: (r: number) => r > 3 },
  ];
  for (const b of buckets) {
    const n = sortedR.filter(b.pred).length;
    const pct = (n / sortedR.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(n / sortedR.length * 40));
    console.log(`    ${b.label.padEnd(14)}: ${String(n).padStart(3)} (${pct.padStart(5)}%) ${bar}`);
  }

  // Max consecutive losses
  let curStreak = 0, maxLossStreak = 0;
  for (const t of allTestTrades) {
    if (t.realizedR < 0) { curStreak++; maxLossStreak = Math.max(maxLossStreak, curStreak); }
    else curStreak = 0;
  }
  console.log(`  Max consecutive losses: ${maxLossStreak}`);

  // ─── Phase 5: final projection ───
  const monthlyR = testTotalR * (30 / testDays);
  const monthlyDollars = monthlyR * 0.005 * 250000;
  const annualPct = monthlyR * 0.005 * 12 * 100;
  const annualDollars = annualPct * 250000 / 100;

  console.log('\n─── Live-equivalent projection on $250k portfolio ───');
  console.log(`  Test sumR over ${testDays} days: ${fmt(testTotalR, 2)}R`);
  console.log(`  Monthly: ${fmt(monthlyR, 2)}R = ${fmt(monthlyR * 0.005 * 100, 2)}% on \\$250k = \\$${fmt(monthlyDollars, 0)}`);
  console.log(`  Annual:  ${fmt(annualPct, 1)}% on \\$250k = \\$${fmt(annualDollars, 0)}`);
  console.log(`  Worst test DD: ${fmt(worstTestDd)}%  (HyroTrader limits: 5% daily / 10% total)`);
  console.log(`  FEE multiplier in this run: ×${FEE_MULT} (re-run with BT_FEE_MULT=2 or 3 for slippage stress)`);

  console.log('\n─── Honest caveats (NOT modeled in backtest) ───');
  console.log(`  ⚠ Real slippage on alts (BNB/SUI/TAO/XLM) likely 0.2-0.5% per side, not modeled exactly.`);
  console.log(`  ⚠ Funding cost not modeled (can add ±0.01-0.03% per 8h on positions).`);
  console.log(`  ⚠ Dead-zone hard block (22-00 UTC) not enforced in backtest — may overestimate by ~5%.`);
  console.log(`  ⚠ News-impact size reduction (mult 0.25/0.5) not modeled — may overstate when high news.`);
  console.log(`  ⚠ 92d test is single window — could be lucky/unlucky regime period.`);
  console.log(`  ⚠ Bybit demo data may differ slightly from real perp data.`);
  console.log(`  Realistic live = OOS × 0.7-0.85 after these. Expect ~70-85% of projected $/mo.`);
}

// ───────────────────────────────────────────── filter ablation orchestrator ─────────────────────────────────────────────

async function buildFilterCtx(symbols: string[], days: number, useCrossPair: boolean, useBtcBias: boolean): Promise<{
  ctx: FilterCtx;
  candlesBySym: Map<string, Candle[]>;
  seriesBySym: Map<string, Series>;
}> {
  const candlesBySym = new Map<string, Candle[]>();
  const seriesBySym = new Map<string, Series>();
  const pairBiasBySym = new Map<string, Int8Array>();
  const tsToIdxBySym = new Map<string, Map<number, number>>();
  const regimeAgeBySym = new Map<string, Int32Array>();

  for (const sym of symbols) {
    const candles = await fetchHistory(sym, days);
    const series = computeSeries(candles, BEST_A.bbStd);
    candlesBySym.set(sym, candles);
    seriesBySym.set(sym, series);
    pairBiasBySym.set(sym, computePairBias(candles, series));
    regimeAgeBySym.set(sym, computeRegimeAge(series));
    const idxMap = new Map<number, number>();
    candles.forEach((c, i) => idxMap.set(c.timestamp, i));
    tsToIdxBySym.set(sym, idxMap);
  }

  // BTC bias map by ts
  const btcBullByTs = new Map<number, boolean>();
  const btcBearByTs = new Map<number, boolean>();
  const btcCandles = candlesBySym.get('BTCUSDT')!;
  const btcSeries = seriesBySym.get('BTCUSDT')!;
  for (let i = 0; i < btcCandles.length; i++) {
    const c = btcCandles[i].close;
    const e21 = btcSeries.ema21[i];
    const adx = btcSeries.adx[i];
    const pdi = btcSeries.pdi[i];
    const mdi = btcSeries.mdi[i];
    if ([e21, adx, pdi, mdi].some(Number.isNaN)) continue;
    btcBullByTs.set(btcCandles[i].timestamp, c > e21 && adx >= 22 && pdi > mdi);
    btcBearByTs.set(btcCandles[i].timestamp, c < e21 && adx >= 22 && mdi > pdi);
  }

  const ctx: FilterCtx = {
    pairBiasBySym, btcBullByTs, btcBearByTs, tsToIdxBySym, regimeAgeBySym,
    symbols, useCrossPair, useBtcBias,
    useAdxTrajectory: false, useEmaStabilizer: false, useTrendAge: false,
    crossPairOppositeMin: Number(process.env.BT_CROSS_MIN) || 7,
    adxTrajLookback: Number(process.env.BT_ADX_LOOKBACK) || 6,
    emaStackBars: Number(process.env.BT_EMA_BARS) || 3,
    emaSpreadMin: Number(process.env.BT_EMA_SPREAD) || 0.0005,
    trendAgeMaxHrs: Number(process.env.BT_TREND_AGE) || 12,
    useLiveBlocks: false,
    fomcRanges: [],
  };

  return { ctx, candlesBySym, seriesBySym };
}

function filterTradesByWindow(trades: Trade[], cutoffTs: number): Trade[] {
  return trades.filter(t => t.entryTs >= cutoffTs);
}

interface AblationResult {
  label: string;
  perPair: Map<string, { trades: Trade[]; metrics: Metrics }>;
  totalSumR: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  totalPF: number;
  worstDD: number;
}

function makeAblationResult(label: string, perPair: Map<string, { trades: Trade[]; metrics: Metrics }>): AblationResult {
  let totalSumR = 0, totalTrades = 0, totalWins = 0, totalLosses = 0, worstDD = 0;
  let grossWin = 0, grossLoss = 0;
  for (const { trades, metrics } of perPair.values()) {
    totalSumR += metrics.sumR;
    totalTrades += metrics.trades;
    totalWins += metrics.wins;
    totalLosses += metrics.losses;
    worstDD = Math.max(worstDD, metrics.maxDdPct);
    for (const t of trades) {
      if (t.pnlUsd > 0) grossWin += t.pnlUsd;
      else grossLoss += Math.abs(t.pnlUsd);
    }
  }
  const totalPF = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  return { label, perPair, totalSumR, totalTrades, totalWins, totalLosses, totalPF, worstDD };
}

async function runFilterAblation() {
  const windowDays = Number(process.env.BT_WINDOW_DAYS) || DAYS;
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(` FILTER ABLATION — ${SYMBOLS.length} pairs, fetch ${DAYS}d, trade window last ${windowDays}d`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  A: ${BEST_A.bbStd}σ BB, RSI ${BEST_A.rsiLo}/${BEST_A.rsiHi}, ADX<${BEST_A.adxMax}, vol×${BEST_A.volSpikeMult}`);
  console.log(`  B: ADX≥${DEFAULT_B.adxMin}, EMA${DEFAULT_B.pullbackEma}, slATR ${DEFAULT_B.slAtrMult}, TP1 ${DEFAULT_B.tp1R}R`);
  console.log(`  Cross-pair veto threshold: ${process.env.BT_CROSS_MIN || 7} of 10 opposite`);

  // Pre-fetch all data once
  console.log(`\nFetching ${DAYS}d of 1H for ${SYMBOLS.length} pairs…`);
  const { candlesBySym, seriesBySym } = await buildFilterCtx(SYMBOLS, DAYS, false, false);

  // Establish cutoff timestamp from window
  const lastCandleTs = Math.max(...[...candlesBySym.values()].map(cs => cs[cs.length - 1].timestamp));
  const cutoffTs = lastCandleTs - (windowDays * 86400000) + 1;
  console.log(`  Window: ${new Date(cutoffTs).toISOString().slice(0, 16)} → ${new Date(lastCandleTs).toISOString().slice(0, 16)}`);

  // Ablation matrix — each cfg toggles one or more filters from baseline
  type CfgFlags = {
    label: string;
    useCrossPair?: boolean;
    useBtcBias?: boolean;
    useAdxTrajectory?: boolean;  // H1
    useEmaStabilizer?: boolean;  // H4
    useTrendAge?: boolean;       // H6
    useLiveBlocks?: boolean;
    fomcRanges?: Array<{ startTs: number; endTs: number }>;
  };
  const cfgs: CfgFlags[] = [
    { label: 'NO FILTERS (baseline)' },
    { label: '+CROSS-PAIR veto',          useCrossPair: true },
    { label: '+BTC BIAS veto',            useBtcBias: true },
    { label: '+H1 ADX trajectory (B)',    useAdxTrajectory: true },
    { label: '+H4 EMA stabilizer (B)',    useEmaStabilizer: true },
    { label: '+H6 Trend age 12h (B)',     useTrendAge: true },
    { label: '+H1+H4+H6 (B-only stack)',  useAdxTrajectory: true, useEmaStabilizer: true, useTrendAge: true },
    { label: '+ALL filters',              useCrossPair: true, useBtcBias: true, useAdxTrajectory: true, useEmaStabilizer: true, useTrendAge: true },
  ];

  // Pre-compute pair bias, regime age, BTC bias once (reusable across configs)
  const pairBiasBySym = new Map<string, Int8Array>();
  const tsToIdxBySym = new Map<string, Map<number, number>>();
  const regimeAgeBySym = new Map<string, Int32Array>();
  for (const sym of SYMBOLS) {
    pairBiasBySym.set(sym, computePairBias(candlesBySym.get(sym)!, seriesBySym.get(sym)!));
    regimeAgeBySym.set(sym, computeRegimeAge(seriesBySym.get(sym)!));
    const idxMap = new Map<number, number>();
    candlesBySym.get(sym)!.forEach((c, i) => idxMap.set(c.timestamp, i));
    tsToIdxBySym.set(sym, idxMap);
  }
  const btcBullByTs = new Map<number, boolean>();
  const btcBearByTs = new Map<number, boolean>();
  const btcCandles = candlesBySym.get('BTCUSDT')!;
  const btcSeries = seriesBySym.get('BTCUSDT')!;
  for (let i = 0; i < btcCandles.length; i++) {
    const c = btcCandles[i].close;
    const e21 = btcSeries.ema21[i];
    const adx = btcSeries.adx[i];
    const pdi = btcSeries.pdi[i];
    const mdi = btcSeries.mdi[i];
    if ([e21, adx, pdi, mdi].some(Number.isNaN)) continue;
    btcBullByTs.set(btcCandles[i].timestamp, c > e21 && adx >= 22 && pdi > mdi);
    btcBearByTs.set(btcCandles[i].timestamp, c < e21 && adx >= 22 && mdi > pdi);
  }

  const ablations: AblationResult[] = [];

  for (const cfg of cfgs) {
    const ctx: FilterCtx = {
      pairBiasBySym, btcBullByTs, btcBearByTs, tsToIdxBySym, regimeAgeBySym,
      symbols: SYMBOLS,
      useCrossPair: !!cfg.useCrossPair,
      useBtcBias: !!cfg.useBtcBias,
      useAdxTrajectory: !!cfg.useAdxTrajectory,
      useEmaStabilizer: !!cfg.useEmaStabilizer,
      useTrendAge: !!cfg.useTrendAge,
      crossPairOppositeMin: Number(process.env.BT_CROSS_MIN) || 7,
      adxTrajLookback: Number(process.env.BT_ADX_LOOKBACK) || 6,
      emaStackBars: Number(process.env.BT_EMA_BARS) || 3,
      emaSpreadMin: Number(process.env.BT_EMA_SPREAD) || 0.0005,
      trendAgeMaxHrs: Number(process.env.BT_TREND_AGE) || 12,
      useLiveBlocks: !!cfg.useLiveBlocks,
      fomcRanges: cfg.fomcRanges || [],
    };
    const anyOn = cfg.useCrossPair || cfg.useBtcBias || cfg.useAdxTrajectory || cfg.useEmaStabilizer || cfg.useTrendAge || cfg.useLiveBlocks;
    const filterCtx = anyOn ? ctx : null;

    const perPair = new Map<string, { trades: Trade[]; metrics: Metrics }>();
    for (const sym of SYMBOLS) {
      const candles = candlesBySym.get(sym)!;
      const series = seriesBySym.get(sym)!;
      // SOL: A only (per backtest gate)
      // BNB/OP/NEAR/AVAX/SUI/XLM/TAO: A only per universe rules
      const isAOnly = sym !== 'BTCUSDT' && sym !== 'ETHUSDT';
      const tradesA = runStrategy(candles, series, BEST_A, filterCtx);
      const tradesB = isAOnly ? [] : runStrategyB(candles, series, DEFAULT_B, filterCtx, sym);
      // merge non-overlapping
      const merged: Trade[] = [];
      let lastExit = -1;
      const all = [...tradesA, ...tradesB].sort((x, y) => x.entryIdx - y.entryIdx);
      for (const t of all) {
        if (t.entryIdx <= lastExit) continue;
        merged.push(t);
        lastExit = t.exitIdx;
      }
      const windowed = filterTradesByWindow(merged, cutoffTs);
      perPair.set(sym, { trades: windowed, metrics: computeMetrics(BEST_A as any, windowed) });
    }
    ablations.push(makeAblationResult(cfg.label, perPair));
  }

  // Summary table
  console.log(`\n┌─${'─'.repeat(31)}┬──────┬───────┬───────┬───────┬───────┬─────────┐`);
  console.log(`│ Config                          │ N    │ WR    │ sumR  │ PF    │ DD %  │ $/mo*   │`);
  console.log(`├─${'─'.repeat(31)}┼──────┼───────┼───────┼───────┼───────┼─────────┤`);
  for (const a of ablations) {
    const wr = a.totalTrades ? (a.totalWins / a.totalTrades) * 100 : 0;
    const monthlyR = a.totalSumR * (30 / Math.max(windowDays, 1));
    const monthlyDollars = monthlyR * 0.005 * 250000;
    console.log(`│ ${a.label.padEnd(31)} │ ${String(a.totalTrades).padStart(4)} │ ${fmt(wr).padStart(4)}% │ ${fmt(a.totalSumR, 2).padStart(5)} │ ${fmt(a.totalPF).padStart(5)} │ ${fmt(a.worstDD).padStart(4)}% │ \\$${fmt(monthlyDollars, 0).padStart(6)} │`);
  }
  console.log(`└─${'─'.repeat(31)}┴──────┴───────┴───────┴───────┴───────┴─────────┘`);
  console.log(`  * \\$/mo на $250k portfolio при 0.5% risk/trade`);

  // Per-pair detail for the best ablation (most filters)
  const best = ablations[ablations.length - 1];
  console.log(`\n─── Per-pair detail: ${best.label} ───`);
  console.log(`${'Pair'.padEnd(10)} | ${'N'.padStart(3)} | ${'WR'.padStart(6)} | ${'sumR'.padStart(6)} | ${'PF'.padStart(5)} | ${'DD%'.padStart(5)} | L/S`);
  console.log('─'.repeat(70));
  for (const sym of SYMBOLS) {
    const r = best.perPair.get(sym)!;
    const m = r.metrics;
    console.log(`${sym.padEnd(10)} | ${String(m.trades).padStart(3)} | ${fmt(m.winRate*100).padStart(5)}% | ${fmt(m.sumR, 2).padStart(6)} | ${fmt(m.profitFactor).padStart(5)} | ${fmt(m.maxDdPct).padStart(4)}% | ${m.longs}/${m.shorts}`);
  }

  // Diff: which trades did filters remove?
  const baseline = ablations[0];
  console.log(`\n─── Filter impact (baseline vs all-filters) ───`);
  for (const sym of SYMBOLS) {
    const baseTrades = baseline.perPair.get(sym)!.trades;
    const filtTrades = best.perPair.get(sym)!.trades;
    const baseTs = new Set(baseTrades.map(t => t.entryTs));
    const filtTs = new Set(filtTrades.map(t => t.entryTs));
    const removed = baseTrades.filter(t => !filtTs.has(t.entryTs));
    if (removed.length === 0) continue;
    const removedR = removed.reduce((s, t) => s + t.realizedR, 0);
    const removedWins = removed.filter(t => t.pnlUsd > 0).length;
    console.log(`  ${sym.padEnd(10)}: removed ${removed.length} trades (${removedWins}W/${removed.length - removedWins}L), Δ sumR ${fmt(removedR, 2)}`);
  }

  // Specific window validation for last 7d (if BT_WINDOW_DAYS=7) or last 30d
  if (windowDays <= 30) {
    console.log(`\n─── Trades in window (all configs, baseline detail) ───`);
    for (const sym of SYMBOLS) {
      const t = baseline.perPair.get(sym)!.trades;
      if (t.length === 0) continue;
      console.log(`\n  ${sym}: ${t.length} trade(s)`);
      for (const tr of t) {
        const ts = new Date(tr.entryTs).toISOString().slice(0, 16);
        console.log(`    ${ts} | ${tr.side.padEnd(5)} | entry ${tr.entryPrice.toFixed(4)} → exit ${tr.exitPrice.toFixed(4)} | R ${fmt(tr.realizedR, 2).padStart(5)} | ${tr.exitReason}`);
      }
    }
  }
}

// ───────────────────────────────────────────── grid-on-window — find best params for last N days ─────────────────────────────────────────────

async function runGridOnWindow() {
  const windowDays = Number(process.env.BT_WINDOW_DAYS) || 7;
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(` PARAMETER GRID-SWEEP on LAST ${windowDays}d (in-sample search)`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  WARNING: in-sample optimization. Best 7d config likely overfits.`);

  // Pre-fetch all symbols
  const candlesBySym = new Map<string, Candle[]>();
  for (const sym of SYMBOLS) {
    candlesBySym.set(sym, await fetchHistory(sym, DAYS));
  }
  const lastTs = Math.max(...[...candlesBySym.values()].map(cs => cs[cs.length - 1].timestamp));
  const cutoffTs = lastTs - (windowDays * 86400000) + 1;
  console.log(`  Window: ${new Date(cutoffTs).toISOString().slice(0,16)} → ${new Date(lastTs).toISOString().slice(0,16)}`);

  // Param sweep (A only — limited grid for speed)
  const aConfigs: Array<{ label: string; p: Params }> = [];
  for (const bbStd of [2.0, 2.5, 3.0]) {
    for (const rsi of [{ lo: 30, hi: 70 }, { lo: 35, hi: 65 }, { lo: 40, hi: 60 }]) {
      for (const adxMax of [18, 20, 22, 25]) {
        for (const vol of [1.0, 1.3, 2.0]) {
          aConfigs.push({
            label: `BB=${bbStd}σ RSI=${rsi.lo}/${rsi.hi} ADX<${adxMax} vol×${vol}`,
            p: { bbStd, rsiLo: rsi.lo, rsiHi: rsi.hi, adxMax, volSpikeMult: vol, wickPctMin: 0, adxAbort: 28, atrBufferMult: 0.5 }
          });
        }
      }
    }
  }

  const bConfigs: Array<{ label: string; p: ParamsB }> = [];
  for (const adxMin of [22, 25, 30]) {
    for (const ema of [21, 55] as const) {
      for (const tp1R of [1.5, 2.0, 3.0]) {
        for (const slATR of [0.7, 1.0, 1.5]) {
          bConfigs.push({
            label: `ADX≥${adxMin} EMA${ema} TP1=${tp1R}R slATR=${slATR}`,
            p: { adxMin, adxAbortB: adxMin - 5, pullbackEma: ema, pullbackTolPct: 0.005, rsiMid: 45, slAtrMult: slATR, tp1R, trailAtrMult: 2.5 }
          });
        }
      }
    }
  }

  // Run all A configs
  console.log(`\n─── PLAYBOOK A: ${aConfigs.length} configs ───`);
  const aResults = aConfigs.map(({ label, p }) => {
    const series = computeSeries(candlesBySym.get('BTCUSDT')!, p.bbStd); // dummy, we recompute per pair below
    let totalR = 0, totalT = 0, totalW = 0;
    for (const sym of SYMBOLS) {
      const candles = candlesBySym.get(sym)!;
      const s = computeSeries(candles, p.bbStd);
      const trades = filterTradesByWindow(runStrategy(candles, s, p), cutoffTs);
      totalR += trades.reduce((sum, t) => sum + t.realizedR, 0);
      totalT += trades.length;
      totalW += trades.filter(t => t.pnlUsd > 0).length;
    }
    return { label, p, sumR: totalR, trades: totalT, wins: totalW };
  });
  aResults.sort((a, b) => b.sumR - a.sumR);
  console.log(`${'Rank'.padStart(4)} | ${'Config'.padEnd(40)} | ${'N'.padStart(3)} | ${'WR'.padStart(5)} | ${'sumR'.padStart(6)}`);
  console.log('─'.repeat(80));
  for (let i = 0; i < Math.min(10, aResults.length); i++) {
    const r = aResults[i];
    const wr = r.trades ? (r.wins / r.trades * 100).toFixed(0) + '%' : 'n/a';
    console.log(`${String(i+1).padStart(4)} | ${r.label.padEnd(40)} | ${String(r.trades).padStart(3)} | ${wr.padStart(5)} | ${fmt(r.sumR, 2).padStart(6)}`);
  }
  console.log(`\n${'BOTTOM 5'.padStart(4)} | ${'Config'.padEnd(40)} | ${'N'.padStart(3)} | ${'WR'.padStart(5)} | ${'sumR'.padStart(6)}`);
  for (const r of aResults.slice(-5).reverse()) {
    const wr = r.trades ? (r.wins / r.trades * 100).toFixed(0) + '%' : 'n/a';
    console.log(`     | ${r.label.padEnd(40)} | ${String(r.trades).padStart(3)} | ${wr.padStart(5)} | ${fmt(r.sumR, 2).padStart(6)}`);
  }

  // Run all B configs
  console.log(`\n─── PLAYBOOK B: ${bConfigs.length} configs ───`);
  const bResults = bConfigs.map(({ label, p }) => {
    let totalR = 0, totalT = 0, totalW = 0;
    for (const sym of ['BTCUSDT', 'ETHUSDT']) { // B is only on BTC/ETH per current strategy
      const candles = candlesBySym.get(sym)!;
      const s = computeSeries(candles, 2.0);
      const trades = filterTradesByWindow(runStrategyB(candles, s, p), cutoffTs);
      totalR += trades.reduce((sum, t) => sum + t.realizedR, 0);
      totalT += trades.length;
      totalW += trades.filter(t => t.pnlUsd > 0).length;
    }
    return { label, p, sumR: totalR, trades: totalT, wins: totalW };
  });
  bResults.sort((a, b) => b.sumR - a.sumR);
  console.log(`${'Rank'.padStart(4)} | ${'Config'.padEnd(40)} | ${'N'.padStart(3)} | ${'WR'.padStart(5)} | ${'sumR'.padStart(6)}`);
  console.log('─'.repeat(80));
  for (let i = 0; i < Math.min(10, bResults.length); i++) {
    const r = bResults[i];
    const wr = r.trades ? (r.wins / r.trades * 100).toFixed(0) + '%' : 'n/a';
    console.log(`${String(i+1).padStart(4)} | ${r.label.padEnd(40)} | ${String(r.trades).padStart(3)} | ${wr.padStart(5)} | ${fmt(r.sumR, 2).padStart(6)}`);
  }

  // Validate top-3 A configs on full 365d to check if overfit
  console.log(`\n─── TOP-3 A configs validated on FULL 365d ───`);
  for (let i = 0; i < Math.min(3, aResults.length); i++) {
    const top = aResults[i];
    let totalR = 0, totalT = 0, totalW = 0;
    for (const sym of SYMBOLS) {
      const candles = candlesBySym.get(sym)!;
      const s = computeSeries(candles, top.p.bbStd);
      const trades = runStrategy(candles, s, top.p);
      totalR += trades.reduce((sum, t) => sum + t.realizedR, 0);
      totalT += trades.length;
      totalW += trades.filter(t => t.pnlUsd > 0).length;
    }
    const wr = totalT ? (totalW / totalT * 100).toFixed(0) + '%' : 'n/a';
    console.log(`  #${i+1}: ${top.label} → 7d ${fmt(top.sumR, 2)}R / 365d ${fmt(totalR, 2)}R (${totalT} trades, WR ${wr})`);
  }

  // Validate top-3 B configs on full 365d
  console.log(`\n─── TOP-3 B configs validated on FULL 365d (BTC+ETH) ───`);
  for (let i = 0; i < Math.min(3, bResults.length); i++) {
    const top = bResults[i];
    let totalR = 0, totalT = 0, totalW = 0;
    for (const sym of ['BTCUSDT', 'ETHUSDT']) {
      const candles = candlesBySym.get(sym)!;
      const s = computeSeries(candles, 2.0);
      const trades = runStrategyB(candles, s, top.p);
      totalR += trades.reduce((sum, t) => sum + t.realizedR, 0);
      totalT += trades.length;
      totalW += trades.filter(t => t.pnlUsd > 0).length;
    }
    const wr = totalT ? (totalW / totalT * 100).toFixed(0) + '%' : 'n/a';
    console.log(`  #${i+1}: ${top.label} → 7d ${fmt(top.sumR, 2)}R / 365d ${fmt(totalR, 2)}R (${totalT} trades, WR ${wr})`);
  }
}

// ───────────────────────────────────────────── live-blocks scenario — current strategy + dead zone + funding + FOMC ─────────────────────────────────────────────

async function runLiveBlocks() {
  const windowDays = Number(process.env.BT_WINDOW_DAYS) || 7;
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(` LIVE-BLOCKS SCENARIO — current strategy + session blocks, last ${windowDays}d`);
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  Blocks: dead zone 22-00 UTC | funding ±10min @00/08/16 UTC | FOMC blackouts`);

  const candlesBySym = new Map<string, Candle[]>();
  for (const sym of SYMBOLS) {
    candlesBySym.set(sym, await fetchHistory(sym, DAYS));
  }
  const lastTs = Math.max(...[...candlesBySym.values()].map(cs => cs[cs.length - 1].timestamp));
  const cutoffTs = lastTs - (windowDays * 86400000) + 1;
  console.log(`  Window: ${new Date(cutoffTs).toISOString().slice(0,16)} → ${new Date(lastTs).toISOString().slice(0,16)}`);

  // FOMC catalysts in last 30 days (matches catalysts.md)
  const fomcRanges: Array<{ startTs: number; endTs: number }> = [
    { startTs: Date.parse('2026-04-28T14:00:00Z'), endTs: Date.parse('2026-04-28T18:00:00Z') }, // FOMC day 1
    { startTs: Date.parse('2026-04-29T17:30:00Z'), endTs: Date.parse('2026-04-29T19:00:00Z') }, // FOMC day 2 (Powell)
  ];
  console.log(`  FOMC ranges: 28.04 14:00-18:00 UTC | 29.04 17:30-19:00 UTC`);

  // Build minimal FilterCtx for live-blocks only
  const ctx: FilterCtx = {
    pairBiasBySym: new Map(), btcBullByTs: new Map(), btcBearByTs: new Map(),
    tsToIdxBySym: new Map(), regimeAgeBySym: new Map(), symbols: SYMBOLS,
    useCrossPair: false, useBtcBias: false,
    useAdxTrajectory: false, useEmaStabilizer: false, useTrendAge: false,
    crossPairOppositeMin: 7, adxTrajLookback: 6, emaStackBars: 3,
    emaSpreadMin: 0.0005, trendAgeMaxHrs: 12,
    useLiveBlocks: true, fomcRanges,
  };

  // Run baseline (no blocks) and with-blocks
  const scenarios: Array<{ label: string; filterCtx: FilterCtx | null }> = [
    { label: 'NO BLOCKS (raw backtest)', filterCtx: null },
    { label: 'WITH live blocks',         filterCtx: ctx  },
  ];

  for (const sc of scenarios) {
    const perPair = new Map<string, { trades: Trade[]; metrics: Metrics }>();
    for (const sym of SYMBOLS) {
      const candles = candlesBySym.get(sym)!;
      const series = computeSeries(candles, BEST_A.bbStd);
      const isAOnly = sym !== 'BTCUSDT' && sym !== 'ETHUSDT';
      const tradesA = runStrategy(candles, series, BEST_A, sc.filterCtx);
      const tradesB = isAOnly ? [] : runStrategyB(candles, series, DEFAULT_B, sc.filterCtx);
      const merged: Trade[] = [];
      let lastExit = -1;
      const all = [...tradesA, ...tradesB].sort((x, y) => x.entryIdx - y.entryIdx);
      for (const t of all) {
        if (t.entryIdx <= lastExit) continue;
        merged.push(t);
        lastExit = t.exitIdx;
      }
      const windowed = filterTradesByWindow(merged, cutoffTs);
      perPair.set(sym, { trades: windowed, metrics: computeMetrics(BEST_A as any, windowed) });
    }
    let totalSumR = 0, totalT = 0, totalW = 0, grossWin = 0, grossLoss = 0, worstDD = 0;
    for (const r of perPair.values()) {
      totalSumR += r.metrics.sumR; totalT += r.metrics.trades;
      totalW += r.metrics.wins; worstDD = Math.max(worstDD, r.metrics.maxDdPct);
      for (const t of r.trades) {
        if (t.pnlUsd > 0) grossWin += t.pnlUsd; else grossLoss += Math.abs(t.pnlUsd);
      }
    }
    const totalPF = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const wr = totalT ? (totalW / totalT) * 100 : 0;
    const monthlyR = totalSumR * (30 / Math.max(windowDays, 1));
    const monthlyDollars = monthlyR * 0.005 * 250000;

    console.log(`\n─── ${sc.label} ───`);
    console.log(`  Trades: ${totalT}, WR ${fmt(wr)}%, sumR ${fmt(totalSumR, 2)}, PF ${fmt(totalPF)}, DD ${fmt(worstDD)}%`);
    console.log(`  Projected $/mo on $250k: \\$${fmt(monthlyDollars, 0)}`);

    console.log(`  Per-pair:`);
    for (const sym of SYMBOLS) {
      const r = perPair.get(sym)!;
      if (r.metrics.trades === 0) continue;
      console.log(`    ${sym.padEnd(10)}: ${r.metrics.trades} trades, WR ${fmt(r.metrics.winRate*100)}%, sumR ${fmt(r.metrics.sumR, 2)}`);
    }

    console.log(`  Trades:`);
    for (const sym of SYMBOLS) {
      const trades = perPair.get(sym)!.trades;
      for (const t of trades) {
        const ts = new Date(t.entryTs).toISOString().slice(0, 16);
        console.log(`    ${ts} | ${sym.padEnd(8)} | ${t.side.padEnd(5)} | ${t.entryPrice.toFixed(4)} → ${t.exitPrice.toFixed(4)} | R ${fmt(t.realizedR, 2).padStart(5)} | ${t.exitReason}`);
      }
    }
  }
}

async function main() {
  if (process.argv.includes('--liveblocks')) {
    await runLiveBlocks();
    return;
  }
  if (process.argv.includes('--walkforward')) {
    await runWalkForward();
    return;
  }
  if (process.argv.includes('--filters')) {
    await runFilterAblation();
    return;
  }
  if (process.argv.includes('--gridwindow')) {
    await runGridOnWindow();
    return;
  }
  if (process.argv.includes('--rigorous')) {
    await runRigorous();
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
