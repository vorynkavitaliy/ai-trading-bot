import { atr, ema, highest, lowest, rsi } from '../backtest/indicators';
import { OrderIntent, Side, Strategy, StrategyContext } from '../backtest/types';

const HOUR_MS = 3_600_000;

export interface RsiDipParams {
  rsiWindow: number;
  rsiLow: number;
  rsiHigh: number;
  trendEma: number;
  entryOffsetAtr: number;
  slAtrMult: number;
  tpAtrMult: number;
  ttlMinutes: number;
}

export function rsiDip(overrides: Partial<RsiDipParams> = {}): Strategy {
  const params: RsiDipParams = {
    rsiWindow: 2,
    rsiLow: 10,
    rsiHigh: 90,
    trendEma: 200,
    entryOffsetAtr: 0.15,
    slAtrMult: 1.5,
    tpAtrMult: 2.0,
    ttlMinutes: 55,
    ...overrides,
  };
  const id = `rsiDip(${params.rsiWindow},${params.rsiLow}/${params.rsiHigh},ema${params.trendEma})`;

  return {
    id,
    decisionIntervalMs: HOUR_MS,
    warmupBars: params.trendEma + 10,

    decide(ctx: StrategyContext): OrderIntent | null {
      const closes = ctx.bars.map(b => b.close);
      const rsiValue = rsi(closes, params.rsiWindow);
      const trend = ema(closes, params.trendEma);
      const atrValue = atr(ctx.bars, 14);
      if (rsiValue === null || trend === null || atrValue === null || atrValue <= 0) return null;

      const price = ctx.lastPrice;
      let side: Side;
      if (rsiValue <= params.rsiLow && price > trend) side = 'long';
      else if (rsiValue >= params.rsiHigh && price < trend) side = 'short';
      else return null;

      const offset = params.entryOffsetAtr * atrValue;
      const limitPrice = side === 'long' ? price - offset : price + offset;
      const slPrice = side === 'long' ? limitPrice - params.slAtrMult * atrValue : limitPrice + params.slAtrMult * atrValue;
      const tpPrice = side === 'long' ? limitPrice + params.tpAtrMult * atrValue : limitPrice - params.tpAtrMult * atrValue;

      return { side, limitPrice, slPrice, tpPrice, ttlMinutes: params.ttlMinutes, tag: id };
    },
  };
}

export interface DonchianRetestParams {
  channelBars: number;
  entryOffsetAtr: number;
  slAtrMult: number;
  tpAtrMult: number;
  ttlMinutes: number;
}

export function donchianRetest(overrides: Partial<DonchianRetestParams> = {}): Strategy {
  const params: DonchianRetestParams = {
    channelBars: 48,
    entryOffsetAtr: 0.3,
    slAtrMult: 1.5,
    tpAtrMult: 3.0,
    ttlMinutes: 110,
    ...overrides,
  };
  const id = `donchianRetest(${params.channelBars})`;

  return {
    id,
    decisionIntervalMs: HOUR_MS,
    warmupBars: params.channelBars + 10,

    decide(ctx: StrategyContext): OrderIntent | null {
      const bars = ctx.bars;
      const prior = bars.slice(0, -1);
      const lastBar = bars[bars.length - 1];

      const highs = prior.map(b => b.high);
      const lows = prior.map(b => b.low);
      const upper = highest(highs, params.channelBars);
      const lower = lowest(lows, params.channelBars);
      const atrValue = atr(bars, 14);
      if (upper === null || lower === null || atrValue === null || atrValue <= 0) return null;

      let side: Side;
      let breakLevel: number;
      if (lastBar.close > upper) {
        side = 'long';
        breakLevel = upper;
      } else if (lastBar.close < lower) {
        side = 'short';
        breakLevel = lower;
      } else {
        return null;
      }

      const offset = params.entryOffsetAtr * atrValue;
      const limitPrice = side === 'long' ? Math.max(breakLevel, ctx.lastPrice - offset) : Math.min(breakLevel, ctx.lastPrice + offset);
      const slPrice = side === 'long' ? limitPrice - params.slAtrMult * atrValue : limitPrice + params.slAtrMult * atrValue;
      const tpPrice = side === 'long' ? limitPrice + params.tpAtrMult * atrValue : limitPrice - params.tpAtrMult * atrValue;

      return { side, limitPrice, slPrice, tpPrice, ttlMinutes: params.ttlMinutes, tag: id };
    },
  };
}
