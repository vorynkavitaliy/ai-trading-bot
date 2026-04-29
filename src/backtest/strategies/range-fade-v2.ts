import { Action, Strategy, StrategyContext } from '../types';

// Range-fade v2 — derived from Stage 3.5 Claude Walk insights.
//
// Original range-fade (Etap 3) failed PF gate because the BB-touch + RSI + volume
// trigger fires predominantly during trending capitulations, not in actual range
// consolidations. Adding two regime gates (ADX low + ATR% low) should isolate
// real range-fade setups.

export interface RangeFadeV2Params {
  // Trigger
  rsiLow: number;          // 32
  rsiHigh: number;         // 68
  volSpikeMin: number;     // 1.5
  // Regime gates (the new bits from Walk)
  adxMax: number;          // 22 — strictly NO trend
  atrPctMax: number;       // 1.5 — only consolidation; crash flushes excluded
  // Stop / target geometry
  slAtrMult: number;       // 0.5 — buffer beyond BB band
  minStopAtr: number;      // 0.3 — reject too-tight setups
  riskPct: number;         // 0.6 base
}

export const DEFAULT_RANGE_FADE_V2: RangeFadeV2Params = {
  rsiLow: 32,
  rsiHigh: 68,
  volSpikeMin: 1.5,
  adxMax: 22,
  atrPctMax: 1.5,
  slAtrMult: 0.5,
  minStopAtr: 0.3,
  riskPct: 0.6,
};

export function rangeFadeV2(params: RangeFadeV2Params = DEFAULT_RANGE_FADE_V2): Strategy {
  return {
    name: `range-fade-v2(adx<${params.adxMax}, atr%<${params.atrPctMax}, rsi[${params.rsiLow},${params.rsiHigh}], vol≥${params.volSpikeMin}×)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (
        f.bb_upper == null || f.bb_lower == null || f.bb_middle == null ||
        f.rsi == null || f.atr == null || f.atr_pct == null || f.adx == null ||
        f.volume_spike == null
      ) {
        return { kind: 'hold' };
      }
      // Regime gates — the lessons from Stage 3.5
      if (f.adx >= params.adxMax) return { kind: 'hold' };
      if (f.atr_pct >= params.atrPctMax) return { kind: 'hold' };
      if (f.volume_spike < params.volSpikeMin) return { kind: 'hold' };

      // LONG: BB-lower touch + RSI oversold
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
          rationale: `range-fade-v2 LONG: ADX ${f.adx.toFixed(1)} (range), ATR% ${f.atr_pct.toFixed(2)} (consolidation). Close ${ctx.price.toFixed(2)} ≤ BB.lower ${f.bb_lower.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, vol×${f.volume_spike.toFixed(2)}.`,
        };
      }
      // SHORT: BB-upper touch + RSI overbought
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
          rationale: `range-fade-v2 SHORT: ADX ${f.adx.toFixed(1)} (range), ATR% ${f.atr_pct.toFixed(2)} (consolidation). Close ${ctx.price.toFixed(2)} ≥ BB.upper ${f.bb_upper.toFixed(2)}, RSI ${f.rsi.toFixed(1)}, vol×${f.volume_spike.toFixed(2)}.`,
        };
      }
      return { kind: 'hold' };
    },
  };
}
