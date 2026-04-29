import { Action, Strategy, StrategyContext } from '../types';

// Playbook B — Trend Pullback to EMA55
// Entry LONG (all required):
//   ADX >= adxMin AND +DI > -DI
//   EMA8 > EMA21 > EMA55 > EMA200 (bull stack)
//   price within ema55Band of EMA55
//   close > EMA55 (rejection)
//   RSI > rsiMin
// SL = price − slAtrMult × ATR; min stop = minStopAtr × ATR
// TP1 = entry + tp1R × stopDist (close 50%, breakeven)
// TP2 = trailing chandelier (simplified: tp2R fixed for backtest baseline)

export interface TrendPullbackParams {
  adxMin: number;       // 25
  ema55BandPct: number; // 0.5  → ±0.5% of EMA55
  rsiMinLong: number;   // 45
  rsiMaxShort: number;  // 55
  slAtrMult: number;    // 1.0
  minStopAtr: number;   // 0.5
  tp1R: number;         // 3
  tp2R: number;         // 6 (instead of trailing chandelier — trailing not yet supported in engine)
  riskPct: number;      // 0.6
}

export const DEFAULT_TREND_PULLBACK: TrendPullbackParams = {
  adxMin: 25,
  ema55BandPct: 0.5,
  rsiMinLong: 45,
  rsiMaxShort: 55,
  slAtrMult: 1.0,
  minStopAtr: 0.5,
  tp1R: 3,
  tp2R: 6,
  riskPct: 0.6,
};

export function trendPullback(params: TrendPullbackParams = DEFAULT_TREND_PULLBACK): Strategy {
  return {
    name: `trend-pullback(adx≥${params.adxMin}, ema55±${params.ema55BandPct}%, ${params.tp1R}R/${params.tp2R}R)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (
        f.adx == null || f.pdi == null || f.mdi == null ||
        f.ema8 == null || f.ema21 == null || f.ema55 == null || f.ema200 == null ||
        f.atr == null || f.rsi == null
      ) return { kind: 'hold' };

      if (f.adx < params.adxMin) return { kind: 'hold' };

      const ema55Band = f.ema55 * (params.ema55BandPct / 100);
      const inBand = Math.abs(ctx.price - f.ema55) <= ema55Band;
      if (!inBand) return { kind: 'hold' };

      // LONG: bull stack + +DI > -DI + close > EMA55 + RSI > rsiMinLong
      if (
        f.ema_stack_aligned === 'bull' && f.pdi > f.mdi &&
        ctx.price > f.ema55 && f.rsi > params.rsiMinLong
      ) {
        const sl = ctx.price - params.slAtrMult * f.atr;
        const stopDist = ctx.price - sl;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter', side: 'long', orderType: 'market',
          entryPrice: ctx.price,
          sl,
          tp1: ctx.price + params.tp1R * stopDist,
          tp2: ctx.price + params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `trend-pullback LONG: bull-stack, ADX ${f.adx.toFixed(1)}, +DI ${f.pdi.toFixed(1)}>${f.mdi.toFixed(1)}, EMA55 ${f.ema55.toFixed(2)} (price ${ctx.price.toFixed(2)}), RSI ${f.rsi.toFixed(1)}`,
        };
      }
      // SHORT: bear stack + -DI > +DI + close < EMA55 + RSI < rsiMaxShort
      if (
        f.ema_stack_aligned === 'bear' && f.mdi > f.pdi &&
        ctx.price < f.ema55 && f.rsi < params.rsiMaxShort
      ) {
        const sl = ctx.price + params.slAtrMult * f.atr;
        const stopDist = sl - ctx.price;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter', side: 'short', orderType: 'market',
          entryPrice: ctx.price,
          sl,
          tp1: ctx.price - params.tp1R * stopDist,
          tp2: ctx.price - params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `trend-pullback SHORT: bear-stack, ADX ${f.adx.toFixed(1)}, -DI ${f.mdi.toFixed(1)}>${f.pdi.toFixed(1)}, EMA55 ${f.ema55.toFixed(2)} (price ${ctx.price.toFixed(2)}), RSI ${f.rsi.toFixed(1)}`,
        };
      }
      return { kind: 'hold' };
    },
  };
}
