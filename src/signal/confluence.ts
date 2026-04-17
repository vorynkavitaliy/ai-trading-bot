/**
 * Unified 8-factor confluence model.
 *
 * Used for BOTH entry decisions and position health monitoring.
 *
 * SMC is the DOMINANT factor — structural entries (sweep + OB tap)
 * get a fast-path with lower threshold:
 *
 *   Standard entry:    5/8
 *   Structural entry:  SMC=strong + Multi-TF → 4/8 enough
 *   Counter-trend:     6/8
 *   A+ setup:          7-8/8
 *   Early exit:        4/8 adverse (opposite direction)
 *
 * Factors:
 *   1. SMC/Structure     — sweep+OB (strong=2pts), BOS (weak=1pt), none=0
 *   2. Technical          — RSI capitulation/div, EMA, MACD direction change
 *   3. Volume             — OBV, volume spike/quality, VWAP
 *   4. Multi-TF alignment — 4H→1H→15M + BTC for alts (no 3M trigger lag)
 *   5. Regime + BTC       — market regime + BTC correlation for alts
 *   6. News/Macro         — news bias supports direction
 *   7. Momentum quality   — ADX trending, DI alignment, RSI slope
 *   8. Volatility         — ATR percentile 10-85
 */

import { Candle, Indicators } from '../analysis/indicators';
import { Structure } from '../analysis/structure';
import { Regime } from './regime';
import { Direction } from './generator';

export interface FactorScore {
  name: string;
  score: 0 | 1;
  /** SMC can score 2 for strong setups (sweep+OB). Used for fast-path threshold. */
  rawScore: number;
  detail: string;
}

export interface ConfluenceResult {
  factors: FactorScore[];
  total: number;
  /** True if SMC scored 2 (sweep+OB tap) — enables lower threshold */
  smcStrong: boolean;
  bullTotal: number;
  bearTotal: number;
  adverseForLong: number;
  adverseForShort: number;
}

export interface ConfluenceInput {
  c4h: Candle[];
  c1h: Candle[];
  c15m: Candle[];
  c3m?: Candle[];
  regime: Regime;
  newsBias?: 'risk-on' | 'risk-off' | 'neutral';
  btc?: {
    regime: Regime;
    trend1h: 'up' | 'down' | 'range';
    rsiSlope: number;
  };
}

export function scoreConfluence(dir: Direction, i: ConfluenceInput): FactorScore[] {
  return [
    scoreSMC(dir, i),
    scoreTechnical(dir, i),
    scoreVolume(dir, i),
    scoreMultiTF(dir, i),
    scoreRegime(dir, i),
    scoreNews(dir, i),
    scoreMomentum(dir, i),
    scoreVolatility(i),
  ];
}

export function evaluateConfluence(i: ConfluenceInput): ConfluenceResult {
  const bullFactors = scoreConfluence('Long', i);
  const bearFactors = scoreConfluence('Short', i);

  const bullTotal = bullFactors.reduce((s, f) => s + f.score, 0);
  const bearTotal = bearFactors.reduce((s, f) => s + f.score, 0);

  const dominant = bullTotal >= bearTotal ? bullFactors : bearFactors;
  const total = Math.max(bullTotal, bearTotal);
  const smcStrong = dominant[0].rawScore >= 2;

  const adverseForLong = bearFactors.reduce((s, f) => s + f.score, 0);
  const adverseForShort = bullFactors.reduce((s, f) => s + f.score, 0);

  return { factors: dominant, total, smcStrong, bullTotal, bearTotal, adverseForLong, adverseForShort };
}

// ─── 1. SMC / Structure (DOMINANT FACTOR) ──────────────────────────
//
// Pro traders enter on sweep + OB tap BEFORE BOS — that's the edge.
// - sweep+OB tap = strong (rawScore=2) → enables fast-path entry at 4/8
// - sweep OR BOS alone = standard (rawScore=1)
// - nothing = 0

