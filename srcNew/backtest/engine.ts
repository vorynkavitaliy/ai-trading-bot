import { Candle } from '../data/types';
import { aggregateCandles } from './aggregate';
import { CgView } from './cg-view';
import {
  BacktestConfig,
  BacktestResult,
  ExitReason,
  OrderIntent,
  Strategy,
  Trade,
} from './types';

const MINUTE_MS = 60_000;
const FUNDING_INTERVAL_MS = 8 * 3_600_000;

interface PendingOrder {
  intent: OrderIntent;
  placedTs: number;
  activeFromTs: number;
  expiresTs: number;
}

interface OpenPosition {
  intent: OrderIntent;
  placedTs: number;
  entryTs: number;
  entryPrice: number;
  entryIsTaker: boolean;
  maxHoldUntilTs: number;
  fundingR: number;
}

export interface EngineInput {
  strategy: Strategy;
  minuteCandles: readonly Candle[];
  cg: CgView;
  config: BacktestConfig;
  fundingRateProvider?: (ts: number) => number | null;
  auxMinutes?: readonly Candle[];
}

export function runBacktest(input: EngineInput): BacktestResult {
  const { strategy, minuteCandles, cg, config } = input;
  const bucketMs = strategy.decisionIntervalMs;

  const decisionBars = aggregateCandles(minuteCandles, bucketMs);
  const auxBarsAll = input.auxMinutes ? aggregateCandles(input.auxMinutes, bucketMs) : null;
  const trades: Trade[] = [];

  let pending: PendingOrder | null = null;
  let position: OpenPosition | null = null;
  let placedOrders = 0;
  let filledOrders = 0;
  let decisions = 0;

  let nextDecisionIdx = strategy.warmupBars;

  const closedBarsView: Candle[] = decisionBars.slice(0, 0);
  const auxClosedView: Candle[] = [];
  let auxIdx = 0;

  for (let minuteIdx = 0; minuteIdx < minuteCandles.length; minuteIdx++) {
    const minute = minuteCandles[minuteIdx];

    if (pending !== null && minute.ts >= pending.expiresTs) {
      pending = null;
    }

    while (
      nextDecisionIdx < decisionBars.length &&
      minute.ts >= decisionBars[nextDecisionIdx].ts + bucketMs + config.gapMs
    ) {
      const decisionTs = decisionBars[nextDecisionIdx].ts + bucketMs + config.gapMs;

      if (position === null && pending === null) {
        while (closedBarsView.length <= nextDecisionIdx) {
          closedBarsView.push(decisionBars[closedBarsView.length]);
        }
        cg.setCursor(decisionTs);

        if (auxBarsAll !== null) {
          while (auxIdx < auxBarsAll.length && auxBarsAll[auxIdx].ts + bucketMs <= decisionTs) {
            auxClosedView.push(auxBarsAll[auxIdx]);
            auxIdx++;
          }
        }

        const lastClosedMinute = lastMinuteCloseAt(minuteCandles, minuteIdx, decisionTs);
        const intent = strategy.decide({
          decisionTs,
          bars: closedBarsView,
          lastPrice: lastClosedMinute,
          cg,
          auxBars: auxBarsAll !== null ? auxClosedView : undefined,
        });
        decisions++;

        if (intent !== null && isValidIntent(intent)) {
          pending = {
            intent,
            placedTs: decisionTs,
            activeFromTs: decisionTs,
            expiresTs: decisionTs + intent.ttlMinutes * MINUTE_MS,
          };
          placedOrders++;
        }
      }

      nextDecisionIdx++;
    }

    if (pending !== null && minute.ts >= pending.activeFromTs) {
      const fill = tryFillLimit(pending, minute, config.strictTouch);
      if (fill !== null) {
        filledOrders++;
        position = {
          intent: pending.intent,
          placedTs: pending.placedTs,
          entryTs: minute.ts,
          entryPrice: fill.price,
          entryIsTaker: fill.isTaker,
          maxHoldUntilTs: pending.placedTs + config.maxHoldDecisionBars * bucketMs,
          fundingR: 0,
        };
        pending = null;

        const exit = checkExit(position, minute, config, true);
        if (exit !== null) {
          trades.push(buildTrade(position, exit.price, exit.reason, minute.ts, config));
          position = null;
        }
      }
    } else if (position !== null) {
      if (config.applyFunding && input.fundingRateProvider && minute.ts % FUNDING_INTERVAL_MS === 0) {
        const rate = input.fundingRateProvider(minute.ts);
        if (rate !== null) {
          const riskPerUnit = riskPerUnitOf(position);
          const sign = position.intent.side === 'long' ? -1 : 1;
          position.fundingR += (sign * rate * position.entryPrice) / riskPerUnit;
        }
      }

      const exit = checkExit(position, minute, config, false);
      if (exit !== null) {
        trades.push(buildTrade(position, exit.price, exit.reason, minute.ts, config));
        position = null;
      } else if (minute.ts + MINUTE_MS >= position.maxHoldUntilTs) {
        trades.push(buildTrade(position, minute.close, 'time', minute.ts, config));
        position = null;
      }
    }
  }

  if (position !== null) {
    const last = minuteCandles[minuteCandles.length - 1];
    trades.push(buildTrade(position, last.close, 'eod', last.ts, config));
  }

  return {
    strategyId: strategy.id,
    fromTs: minuteCandles[0]?.ts ?? 0,
    toTs: minuteCandles[minuteCandles.length - 1]?.ts ?? 0,
    trades,
    placedOrders,
    filledOrders,
    decisions,
  };
}

