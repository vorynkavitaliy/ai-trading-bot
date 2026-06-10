import { atr, percentileRank } from '../backtest/indicators';
import { OrderIntent, Side, Strategy, StrategyContext } from '../backtest/types';

const HOUR_MS = 3_600_000;

export interface SlowFadeParams {
  pctWindow: number;
  lsPctHi: number;
  lsPctLo: number;
  fundingPctHi: number;
  useLiqMomentum: boolean;
  liqSpikePct: number;
  entryOffsetAtr: number;
  slAtrMult: number;
  tpAtrMult: number;
  maxNote?: string;
}

function pctOf(ctx: StrategyContext, series: string, field: string, window: number): number | null {
  const history = ctx.cg.valueHistory(series, field, window + 1);
  if (history.length < window) return null;
  return percentileRank(history.slice(0, -1), history[history.length - 1]);
}

export function cgSlowFade(overrides: Partial<SlowFadeParams> = {}): Strategy {
  const params: SlowFadeParams = {
    pctWindow: 180,
    lsPctHi: 0.95,
    lsPctLo: 0.05,
    fundingPctHi: 0.95,
    useLiqMomentum: false,
    liqSpikePct: 0.97,
    entryOffsetAtr: 0.2,
    slAtrMult: 2.0,
    tpAtrMult: 3.5,
    ...overrides,
  };
  const id = `cgSlowFade(ls${params.lsPctHi}/${params.lsPctLo},f${params.fundingPctHi},liq=${params.useLiqMomentum ? params.liqSpikePct : 'off'},sl${params.slAtrMult},tp${params.tpAtrMult},off${params.entryOffsetAtr})`;

  return {
    id,
    decisionIntervalMs: 4 * HOUR_MS,
    warmupBars: params.pctWindow + 10,

    decide(ctx: StrategyContext): OrderIntent | null {
      const lsPct = pctOf(ctx, 'lsTopPosition', 'ratio', params.pctWindow);
      const fundingPct = pctOf(ctx, 'funding', 'close', params.pctWindow);
      if (lsPct === null || fundingPct === null) return null;

      let side: Side | null = null;
      if (lsPct >= params.lsPctHi || fundingPct >= params.fundingPctHi) side = 'short';
      else if (lsPct <= params.lsPctLo) side = 'long';

      if (side === null && params.useLiqMomentum) {
        const longLiq = ctx.cg.valueHistory('liq', 'longLiqUsd', params.pctWindow + 1);
        if (longLiq.length >= params.pctWindow) {
          const liqPct = percentileRank(longLiq.slice(0, -1), longLiq[longLiq.length - 1]);
          if (liqPct !== null && liqPct >= params.liqSpikePct) side = 'short';
        }
      }
      if (side === null) return null;

      const atrValue = atr(ctx.bars, 14);
      if (atrValue === null || atrValue <= 0) return null;

      const price = ctx.lastPrice;
      const offset = params.entryOffsetAtr * atrValue;
      const limitPrice = side === 'long' ? price - offset : price + offset;
      const slPrice = side === 'long' ? limitPrice - params.slAtrMult * atrValue : limitPrice + params.slAtrMult * atrValue;
      const tpPrice = side === 'long' ? limitPrice + params.tpAtrMult * atrValue : limitPrice - params.tpAtrMult * atrValue;

      return { side, limitPrice, slPrice, tpPrice, ttlMinutes: 230, tag: id };
    },
  };
}