function scoreSMC(dir: Direction, i: ConfluenceInput): FactorScore {
  const sweep1h = Structure.liquiditySweep(i.c1h);
  const sweep15 = Structure.liquiditySweep(i.c15m);
  const bos1h = Structure.bos(i.c1h);
  const ob1h = Structure.lastOrderBlock(i.c1h, dir === 'Long' ? 'bullish' : 'bearish');
  const ob15 = Structure.lastOrderBlock(i.c15m, dir === 'Long' ? 'bullish' : 'bearish');
  const last15 = i.c15m[i.c15m.length - 1];

  const isLong = dir === 'Long';
  const sweepDir = isLong ? 'bullish' : 'bearish';

  // Check for sweep + OB tap combo (strong — the pro entry)
  const hasSweep = sweep1h === sweepDir || sweep15 === sweepDir;
  const hasOBTap1h = ob1h && last15 && (isLong
    ? (last15.low <= ob1h.high && last15.close > ob1h.low)
    : (last15.high >= ob1h.low && last15.close < ob1h.high));
  const hasOBTap15 = ob15 && last15 && (isLong
    ? (last15.low <= ob15.high && last15.close > ob15.low)
    : (last15.high >= ob15.low && last15.close < ob15.high));
  const hasOBTap = hasOBTap1h || hasOBTap15;

  // Strong: sweep + OB tap (pro entry — before BOS)
  if (hasSweep && hasOBTap) {
    return { name: 'SMC', score: 1, rawScore: 2, detail: `sweep+OB tap ${sweepDir} (STRONG)` };
  }

  // Standard: sweep alone, OB tap alone, or BOS
  if (hasSweep) return { name: 'SMC', score: 1, rawScore: 1, detail: `sweep ${sweepDir}` };
  if (hasOBTap) return { name: 'SMC', score: 1, rawScore: 1, detail: `OB tap ${sweepDir}` };
  if (bos1h === sweepDir) return { name: 'SMC', score: 1, rawScore: 1, detail: `BOS ${sweepDir} (lagging)` };

  return { name: 'SMC', score: 0, rawScore: 0, detail: 'no SMC trigger' };
}

// ─── 2. Technical (fixed: capitulation RSI, MACD direction change) ──

