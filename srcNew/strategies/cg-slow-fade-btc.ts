import { atr, ema, percentileRank } from '../backtest/indicators';
import { OrderIntent, Side, Strategy, StrategyContext } from '../backtest/types';

const HOUR_MS = 3_600_000;

export type BtcMode = 'trend' | 'signal' | 'confluence';

export interface BtcAwareParams {
  btcMode: BtcMode;
  pctWindow: number;
  ownPctHi: number;
  ownPctLo: number;
  btcPctHi: number;
  btcPctLo: number;
  useLiqMomentum: boolean;
  liqSpikePct: number;
  entryOffsetAtr: number;
  slAtrMult: number;
  tpAtrMult: number;
  shortsOnly: boolean;
}

function pctOf(ctx: StrategyContext, series: string, field: string, window: number): number | null {
  const history = ctx.cg.valueHistory(series, field, window + 1);
  if (history.length < window) return null;
  return percentileRank(history.slice(0, -1), history[history.length - 1]);
}

function sideFromPcts(lsPct: number | null, fundingPct: number | null, hi: number, lo: number): Side | null {
  if (lsPct === null || fundingPct === null) return null;
  if (lsPct >= hi || fundingPct >= hi) return 'short';
  if (lsPct <= lo) return 'long';
  return null;
}

function btcTrendAllows(ctx: StrategyContext, side: Side): boolean {
  if (!ctx.auxBars || ctx.auxBars.length < 55) return false;
  const closes = ctx.auxBars.map(b => b.close);
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  if (fast === null || slow === null) return false;
  return side === 'long' ? fast > slow : fast < slow;
}

export function cgSlowFadeBtcAware(overrides: Partial<BtcAwareParams> = {}): Strategy {
  const params: BtcAwareParams = {
    btcMode: 'trend',
    pctWindow: 180,
    ownPctHi: 0.95,
    ownPctLo: 0.05,
    btcPctHi: 0.95,
    btcPctLo: 0.05,
    useLiqMomentum: true,
    liqSpikePct: 0.97,
    entryOffsetAtr: 0.3,
    slAtrMult: 2.0,
    tpAtrMult: 3.5,
    shortsOnly: false,
    ...overrides,
  };
  const id = `btcAware(${params.btcMode},own${params.ownPctHi},btc${params.btcPctHi}${params.shortsOnly ? ',S-only' : ''})`;

  return {
    id,
    decisionIntervalMs: 4 * HOUR_MS,
    warmupBars: params.pctWindow + 10,

    decide(ctx: StrategyContext): OrderIntent | null {
      const ownSide = sideFromPcts(
        pctOf(ctx, 'lsTopPosition', 'ratio', params.pctWindow),
        pctOf(ctx, 'funding', 'close', params.pctWindow),
        params.ownPctHi,
        params.ownPctLo,
      );
      const btcSide = sideFromPcts(
        pctOf(ctx, 'btcLsTopPosition', 'ratio', params.pctWindow),
        pctOf(ctx, 'btcFunding', 'close', params.pctWindow),
        params.btcPctHi,
        params.btcPctLo,
      );

      let side: Side | null = null;
      if (params.btcMode === 'trend') {
        side = ownSide;
        if (side !== null && !btcTrendAllows(ctx, side)) side = null;
      } else if (params.btcMode === 'signal') {
        side = btcSide;
      } else {
        side = ownSide !== null && ownSide === btcSide ? ownSide : null;
      }

      if (side === null && params.useLiqMomentum) {
        const longLiq = ctx.cg.valueHistory('liq', 'longLiqUsd', params.pctWindow + 1);
        if (longLiq.length >= params.pctWindow) {
          const liqPct = percentileRank(longLiq.slice(0, -1), longLiq[longLiq.length - 1]);
          if (liqPct !== null && liqPct >= params.liqSpikePct) side = 'short';
        }
      }

      if (side === null) return null;
      if (params.shortsOnly && side === 'long') return null;

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
