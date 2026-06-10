import { cgSlowFade } from '../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../strategies/cg-slow-fade-btc';
import { Strategy } from '../backtest/types';

const HOUR_MS = 3_600_000;

export interface LivePairConfig {
  readonly coin: string;
  readonly pair: string;
  readonly riskPctPerTrade: number;
  readonly usesBtcContext: boolean;
  buildStrategy(): Strategy;
}

export interface LivePortfolioConfig {
  readonly pairs: readonly LivePairConfig[];
  readonly maxParallelPositions: number;
  readonly cooldownAfterSlMs: number;
  readonly cooldownAfterTpMs: number;
  readonly gapMs: number;
  readonly cgPublishLagMs: number;
  readonly decisionIntervalMs: number;
  readonly maxHoldDecisionBars: number;
  readonly makerFee: number;
  readonly takerFee: number;
  readonly referenceExchange: string;
  readonly pctWindowBars: number;
}

// Mirror of the validated backtest portfolio (commit 5761269):
// 4 pairs, BTC 1% / alts 0.5%, cap-4, CD 12h after SL / 4h after TP.
export const LIVE_PORTFOLIO: LivePortfolioConfig = {
  pairs: [
    {
      coin: 'BTC',
      pair: 'BTCUSDT',
      riskPctPerTrade: 1.0,
      usesBtcContext: false,
      buildStrategy: () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 }),
    },
    {
      coin: 'ETH',
      pair: 'ETHUSDT',
      riskPctPerTrade: 0.5,
      usesBtcContext: true,
      buildStrategy: () => cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true }),
    },
    {
      coin: 'SOL',
      pair: 'SOLUSDT',
      riskPctPerTrade: 0.5,
      usesBtcContext: true,
      buildStrategy: () => cgSlowFadeBtcAware({ btcMode: 'signal' }),
    },
    {
      coin: 'XRP',
      pair: 'XRPUSDT',
      riskPctPerTrade: 0.5,
      usesBtcContext: true,
      buildStrategy: () => cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true }),
    },
  ],
  maxParallelPositions: 4,
  cooldownAfterSlMs: 12 * HOUR_MS,
  cooldownAfterTpMs: 4 * HOUR_MS,
  gapMs: 60_000,
  cgPublishLagMs: 120_000,
  decisionIntervalMs: 4 * HOUR_MS,
  maxHoldDecisionBars: 12,
  makerFee: 0.0002,
  takerFee: 0.00055,
  referenceExchange: 'Binance',
  pctWindowBars: 180,
};