function scoreTechnical(dir: Direction, i: ConfluenceInput): FactorScore {
  const rsi = Indicators.rsi(i.c1h);
  const macd = Indicators.macd(i.c1h);
  const ema20 = Indicators.ema(i.c1h, 20);
  const ema50 = Indicators.ema(i.c1h, 50);
  const div = Indicators.rsiDivergence(i.c1h);

  // Also check 1H MACD histogram slope (direction change = early signal)
  const macdVals = i.c1h.length > 30 ? (() => {
    const { MACD: m } = require('technicalindicators');
    const vals = m.calculate({ values: i.c1h.map((c: Candle) => c.close), fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
    if (vals.length < 3) return null;
    const last3 = vals.slice(-3);
    return { rising: last3[2].histogram > last3[0].histogram, falling: last3[2].histogram < last3[0].histogram };
  })() : null;

  let hits = 0;
  const reasons: string[] = [];

  if (dir === 'Long') {
    // RSI divergence is the strongest early signal
    if (div === 'bullish') { hits += 2; reasons.push('RSI bull div (strong)'); }
    // Capitulation RSI < 30 (not 40 — that's just weak, not opportunity)
    if (rsi !== undefined && rsi < 30) { hits++; reasons.push(`RSI ${rsi.toFixed(0)} capitulation`); }
    // EMA alignment
    if (ema20 !== undefined && ema50 !== undefined && ema20 > ema50) { hits++; reasons.push('EMA20>50'); }
    // MACD histogram turning up (direction change, not absolute position)
    if (macdVals?.rising) { hits++; reasons.push('MACD hist rising'); }
    else if (macd && macd.histogram > 0 && macd.MACD > macd.signal) { hits++; reasons.push('MACD bull'); }
  } else {
    if (div === 'bearish') { hits += 2; reasons.push('RSI bear div (strong)'); }
    if (rsi !== undefined && rsi > 70) { hits++; reasons.push(`RSI ${rsi.toFixed(0)} overbought`); }
    if (ema20 !== undefined && ema50 !== undefined && ema20 < ema50) { hits++; reasons.push('EMA20<50'); }
    if (macdVals?.falling) { hits++; reasons.push('MACD hist falling'); }
    else if (macd && macd.histogram < 0 && macd.MACD < macd.signal) { hits++; reasons.push('MACD bear'); }
  }

  // 2+ hits = pass (RSI div alone gives 2 = instant pass)
  return hits >= 2
    ? { name: 'Technical', score: 1, rawScore: hits, detail: reasons.join(', ') }
    : { name: 'Technical', score: 0, rawScore: hits, detail: `${hits} hits: ${reasons.join(', ') || 'none'}` };
}

// ─── 3. Volume ─────────────────────────────────────────────────────

function scoreVolume(dir: Direction, i: ConfluenceInput): FactorScore {
  const obvDiv = Indicators.obvDivergence(i.c1h);
  const spike = Indicators.volumeSpike(i.c1h);
  const vwap = Indicators.vwap(i.c1h.slice(-24));
  const lastClose = i.c1h[i.c1h.length - 1].close;
  const declining = Indicators.volumeDeclining(i.c1h);

  let hits = 0;
  const reasons: string[] = [];

  if (dir === 'Long') {
    if (obvDiv === 'bullish') { hits++; reasons.push('OBV bull div'); }
    if (spike && i.c1h[i.c1h.length - 1].close > i.c1h[i.c1h.length - 1].open) { hits++; reasons.push('vol spike+green'); }
    if (vwap !== undefined && lastClose > vwap) { hits++; reasons.push('above VWAP'); }
  } else {
    if (obvDiv === 'bearish') { hits++; reasons.push('OBV bear div'); }
    if (spike && i.c1h[i.c1h.length - 1].close < i.c1h[i.c1h.length - 1].open) { hits++; reasons.push('vol spike+red'); }
    if (vwap !== undefined && lastClose < vwap) { hits++; reasons.push('below VWAP'); }
  }
  if (declining) reasons.push('vol declining');

  return hits >= 1
    ? { name: 'Volume', score: 1, rawScore: hits, detail: reasons.join(', ') }
    : { name: 'Volume', score: 0, rawScore: 0, detail: reasons.join(', ') || 'no vol confirm' };
}

// ─── 4. Multi-TF (fixed: no 3M trigger lag, structure-based) ──────
//
// Old: waited for 3M candle close direction — +3 min lag.
// New: 4H bias → 1H structure → 15M structure. No micro-trigger wait.

function scoreMultiTF(dir: Direction, i: ConfluenceInput): FactorScore {
  const trend4h = Structure.trend(i.c4h);
  const trend1h = Structure.trend(i.c1h);
  const trend15m = Structure.trend(i.c15m);

  const btcTrend = i.btc?.trend1h;
  const detail = `4H:${trend4h}/1H:${trend1h}/15M:${trend15m}${btcTrend ? `/BTC:${btcTrend}` : ''}`;

  if (dir === 'Long') {
    const pairOk = (i.regime === 'Bull' || trend4h === 'up')
      && trend1h !== 'down'
      && (trend15m === 'up' || trend15m === 'range');
    const btcOk = !btcTrend || btcTrend !== 'down';
    return { name: 'Multi-TF', score: (pairOk && btcOk) ? 1 : 0, rawScore: (pairOk && btcOk) ? 1 : 0, detail };
  } else {
    const pairOk = (i.regime === 'Bear' || trend4h === 'down')
      && trend1h !== 'up'
      && (trend15m === 'down' || trend15m === 'range');
    const btcOk = !btcTrend || btcTrend !== 'up';
    return { name: 'Multi-TF', score: (pairOk && btcOk) ? 1 : 0, rawScore: (pairOk && btcOk) ? 1 : 0, detail };
  }
}

// ─── 5. Regime + BTC correlation ───────────────────────────────────

function scoreRegime(dir: Direction, i: ConfluenceInput): FactorScore {
  let pairOk = false;
  if (dir === 'Long') pairOk = i.regime === 'Bull' || i.regime === 'Range';
  else pairOk = i.regime === 'Bear' || i.regime === 'Range';

  if (!pairOk) return { name: 'Regime', score: 0, rawScore: 0, detail: `${i.regime} vs ${dir}` };

  if (i.btc) {
    if (dir === 'Long' && i.btc.regime === 'Bear') {
      return { name: 'Regime', score: 0, rawScore: 0, detail: `${i.regime} OK but BTC Bear → alts Long risky` };
    }
    if (dir === 'Short' && i.btc.regime === 'Bull' && i.btc.rsiSlope > 1) {
      return { name: 'Regime', score: 0, rawScore: 0, detail: `${i.regime} OK but BTC Bull strong → Short risky` };
    }
    return { name: 'Regime', score: 1, rawScore: 1, detail: `${i.regime}+BTC:${i.btc.regime} → ${dir}` };
  }

  return { name: 'Regime', score: 1, rawScore: 1, detail: `${i.regime} → ${dir}` };
}

// ─── 6. News / Macro ───────────────────────────────────────────────

function scoreNews(dir: Direction, i: ConfluenceInput): FactorScore {
  const bias = i.newsBias ?? 'neutral';
  if (bias === 'neutral') return { name: 'News', score: 1, rawScore: 1, detail: 'neutral' };
  if (dir === 'Long' && bias === 'risk-on') return { name: 'News', score: 1, rawScore: 1, detail: 'risk-on → Long' };
  if (dir === 'Short' && bias === 'risk-off') return { name: 'News', score: 1, rawScore: 1, detail: 'risk-off → Short' };
  if (dir === 'Long' && bias === 'risk-off') return { name: 'News', score: 0, rawScore: 0, detail: 'risk-off vs Long' };
  if (dir === 'Short' && bias === 'risk-on') return { name: 'News', score: 0, rawScore: 0, detail: 'risk-on vs Short' };
  return { name: 'News', score: 1, rawScore: 1, detail: bias };
}

// ─── 7. Momentum quality ───────────────────────────────────────────

function scoreMomentum(dir: Direction, i: ConfluenceInput): FactorScore {
  const adx = Indicators.adx(i.c1h);
  const rsiSlope = Indicators.rsiSlope(i.c1h);

  const reasons: string[] = [];
  let ok = true;

  if (adx && adx.adx >= 20) {
    reasons.push(`ADX ${adx.adx.toFixed(0)}`);
    if (dir === 'Long' && adx.pdi > adx.mdi) reasons.push('+DI>-DI');
    else if (dir === 'Short' && adx.mdi > adx.pdi) reasons.push('-DI>+DI');
    else { ok = false; reasons.push('DI misaligned'); }
  } else {
    ok = false;
    reasons.push(`ADX ${adx?.adx.toFixed(0) ?? '?'} weak`);
  }

  if (rsiSlope !== undefined) {
    if (dir === 'Long' && rsiSlope > 0.5) reasons.push(`RSI slope +${rsiSlope.toFixed(1)}`);
    else if (dir === 'Short' && rsiSlope < -0.5) reasons.push(`RSI slope ${rsiSlope.toFixed(1)}`);
    else if (Math.abs(rsiSlope) <= 0.5) { reasons.push('RSI flat'); ok = false; }
    else { reasons.push(`RSI slope wrong ${rsiSlope.toFixed(1)}`); ok = false; }
  }

  return { name: 'Momentum', score: ok ? 1 : 0, rawScore: ok ? 1 : 0, detail: reasons.join(', ') };
}

// ─── 8. Volatility ─────────────────────────────────────────────────

function scoreVolatility(i: ConfluenceInput): FactorScore {
  const atrPct = Indicators.atrPercentile(i.c1h);

  if (atrPct === undefined) return { name: 'Volatility', score: 1, rawScore: 1, detail: 'ATR data insufficient' };

  if (atrPct >= 10 && atrPct <= 85) {
    return { name: 'Volatility', score: 1, rawScore: 1, detail: `ATR p${atrPct.toFixed(0)} (normal)` };
  }
  if (atrPct > 85) {
    return { name: 'Volatility', score: 0, rawScore: 0, detail: `ATR p${atrPct.toFixed(0)} (extreme)` };
  }
  return { name: 'Volatility', score: 0, rawScore: 0, detail: `ATR p${atrPct.toFixed(0)} (compressed)` };
}
