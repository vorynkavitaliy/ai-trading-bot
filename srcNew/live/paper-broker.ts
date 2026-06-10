import { simulateExit, simulateLimitFill } from '../backtest/execution-sim';
import { Candle } from '../data/types';
import { LivePortfolioConfig } from './config';
import { ClosedPaperTrade, PaperOrder, PaperPosition, PaperState } from './state';

const MINUTE_MS = 60_000;
const SL_SLIPPAGE_BPS = 2;

export interface BrokerEvent {
  kind: 'fill' | 'exit' | 'expire';
  pair: string;
  detail: string;
  trade?: ClosedPaperTrade;
}

function buildClosedTrade(
  position: PaperPosition,
  exitPrice: number,
  exitReason: string,
  exitTs: number,
  config: LivePortfolioConfig,
): ClosedPaperTrade {
  const riskPerUnit = Math.abs(position.limitPrice - position.slPrice);
  const direction = position.side === 'long' ? 1 : -1;
  const grossR = (direction * (exitPrice - position.entryPrice)) / riskPerUnit;

  const entryFeeRate = position.entryIsTaker ? config.takerFee : config.makerFee;
  const exitFeeRate = exitReason === 'tp' ? config.makerFee : config.takerFee;
  const feesR = (entryFeeRate * position.entryPrice + exitFeeRate * exitPrice) / riskPerUnit;

  const netR = grossR - feesR;
  return {
    ...position,
    exitTs,
    exitPrice,
    exitReason,
    netR,
    pnlPct: netR * position.riskPctPerTrade,
  };
}

function ceilToMinute(ts: number): number {
  return Math.ceil(ts / MINUTE_MS) * MINUTE_MS;
}

export function processMinutes(
  state: PaperState,
  pair: string,
  minutes: readonly Candle[],
  config: LivePortfolioConfig,
): BrokerEvent[] {
  const events: BrokerEvent[] = [];

  for (const minute of minutes) {
    const order = state.orders.find(o => o.pair === pair);
    if (order && minute.ts >= order.expiresTs) {
      state.orders = state.orders.filter(o => o !== order);
      events.push({ kind: 'expire', pair, detail: `лимитный ордер ${order.side} @${order.limitPrice.toFixed(2)} истёк без входа` });
    }

    const activeOrder = state.orders.find(o => o.pair === pair && minute.ts >= ceilToMinute(o.placedTs));
    if (activeOrder) {
      const isActivationBar = minute.ts === ceilToMinute(activeOrder.placedTs);
      const fill = simulateLimitFill(
        { side: activeOrder.side, limitPrice: activeOrder.limitPrice },
        minute,
        isActivationBar,
        true,
      );
      if (fill !== null) {
        state.orders = state.orders.filter(o => o !== activeOrder);
        const position: PaperPosition = {
          pair,
          side: activeOrder.side,
          entryTs: minute.ts,
          entryPrice: fill.price,
          entryIsTaker: fill.isTaker,
          limitPrice: activeOrder.limitPrice,
          slPrice: activeOrder.slPrice,
          tpPrice: activeOrder.tpPrice,
          placedTs: activeOrder.placedTs,
          maxHoldUntilTs: activeOrder.maxHoldUntilTs,
          riskPctPerTrade: activeOrder.riskPctPerTrade,
          tag: activeOrder.tag,
        };
        state.positions.push(position);
        events.push({
          kind: 'fill',
          pair,
          detail: `вход ${position.side === 'long' ? 'BUY/LONG' : 'SELL/SHORT'} @${fill.price.toFixed(2)} (${fill.isTaker ? 'taker' : 'maker'})`,
        });

        tryExit(state, position, minute, true, config, events);
        continue;
      }
    }

    const position = state.positions.find(p => p.pair === pair);
    if (position && minute.ts > position.entryTs) {
      const exited = tryExit(state, position, minute, false, config, events);
      if (!exited && minute.ts + MINUTE_MS >= position.maxHoldUntilTs) {
        closePosition(state, position, minute.close, 'time', minute.ts, config, events);
      }
    }
  }

  return events;
}

function tryExit(
  state: PaperState,
  position: PaperPosition,
  minute: Candle,
  isFillBar: boolean,
  config: LivePortfolioConfig,
  events: BrokerEvent[],
): boolean {
  const exit = simulateExit(
    { side: position.side, slPrice: position.slPrice, tpPrice: position.tpPrice, entryPrice: position.entryPrice },
    minute,
    SL_SLIPPAGE_BPS,
    true,
    isFillBar,
  );
  if (exit === null) return false;
  closePosition(state, position, exit.price, exit.reason, minute.ts, config, events);
  return true;
}

function closePosition(
  state: PaperState,
  position: PaperPosition,
  exitPrice: number,
  reason: string,
  exitTs: number,
  config: LivePortfolioConfig,
  events: BrokerEvent[],
): void {
  const trade = buildClosedTrade(position, exitPrice, reason, exitTs, config);
  state.positions = state.positions.filter(p => p !== position);
  state.closedTrades.push(trade);
  state.equity *= 1 + trade.pnlPct / 100;

  const cooldown = reason === 'sl' ? config.cooldownAfterSlMs : config.cooldownAfterTpMs;
  state.cooldownUntilTs[position.pair] = exitTs + cooldown;

  const reasonLabel = reason === 'sl' ? 'стоп' : reason === 'tp' ? 'тейк' : 'время';
  events.push({
    kind: 'exit',
    pair: position.pair,
    detail: `выход (${reasonLabel}) @${exitPrice.toFixed(2)}, результат ${trade.netR >= 0 ? '+' : ''}${trade.netR.toFixed(2)}R (${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%)`,
    trade,
  });
}

export function occupiedSlots(state: PaperState): number {
  return state.orders.length + state.positions.length;
}

export function placeOrder(state: PaperState, order: PaperOrder): void {
  state.orders.push(order);
}
