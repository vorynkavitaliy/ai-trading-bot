import { Action, Strategy, StrategyContext } from '../types';

// Playbook A — Range Mean-Reversion
// Entry conditions (1H close):
//   LONG  if close <= BB.lower AND RSI < rsiLow AND volume_spike >= volSpike AND ADX < adxMax
//   SHORT if close >= BB.upper AND RSI > rsiHigh AND volume_spike >= volSpike AND ADX < adxMax
// SL = BB-edge ± slAtrMult × ATR; min stop distance = minStopAtr × ATR
// TP1 = BB.middle (50%); TP2 = opposite BB band (50%); SL→breakeven after TP1.
// Abort entry if SL distance < minStopAtr × ATR.

export interface RangeFadeParams {
  adxMax: number;        // 22
  rsiLow: number;        // 35
  rsiHigh: number;       // 65
  volSpike: number;      // 1.3
  slAtrMult: number;     // 0.5
  minStopAtr: number;    // 0.3
  riskPct: number;       // 0.6
}

export const DEFAULT_RANGE_FADE: RangeFadeParams = {
  adxMax: 22,
  rsiLow: 35,
  rsiHigh: 65,
  volSpike: 1.3,
  slAtrMult: 0.5,
  minStopAtr: 0.3,
  riskPct: 0.6,
};

export function rangeFade(params: RangeFadeParams = DEFAULT_RANGE_FADE): Strategy {
  return {
    name: `range-fade(adx<${params.adxMax}, rsi[${params.rsiLow},${params.rsiHigh}], vol≥${params.volSpike}×)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (
        f.bb_upper == null || f.bb_lower == null || f.bb_middle == null ||
        f.rsi == null || f.atr == null || f.adx == null || f.volume_spike == null
      ) {
        return { kind: 'hold' };
      }
      if (f.adx >= params.adxMax) return { kind: 'hold' };
      if (f.volume_spike < params.volSpike) return { kind: 'hold' };

      // LONG fade lower band
      if (ctx.price <= f.bb_lower && f.rsi < params.rsiLow) {
        const sl = f.bb_lower - params.slAtrMult * f.atr;
        const stopDist = ctx.price - sl;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter',
          side: 'long',
          orderType: 'market',
          entryPrice: ctx.price,
          sl,
          tp1: f.bb_middle,
          tp2: f.bb_upper,
          sizePct: params.riskPct,
          rationale: `range-fade LONG: close ${ctx.price.toFixed(2)} ≤ BB.lower ${f.bb_lower.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, vol×${f.volume_spike.toFixed(2)}, ADX ${f.adx.toFixed(1)}`,
        };
      }
      // SHORT fade upper band
      if (ctx.price >= f.bb_upper && f.rsi > params.rsiHigh) {
        const sl = f.bb_upper + params.slAtrMult * f.atr;
        const stopDist = sl - ctx.price;
        if (stopDist < params.minStopAtr * f.atr) return { kind: 'hold' };
        return {
          kind: 'enter',
          side: 'short',
          orderType: 'market',
          entryPrice: ctx.price,
          sl,
          tp1: f.bb_middle,
          tp2: f.bb_lower,
          sizePct: params.riskPct,
          rationale: `range-fade SHORT: close ${ctx.price.toFixed(2)} ≥ BB.upper ${f.bb_upper.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, vol×${f.volume_spike.toFixed(2)}, ADX ${f.adx.toFixed(1)}`,
        };
      }
      return { kind: 'hold' };
    },
  };
}
