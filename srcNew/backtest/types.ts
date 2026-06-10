import { Candle } from '../data/types';
import { CgView } from './cg-view';

export type Side = 'long' | 'short';

export interface OrderIntent {
  side: Side;
  limitPrice: number;
  slPrice: number;
  tpPrice: number;
  ttlMinutes: number;
  tag?: string;
}

export interface StrategyContext {
  decisionTs: number;
  bars: readonly Candle[];
  lastPrice: number;
  cg: CgView;
}

export interface Strategy {
  readonly id: string;
  readonly decisionIntervalMs: number;
  readonly warmupBars: number;
  decide(ctx: StrategyContext): OrderIntent | null;
}

export type ExitReason = 'sl' | 'tp' | 'time' | 'eod';

export interface Trade {
  tag?: string;
  side: Side;
  placedTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  slPrice: number;
  tpPrice: number;
  exitReason: ExitReason;
  grossR: number;
  feesR: number;
  fundingR: number;
  netR: number;
  holdMinutes: number;
}

export interface BacktestConfig {
  gapMs: number;
  cgPublishLagMs: number;
  makerFee: number;
  takerFee: number;
  slSlippageBps: number;
  strictTouch: boolean;
  maxHoldDecisionBars: number;
  applyFunding: boolean;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  gapMs: 60_000,
  cgPublishLagMs: 120_000,
  makerFee: 0.0002,
  takerFee: 0.00055,
  slSlippageBps: 2,
  strictTouch: true,
  maxHoldDecisionBars: 24,
  applyFunding: true,
};

export interface BacktestResult {
  strategyId: string;
  fromTs: number;
  toTs: number;
  trades: Trade[];
  placedOrders: number;
  filledOrders: number;
  decisions: number;
}