function lastMinuteCloseAt(minutes: readonly Candle[], currentIdx: number, decisionTs: number): number {
  for (let i = currentIdx; i >= 0; i--) {
    if (minutes[i].ts + MINUTE_MS <= decisionTs) return minutes[i].close;
  }
  return minutes[0].open;
}

function isValidIntent(intent: OrderIntent): boolean {
  if (intent.side === 'long') {
    return intent.slPrice < intent.limitPrice && intent.limitPrice < intent.tpPrice;
  }
  return intent.tpPrice < intent.limitPrice && intent.limitPrice < intent.slPrice;
}

interface FillEvent {
  price: number;
  isTaker: boolean;
}

// A resting limit never fills better than its own price. The only marketable case is
// the activation minute: the market may have crossed the limit during the 60s gap,
// then the order executes immediately near the open as a taker.
function tryFillLimit(pending: PendingOrder, minute: Candle, strictTouch: boolean): FillEvent | null {
  const { intent, activeFromTs } = pending;
  const isActivationBar = minute.ts === activeFromTs;

  if (intent.side === 'long') {
    if (minute.open <= intent.limitPrice) {
      return isActivationBar
        ? { price: minute.open, isTaker: true }
        : { price: intent.limitPrice, isTaker: false };
    }
    const touched = strictTouch ? minute.low < intent.limitPrice : minute.low <= intent.limitPrice;
    return touched ? { price: intent.limitPrice, isTaker: false } : null;
  }

  if (minute.open >= intent.limitPrice) {
    return isActivationBar
      ? { price: minute.open, isTaker: true }
      : { price: intent.limitPrice, isTaker: false };
  }
  const touched = strictTouch ? minute.high > intent.limitPrice : minute.high >= intent.limitPrice;
  return touched ? { price: intent.limitPrice, isTaker: false } : null;
}

interface ExitEvent {
  price: number;
  reason: ExitReason;
}

// Worst-case ordering: when both SL and TP are inside one minute bar, SL wins.
// A fill already at/through the SL (gap during the entry gap window) exits as a
// scratch from the actual entry price — never as a phantom profit from slPrice.
function checkExit(
  position: OpenPosition,
  minute: Candle,
  config: BacktestConfig,
  isFillBar: boolean,
): ExitEvent | null {
  const { side, slPrice, tpPrice } = position.intent;
  const slip = config.slSlippageBps / 10_000;

  if (side === 'long') {
    if (minute.low <= slPrice) {
      const stopBase = isFillBar ? Math.min(slPrice, position.entryPrice) : slPrice;
      return { price: stopBase * (1 - slip), reason: 'sl' };
    }
    const tpTouched = config.strictTouch ? minute.high > tpPrice : minute.high >= tpPrice;
    if (tpTouched && !isFillBar) return { price: tpPrice, reason: 'tp' };
    if (tpTouched && isFillBar && minute.close > tpPrice) return { price: tpPrice, reason: 'tp' };
    return null;
  }

  if (minute.high >= slPrice) {
    const stopBase = isFillBar ? Math.max(slPrice, position.entryPrice) : slPrice;
    return { price: stopBase * (1 + slip), reason: 'sl' };
  }
  const tpTouched = config.strictTouch ? minute.low < tpPrice : minute.low <= tpPrice;
  if (tpTouched && !isFillBar) return { price: tpPrice, reason: 'tp' };
  if (tpTouched && isFillBar && minute.close < tpPrice) return { price: tpPrice, reason: 'tp' };
  return null;
}

// Sizing happens at order placement, off the limit price — R is anchored there too.
function riskPerUnitOf(position: OpenPosition): number {
  return Math.abs(position.intent.limitPrice - position.intent.slPrice);
}

function buildTrade(
  position: OpenPosition,
  exitPrice: number,
  reason: ExitReason,
  exitTs: number,
  config: BacktestConfig,
): Trade {
  const { intent, entryPrice, entryTs, placedTs, fundingR, entryIsTaker } = position;
  const riskPerUnit = riskPerUnitOf(position);

  const direction = intent.side === 'long' ? 1 : -1;
  const grossR = (direction * (exitPrice - entryPrice)) / riskPerUnit;

  const entryFeeRate = entryIsTaker ? config.takerFee : config.makerFee;
  const entryFee = entryFeeRate * entryPrice;
  const exitFeeRate = reason === 'tp' ? config.makerFee : config.takerFee;
  const exitFee = exitFeeRate * exitPrice;
  const feesR = (entryFee + exitFee) / riskPerUnit;

  return {
    tag: intent.tag,
    side: intent.side,
    placedTs,
    entryTs,
    exitTs,
    entryPrice,
    exitPrice,
    slPrice: intent.slPrice,
    tpPrice: intent.tpPrice,
    exitReason: reason,
    grossR,
    feesR,
    fundingR,
    netR: grossR - feesR + fundingR,
    holdMinutes: Math.round((exitTs - entryTs) / MINUTE_MS),
  };
}
