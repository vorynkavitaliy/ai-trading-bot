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
  /**
   * Per-symbol exchange max single-order quantity (BNB=370, etc.).
   * Use min(maxOrderQty, maxMktOrderQty) to be safe across order types.
   * sizing.ts clamps qty to this; without it, large accounts get exchange rejects
   * (caused 2026-04-25 BNB partial-fill bug — 50k filled, 200k rejected at 370).
   */
  maxQty?: number;
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
