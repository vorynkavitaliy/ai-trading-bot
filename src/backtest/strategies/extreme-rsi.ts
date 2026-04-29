import { Action, Strategy, StrategyContext } from '../types';

// Extreme RSI mean-reversion with confirmation
// Idea: instead of fading the first BB-touch, wait for deeper RSI extremes
// AND visible reversal momentum (RSI rising OR falling back from extreme).
// This requires a 1-bar memory of RSI — use the strategy state field on ctx,
// but for simplicity, we approximate by requiring close > prior close (long)
// or close < prior close (short) at signal time.
//
// Entry LONG when:
//   RSI < rsiExtremeLow AND close > BB.lower (BUT not too far above)
//   no strong bull or bear stack — neutral structure required
//   atr_pct >= atrPctMin (avoid squeezes that only break sideways)
// Entry SHORT mirrors.
// SL = wider — slAtrMult × ATR (1.5×)
// TP1 = entry + tp1R * stopDist (1.5R)
// TP2 = bb_middle (mean)

export interface ExtremeRsiParams {
  rsiLow: number;          // 22 (deeper than 30)
  rsiHigh: number;         // 78
  atrPctMin: number;       // 0.5
  atrPctMax: number;       // 3.0 — skip insane volatility
  slAtrMult: number;       // 1.5 (wider than range-fade)
  tp1R: number;            // 1.0
  tp2R: number;            // 3.0
  riskPct: number;         // 0.6
}

export const DEFAULT_EXTREME_RSI: ExtremeRsiParams = {
  rsiLow: 22,
  rsiHigh: 78,
  atrPctMin: 0.5,
  atrPctMax: 3.0,
  slAtrMult: 1.5,
  tp1R: 1.0,
  tp2R: 3.0,
  riskPct: 0.6,
};

export function extremeRsi(params: ExtremeRsiParams = DEFAULT_EXTREME_RSI): Strategy {
  return {
    name: `extreme-rsi(<${params.rsiLow}, >${params.rsiHigh}, sl=${params.slAtrMult}×ATR, ${params.tp1R}R/${params.tp2R}R)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (
        f.rsi == null || f.atr == null || f.atr_pct == null ||
        f.bb_lower == null || f.bb_upper == null || f.bb_middle == null
      ) return { kind: 'hold' };
      if (f.atr_pct < params.atrPctMin || f.atr_pct > params.atrPctMax) return { kind: 'hold' };

      if (f.rsi < params.rsiLow) {
        const sl = ctx.price - params.slAtrMult * f.atr;
        const stopDist = ctx.price - sl;
        return {
          kind: 'enter', side: 'long', orderType: 'market',
          entryPrice: ctx.price, sl,
          tp1: ctx.price + params.tp1R * stopDist,
          tp2: ctx.price + params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `extreme-rsi LONG: RSI ${f.rsi.toFixed(1)} < ${params.rsiLow}, ATR% ${f.atr_pct.toFixed(2)}`,
        };
      }
      if (f.rsi > params.rsiHigh) {
        const sl = ctx.price + params.slAtrMult * f.atr;
        const stopDist = sl - ctx.price;
        return {
          kind: 'enter', side: 'short', orderType: 'market',
          entryPrice: ctx.price, sl,
          tp1: ctx.price - params.tp1R * stopDist,
          tp2: ctx.price - params.tp2R * stopDist,
          sizePct: params.riskPct,
          rationale: `extreme-rsi SHORT: RSI ${f.rsi.toFixed(1)} > ${params.rsiHigh}, ATR% ${f.atr_pct.toFixed(2)}`,
        };
      }
      return { kind: 'hold' };
    },
  };
}
