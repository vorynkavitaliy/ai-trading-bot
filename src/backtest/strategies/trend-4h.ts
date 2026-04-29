import { Action, Strategy, StrategyContext } from '../types';

// Trend pullback on 4H with daily + weekly bias as master regime gate.
//
// Logic:
//   - Long bias requires close > EMA50(D) AND close > EMA21(W).
//   - 4H structure: ADX ≥ adxMin AND EMA stack aligned bullish.
//   - Entry: pullback to 4H EMA21 within ±emaBandPct, then close back above EMA21
//     (confirmation that pullback held).
//   - RSI(4H) ≥ rsiMin to avoid catching deep correction.
// Short mirrors.

export interface Trend4hParams {
  adxMin: number;          // 20 — softer than 1H trend pullback
  emaBandPct: number;      // 1.0 — within 1% of 4H EMA21
  rsiMinLong: number;      // 42
  rsiMaxShort: number;     // 58
  slAtrMult: number;       // 1.5 — wider stop on 4H
  minStopAtr: number;      // 0.6
  tp1R: number;            // 2
  tp2R: number;            // 4
  riskPct: number;         // 0.6
}

export const DEFAULT_TREND_4H: Trend4hParams = {
  adxMin: 20,
  emaBandPct: 1.0,
  rsiMinLong: 42,
  rsiMaxShort: 58,
  slAtrMult: 1.5,
  minStopAtr: 0.6,
  tp1R: 2,
  tp2R: 4,
  riskPct: 0.6,
};

function dayBiasBullish(featD: any): boolean {
  if (!featD || featD.ema21 == null || featD.close == null) return false;
  return featD.close > featD.ema21 && (featD.ema_stack_aligned === 'bull' || featD.ema8! > featD.ema21!);
}

function dayBiasBearish(featD: any): boolean {
  if (!featD || featD.ema21 == null || featD.close == null) return false;
  return featD.close < featD.ema21 && (featD.ema_stack_aligned === 'bear' || featD.ema8! < featD.ema21!);
}

function weekBiasBullish(featW: any): boolean {
  if (!featW || featW.ema21 == null || featW.close == null) return true;  // missing W is permissive
  return featW.close > featW.ema21;
}

function weekBiasBearish(featW: any): boolean {
  if (!featW || featW.ema21 == null || featW.close == null) return true;
  return featW.close < featW.ema21;
}

export function trend4h(params: Trend4hParams = DEFAULT_TREND_4H): Strategy {
  return {
    name: `trend-4h(adx≥${params.adxMin}, ema21±${params.emaBandPct}%, ${params.tp1R}R/${params.tp2R}R)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features4h;
      if (
        !f || f.adx == null || f.pdi == null || f.mdi == null ||
        f.ema8 == null || f.ema21 == null || f.ema55 == null || f.ema200 == null ||
        f.atr == null || f.rsi == null || f.close == null
      ) return { kind: 'hold' };

      if (f.adx < params.adxMin) return { kind: 'hold' };

      const band = f.ema21 * (params.emaBandPct / 100);
      const inBand = Math.abs(f.close - f.ema21) <= band;
      if (!inBand) return { kind: 'hold' };

      // LONG: bull stack on 4H + day bullish + week bullish + close > EMA21 + RSI ≥ rsiMin
      if (
        f.ema_stack_aligned === 'bull' &&
        f.pdi > f.mdi &&
        f.close > f.ema21 &&
        f.rsi >= params.rsiMinLong &&
        dayBiasBullish(ctx.featuresD) &&
        weekBiasBullish(ctx.featuresW)
      ) {
        const sl = f.close - params.slAtrMult * f.atr;
        const stopDist = f.close - sl;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter', side: 'long', orderType: 'market',
          entryPrice: f.close, sl,
          tp1: f.close + params.tp1R * stopDist,
          tp2: f.close + params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `trend-4h LONG: 4H ADX ${f.adx.toFixed(1)} bull-stack, pullback to EMA21 ${f.ema21.toFixed(2)} (close ${f.close.toFixed(2)}), D-bias bull, W-bias bull, RSI ${f.rsi.toFixed(1)}.`,
        };
      }
      // SHORT
      if (
        f.ema_stack_aligned === 'bear' &&
        f.mdi > f.pdi &&
        f.close < f.ema21 &&
        f.rsi <= params.rsiMaxShort &&
        dayBiasBearish(ctx.featuresD) &&
        weekBiasBearish(ctx.featuresW)
      ) {
        const sl = f.close + params.slAtrMult * f.atr;
        const stopDist = sl - f.close;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter', side: 'short', orderType: 'market',
          entryPrice: f.close, sl,
          tp1: f.close - params.tp1R * stopDist,
          tp2: f.close - params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `trend-4h SHORT: 4H ADX ${f.adx.toFixed(1)} bear-stack, pullback to EMA21 ${f.ema21.toFixed(2)} (close ${f.close.toFixed(2)}), D-bias bear, W-bias bear, RSI ${f.rsi.toFixed(1)}.`,
        };
      }
      return { kind: 'hold' };
    },
  };
}
