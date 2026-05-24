/**
 * Backtest constants shared across backtest CLI and diagnostics.
 *
 * Single source of truth for fees, slippage, equity. Previously every backtest
 * script hardcoded these — changing Bybit fee tiers required editing 15 files.
 */

import { tier1Pairs } from '../runtime/pair-strategies';

export const BACKTEST_COMMON = {
  /** Bybit perpetual taker fee — 0.055% (used for SL fills, market exits). */
  takerFeeRate: 0.00055,
  /** Bybit perpetual maker fee — 0.02% (used for limit entries and TP fills). */
  makerFeeRate: 0.0002,
  /** Slippage on market orders — 0.25% (entry/SL on market trigger). */
  slippagePct: 0.25,
  /** Starting equity for portfolio backtests (USDT). */
  startEquity: 50_000,
} as const;

/** Universe of pairs that pass walk-forward and run live. Derived from pair-strategies. */
export const TIER1_SYMBOLS = tier1Pairs();
