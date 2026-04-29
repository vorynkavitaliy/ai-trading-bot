import { Action, Strategy, StrategyContext } from '../types';
import { rangeFade, DEFAULT_RANGE_FADE, RangeFadeParams } from './range-fade';
import { trendPullback, DEFAULT_TREND_PULLBACK, TrendPullbackParams } from './trend-pullback';

// Combined strategy: regime-gated A or B based on ADX.
// ADX < adxRangeCutoff           → Playbook A (range fade)
// ADX >= adxTrendCutoff + EMA stack → Playbook B (trend pullback)
// otherwise (transition zone)    → SKIP

export interface CombinedParams {
  adxRangeCutoff: number;         // 22 — A active below this
  adxTrendCutoff: number;         // 25 — B active above this (with EMA stack)
  range: RangeFadeParams;
  trend: TrendPullbackParams;
}

export const DEFAULT_COMBINED: CombinedParams = {
  adxRangeCutoff: 22,
  adxTrendCutoff: 25,
  range: DEFAULT_RANGE_FADE,
  trend: DEFAULT_TREND_PULLBACK,
};

export function combined(params: CombinedParams = DEFAULT_COMBINED): Strategy {
  const a = rangeFade(params.range);
  const b = trendPullback(params.trend);
  return {
    name: `combined(adx<${params.adxRangeCutoff}→A, adx≥${params.adxTrendCutoff}→B)`,
    decide(ctx: StrategyContext): Action {
      const f = ctx.features1h;
      if (f.adx == null) return { kind: 'hold' };
      if (f.adx < params.adxRangeCutoff) return a.decide(ctx);
      if (f.adx >= params.adxTrendCutoff && f.ema_stack_aligned !== null) {
        return b.decide(ctx);
      }
      return { kind: 'hold' };
    },
  };
}
