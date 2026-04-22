/**
 * Trade types — pure data contracts for execute.ts and backtest.
 *
 * v1 had src/trade/planner.ts (auto-planning) and manager.ts (auto-trailing).
 * Under strategy-v2 Claude plans SL/TP per strategy.md rules; TypeScript
 * only executes. These types survive for the execution layer.
 */

export interface InstrumentSpec {
  symbol: string;
  tickSize: number;
  qtyStep: number;
  minQty: number;
  maxLeverage: number;
}

export interface TradePlan {
  symbol: string;
  direction: 'Long' | 'Short';
  entry: number;
  /** Limit entry price. Null = use market order. */
  limitEntry: number | null;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  atr: number;
  stopDistance: number;
  rationale: string;
}

import { decimalsOf } from '../risk/sizing';

export function fmtPrice(v: number, tickSize: number): string {
  return v.toFixed(decimalsOf(tickSize));
}
