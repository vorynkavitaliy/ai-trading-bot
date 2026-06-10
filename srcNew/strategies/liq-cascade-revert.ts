import { CG } from '../backtest/dataset';
import { atr, percentileRank } from '../backtest/indicators';
import { OrderIntent, Side, Strategy, StrategyContext } from '../backtest/types';

const HOUR_MS = 3_600_000;

export interface LiqCascadeParams {
  windowBars: number;
  spikePct: number;
  entryOffsetAtr: number;
  slAtrMult: number;
  tpAtrMult: number;
  ttlMinutes: number;
  atrWindow: number;
  requireBarDirection: boolean;
}

export function liqCascadeRevert(overrides: Partial<LiqCascadeParams> = {}): Strategy {
  const params: LiqCascadeParams = {
    windowBars: 720,
    spikePct: 0.97,
    entryOffsetAtr: 0.25,
    slAtrMult: 1.5,
    tpAtrMult: 2.0,
    ttlMinutes: 55,
    atrWindow: 14,
    requireBarDirection: true,
    ...overrides,
  };
  const id = `liqCascade(w${params.windowBars},p${params.spikePct})`;

  return {
    id,
    decisionIntervalMs: HOUR_MS,
    warmupBars: Math.max(params.windowBars, 60) + 5,

    decide(ctx: StrategyContext): OrderIntent | null {
      const longLiq = ctx.cg.valueHistory(CG.liq, 'longLiqUsd', params.windowBars + 1);
      const shortLiq = ctx.cg.valueHistory(CG.liq, 'shortLiqUsd', params.windowBars + 1);
      if (longLiq.length < params.windowBars) return null;

      const curLong = longLiq[longLiq.length - 1];
      const curShort = shortLiq[shortLiq.length - 1];
      const longPct = percentileRank(longLiq.slice(0, -1), curLong);
      const shortPct = percentileRank(shortLiq.slice(0, -1), curShort);
      if (longPct === null || shortPct === null) return null;

      const lastBar = ctx.bars[ctx.bars.length - 1];

      let side: Side;
      if (longPct >= params.spikePct && curLong > curShort) {
        if (params.requireBarDirection && lastBar.close >= lastBar.open) return null;
        side = 'long';
      } else if (shortPct >= params.spikePct && curShort > curLong) {
        if (params.requireBarDirection && lastBar.close <= lastBar.open) return null;
        side = 'short';
      } else {
        return null;
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
