import { Candle } from '../data/types';
import { ExitReason, OrderIntent } from './types';

export interface FillResult {
  price: number;
  isTaker: boolean;
}

export interface ExitResult {
  price: number;
  reason: ExitReason;
}

export interface ExitParams {
  side: OrderIntent['side'];
  slPrice: number;
  tpPrice: number;
  entryPrice: number;
}

export function isValidIntent(intent: OrderIntent): boolean {
  if (intent.side === 'long') {
    return intent.slPrice < intent.limitPrice && intent.limitPrice < intent.tpPrice;
  }
  return intent.tpPrice < intent.limitPrice && intent.limitPrice < intent.slPrice;
}

// A resting limit never fills better than its own price. The only marketable case is
// the activation minute: the market may have crossed the limit during the gap window,
// then the order executes immediately near the open as a taker.
export function simulateLimitFill(
  intent: Pick<OrderIntent, 'side' | 'limitPrice'>,
  minute: Candle,
  isActivationBar: boolean,
  strictTouch: boolean,
): FillResult | null {
  if (intent.side === 'long') {
    if (minute.open <= intent.limitPrice) {
      return isActivationBar ? { price: minute.open, isTaker: true } : { price: intent.limitPrice, isTaker: false };
    }
    const touched = strictTouch ? minute.low < intent.limitPrice : minute.low <= intent.limitPrice;
    return touched ? { price: intent.limitPrice, isTaker: false } : null;
  }

  if (minute.open >= intent.limitPrice) {
    return isActivationBar ? { price: minute.open, isTaker: true } : { price: intent.limitPrice, isTaker: false };
  }
  const touched = strictTouch ? minute.high > intent.limitPrice : minute.high >= intent.limitPrice;
  return touched ? { price: intent.limitPrice, isTaker: false } : null;
}

// Worst-case ordering: when both SL and TP are inside one minute bar, SL wins.
// A fill already at/through the SL (gap during the entry window) exits as a
// scratch from the actual entry price — never as a phantom profit from slPrice.
export function simulateExit(
  params: ExitParams,
  minute: Candle,
  slSlippageBps: number,
  strictTouch: boolean,
  isFillBar: boolean,
): ExitResult | null {
  const { side, slPrice, tpPrice, entryPrice } = params;
  const slip = slSlippageBps / 10_000;

  if (side === 'long') {
    if (minute.low <= slPrice) {
      const stopBase = isFillBar ? Math.min(slPrice, entryPrice) : slPrice;
      return { price: stopBase * (1 - slip), reason: 'sl' };
    }
    const tpTouched = strictTouch ? minute.high > tpPrice : minute.high >= tpPrice;
    if (tpTouched && !isFillBar) return { price: tpPrice, reason: 'tp' };
    if (tpTouched && isFillBar && minute.close > tpPrice) return { price: tpPrice, reason: 'tp' };
    return null;
  }

  if (minute.high >= slPrice) {
    const stopBase = isFillBar ? Math.max(slPrice, entryPrice) : slPrice;
    return { price: stopBase * (1 + slip), reason: 'sl' };
  }
  const tpTouched = strictTouch ? minute.low < tpPrice : minute.low <= tpPrice;
  if (tpTouched && !isFillBar) return { price: tpPrice, reason: 'tp' };
  if (tpTouched && isFillBar && minute.close < tpPrice) return { price: tpPrice, reason: 'tp' };
  return null;
}
