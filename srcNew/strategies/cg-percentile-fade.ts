import { CG } from '../backtest/dataset';
import { atr, ema, percentileRank } from '../backtest/indicators';
import { OrderIntent, Side, Strategy, StrategyContext } from '../backtest/types';

const HOUR_MS = 3_600_000;

export interface PercentileFadeParams {
  series: string;
  field: string;
  windowBars: number;
  pctHi: number;
  pctLo: number;
  trendFilter: 'none' | 'with' | 'against';
  entryOffsetAtr: number;
  slAtrMult: number;
  tpAtrMult: number;
  ttlMinutes: number;
  atrWindow: number;
}

export function percentileFade(id: string, params: PercentileFadeParams): Strategy {
  return {
    id,
    decisionIntervalMs: HOUR_MS,
    warmupBars: Math.max(params.windowBars, 60) + 5,

    decide(ctx: StrategyContext): OrderIntent | null {
      const history = ctx.cg.valueHistory(params.series, params.field, params.windowBars + 1);
      if (history.length < params.windowBars) return null;

      const current = history[history.length - 1];
      const lookback = history.slice(0, -1);
      const pct = percentileRank(lookback, current);
      if (pct === null) return null;

      let side: Side;
      if (pct >= params.pctHi) side = 'short';
      else if (pct <= params.pctLo) side = 'long';
      else return null;

      if (params.trendFilter !== 'none') {
        const closes = ctx.bars.map(b => b.close);
        const fast = ema(closes, 20);
        const slow = ema(closes, 50);
        if (fast === null || slow === null) return null;
        const uptrend = fast > slow;
        const aligned = side === 'long' ? uptrend : !uptrend;
        if (params.trendFilter === 'with' && !aligned) return null;
        if (params.trendFilter === 'against' && aligned) return null;
      }

      const atrValue = atr(ctx.bars, params.atrWindow);
      if (atrValue === null || atrValue <= 0) return null;

      const price = ctx.lastPrice;
      const offset = params.entryOffsetAtr * atrValue;
      const limitPrice = side === 'long' ? price - offset : price + offset;
      const slPrice = side === 'long' ? limitPrice - params.slAtrMult * atrValue : limitPrice + params.slAtrMult * atrValue;
      const tpPrice = side === 'long' ? limitPrice + params.tpAtrMult * atrValue : limitPrice - params.tpAtrMult * atrValue;

      return { side, limitPrice, slPrice, tpPrice, ttlMinutes: params.ttlMinutes, tag: id };
    },
  };
}

export function lsTopPositionFade(overrides: Partial<PercentileFadeParams> = {}): Strategy {
  const params: PercentileFadeParams = {
    series: CG.lsTopPosition,
    field: 'ratio',
    windowBars: 720,
    pctHi: 0.9,
    pctLo: 0.1,
    trendFilter: 'with',
    entryOffsetAtr: 0.15,
    slAtrMult: 1.5,
    tpAtrMult: 2.0,
    ttlMinutes: 55,
    atrWindow: 14,
    ...overrides,
  };
  return percentileFade(
    `lsTopPosFade(w${params.windowBars},${params.pctHi}/${params.pctLo},${params.trendFilter},sl${params.slAtrMult},tp${params.tpAtrMult})`,
    params,
  );
}

export function fundingFade(overrides: Partial<PercentileFadeParams> = {}): Strategy {
  const params: PercentileFadeParams = {
    series: CG.funding,
    field: 'close',
    windowBars: 720,
    pctHi: 0.9,
    pctLo: 0.1,
    trendFilter: 'with',
    entryOffsetAtr: 0.15,
    slAtrMult: 1.5,
    tpAtrMult: 2.0,
    ttlMinutes: 55,
    atrWindow: 14,
    ...overrides,
  };
  return percentileFade(
    `fundingFade(w${params.windowBars},${params.pctHi}/${params.pctLo},${params.trendFilter},sl${params.slAtrMult},tp${params.tpAtrMult})`,
    params,
  );
}
