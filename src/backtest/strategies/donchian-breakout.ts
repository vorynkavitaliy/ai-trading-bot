import { Action, Strategy, StrategyContext } from '../types';

// Donchian/Turtle-style breakout
// Entry LONG when:
//   close > highest_close_lookback (i.e. current bar makes new N-period high)
//   ADX >= adxMin (trending market)
//   ATR not in squeeze (atr_pct >= atrPctMin)
// Entry SHORT mirrors.
// SL = entry - slAtrMult * ATR
// TP1 = entry + tp1R * stopDist (50% close + breakeven)
// TP2 = entry + tp2R * stopDist (rest)
//
// We piggyback on engine's 1H bars; "lookback period" reads recent closes
// via the StrategyContext (we get prior context through features.h1 only —
// the engine doesn't pass raw bars). Workaround: decode lookback via
// features.h1.bb_upper proxy is wrong. Better: pass through
// StrategyContext with a small `recent` array.

// For now we use bb_upper (period 20) as a proxy for "20-bar high" — a
// simplification: BB.upper = SMA20 + 2*stdev. True Donchian needs raw highs.
// We'll add raw highs via context extension in a follow-up if this passes baseline.

export interface DonchianParams {
  adxMin: number;
  atrPctMin: number;     // skip if atr_pct < this (squeeze)
  slAtrMult: number;
  tp1R: number;
  tp2R: number;
  riskPct: number;
}

export const DEFAULT_DONCHIAN: DonchianParams = {
  adxMin: 20,
  atrPctMin: 0.4,
  slAtrMult: 1.5,
  tp1R: 1.5,
  tp2R: 4,
  riskPct: 0.6,
};

export function donchianBreakout(params: DonchianParams = DEFAULT_DONCHIAN): Strategy {
  return {
    name: `donchian-breakout(adx≥${params.adxMin}, atr%≥${params.atrPctMin}, ${params.tp1R}R/${params.tp2R}R, sl=${params.slAtrMult}×ATR)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (
        f.atr == null || f.atr_pct == null || f.adx == null ||
        f.bb_upper == null || f.bb_lower == null
      ) return { kind: 'hold' };

      if (f.adx < params.adxMin) return { kind: 'hold' };
      if (f.atr_pct < params.atrPctMin) return { kind: 'hold' };

      // Breakout above BB.upper proxy (close pushes new local high)
      if (ctx.price > f.bb_upper && f.ema_stack_aligned !== 'bear') {
        const sl = ctx.price - params.slAtrMult * f.atr;
        const stopDist = ctx.price - sl;
        return {
          kind: 'enter', side: 'long', orderType: 'market',
          entryPrice: ctx.price, sl,
          tp1: ctx.price + params.tp1R * stopDist,
          tp2: ctx.price + params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `donchian-breakout LONG: close ${ctx.price.toFixed(2)} > BB.upper ${f.bb_upper.toFixed(2)}, ADX ${f.adx.toFixed(1)}, ATR% ${f.atr_pct.toFixed(2)}`,
        };
      }
      if (ctx.price < f.bb_lower && f.ema_stack_aligned !== 'bull') {
        const sl = ctx.price + params.slAtrMult * f.atr;
        const stopDist = sl - ctx.price;
        return {
          kind: 'enter', side: 'short', orderType: 'market',
          entryPrice: ctx.price, sl,
          tp1: ctx.price - params.tp1R * stopDist,
          tp2: ctx.price - params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `donchian-breakout SHORT: close ${ctx.price.toFixed(2)} < BB.lower ${f.bb_lower.toFixed(2)}, ADX ${f.adx.toFixed(1)}, ATR% ${f.atr_pct.toFixed(2)}`,
        };
      }
      return { kind: 'hold' };
    },
  };
}
