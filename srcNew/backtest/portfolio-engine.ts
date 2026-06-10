import { Candle } from '../data/types';
import { aggregateCandles } from './aggregate';
import { CgView } from './cg-view';
import { isValidIntent, simulateExit, simulateLimitFill } from './execution-sim';
import { BacktestConfig, ExitReason, OrderIntent, Strategy, Trade } from './types';

const MINUTE_MS = 60_000;
const FUNDING_INTERVAL_MS = 8 * 3_600_000;

export interface PortfolioLegInput {
  pair: string;
  strategy: Strategy;
  minutes: readonly Candle[];
  cg: CgView;
  fundingRateProvider?: (ts: number) => number | null;
  auxMinutes?: readonly Candle[];
  riskPctPerTrade?: number;
}

export interface PortfolioConfig extends BacktestConfig {
  maxParallelPositions: number;
  cooldownAfterSlMs: number;
  cooldownAfterTpMs: number;
  riskPctPerTrade: number;
  // Policy-experiment hooks (live-policy-experiments.ts). Both undefined in every
  // validated run — behavior is byte-identical when unset.
  // Models the live funding-window collision: a signal accepted at decisionTs but
  // activated entryDelayMs later (latch retry at +1h), or dropped entirely.
  entryDelayMs?: (decisionTs: number) => number;
  skipEntryAt?: (decisionTs: number) => boolean;
}

export interface PortfolioTrade extends Trade {
  pair: string;
}

export interface DailyRow {
  date: string;
  returnPct: number;
  minIntradayPct: number;
}

export interface PortfolioResult {
  trades: PortfolioTrade[];
  finalEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  worstDailyPct: number;
  daily: DailyRow[];
  placedOrders: number;
  filledOrders: number;
  skippedByCap: number;
  skippedByCooldown: number;
}

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

interface LegState {
  input: PortfolioLegInput;
  riskFraction: number;
  decisionBars: Candle[];
  auxBars: Candle[] | null;
  closedView: Candle[];
  auxClosedView: Candle[];
  auxIdx: number;
  nextDecisionIdx: number;
  minuteIdx: number;
  pending: PendingOrder | null;
  position: OpenPosition | null;
  cooldownUntilTs: number;
  lastMinute: Candle | null;
}

function riskPerUnitOf(position: OpenPosition): number {
  return Math.abs(position.intent.limitPrice - position.intent.slPrice);
}

function tryFillLimit(
  pending: PendingOrder,
  minute: Candle,
  strictTouch: boolean,
): { price: number; isTaker: boolean } | null {
  return simulateLimitFill(pending.intent, minute, minute.ts === pending.activeFromTs, strictTouch);
}

function checkExit(
  position: OpenPosition,
  minute: Candle,
  config: BacktestConfig,
  isFillBar: boolean,
): { price: number; reason: ExitReason } | null {
  return simulateExit(
    {
      side: position.intent.side,
      slPrice: position.intent.slPrice,
      tpPrice: position.intent.tpPrice,
      entryPrice: position.entryPrice,
    },
    minute,
    config.slSlippageBps,
    config.strictTouch,
    isFillBar,
  );
}

function buildTrade(
  pair: string,
  position: OpenPosition,
  exitPrice: number,
  reason: ExitReason,
  exitTs: number,
  config: BacktestConfig,
): PortfolioTrade {
  const { intent, entryPrice, entryTs, placedTs, fundingR, entryIsTaker } = position;
  const riskPerUnit = riskPerUnitOf(position);

  const direction = intent.side === 'long' ? 1 : -1;
  const grossR = (direction * (exitPrice - entryPrice)) / riskPerUnit;

  const entryFeeRate = entryIsTaker ? config.takerFee : config.makerFee;
  const exitFeeRate = reason === 'tp' ? config.makerFee : config.takerFee;
  const feesR = (entryFeeRate * entryPrice + exitFeeRate * exitPrice) / riskPerUnit;

  return {
    pair,
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

function unrealizedR(position: OpenPosition, price: number): number {
  const direction = position.intent.side === 'long' ? 1 : -1;
  return (direction * (price - position.entryPrice)) / riskPerUnitOf(position);
}

export function runPortfolio(legs: readonly PortfolioLegInput[], config: PortfolioConfig): PortfolioResult {
  const states: LegState[] = legs.map(input => ({
    input,
    riskFraction: (input.riskPctPerTrade ?? config.riskPctPerTrade) / 100,
    decisionBars: aggregateCandles(input.minutes, input.strategy.decisionIntervalMs),
    auxBars: input.auxMinutes ? aggregateCandles(input.auxMinutes, input.strategy.decisionIntervalMs) : null,
    closedView: [],
    auxClosedView: [],
    auxIdx: 0,
    nextDecisionIdx: input.strategy.warmupBars,
    minuteIdx: 0,
    pending: null,
    position: null,
    cooldownUntilTs: 0,
    lastMinute: null,
  }));

  const fromTs = Math.max(...states.map(s => s.input.minutes[0].ts));
  const toTs = Math.min(...states.map(s => s.input.minutes[s.input.minutes.length - 1].ts));

  for (const state of states) {
    while (state.minuteIdx < state.input.minutes.length && state.input.minutes[state.minuteIdx].ts < fromTs) {
      state.minuteIdx++;
    }
  }

  const trades: PortfolioTrade[] = [];

  let realizedEquity = 1;
  let peakEquity = 1;
  let maxDDFraction = 0;
  let placedOrders = 0;
  let filledOrders = 0;
  let skippedByCap = 0;
  let skippedByCooldown = 0;

  const daily: DailyRow[] = [];
  let dayKey = '';
  let dayStartEquity = 1;
  let dayMinEquity = 1;
  let lastMtmEquity = 1;

  const closeTrade = (state: LegState, exitPrice: number, reason: ExitReason, exitTs: number): void => {
    const trade = buildTrade(state.input.pair, state.position!, exitPrice, reason, exitTs, config);
    trades.push(trade);
    realizedEquity *= 1 + trade.netR * state.riskFraction;
    const cooldown = reason === 'sl' ? config.cooldownAfterSlMs : config.cooldownAfterTpMs;
    state.cooldownUntilTs = exitTs + cooldown;
    state.position = null;
  };

  for (let ts = fromTs; ts <= toTs; ts += MINUTE_MS) {
    const openSlots = states.filter(s => s.position !== null || s.pending !== null).length;
    let slotsLeft = config.maxParallelPositions - openSlots;

    for (const state of states) {
      const minutes = state.input.minutes;
      let minute: Candle | null = null;
      if (state.minuteIdx < minutes.length && minutes[state.minuteIdx].ts === ts) {
        minute = minutes[state.minuteIdx];
        state.minuteIdx++;
        state.lastMinute = minute;
      }

      if (state.pending !== null && ts >= state.pending.expiresTs) {
        state.pending = null;
        slotsLeft = config.maxParallelPositions - states.filter(s => s.position !== null || s.pending !== null).length;
      }

      const bucketMs = state.input.strategy.decisionIntervalMs;
      while (
        state.nextDecisionIdx < state.decisionBars.length &&
        ts >= state.decisionBars[state.nextDecisionIdx].ts + bucketMs + config.gapMs
      ) {
        const decisionTs = state.decisionBars[state.nextDecisionIdx].ts + bucketMs + config.gapMs;

        if (state.position === null && state.pending === null) {
          while (state.closedView.length <= state.nextDecisionIdx) {
            state.closedView.push(state.decisionBars[state.closedView.length]);
          }
          if (state.auxBars !== null) {
            while (state.auxIdx < state.auxBars.length && state.auxBars[state.auxIdx].ts + bucketMs <= decisionTs) {
              state.auxClosedView.push(state.auxBars[state.auxIdx]);
              state.auxIdx++;
            }
          }

          if (ts < state.cooldownUntilTs) {
            skippedByCooldown++;
          } else if (slotsLeft <= 0) {
            skippedByCap++;
          } else {
            state.input.cg.setCursor(decisionTs);
            const lastPrice = state.lastMinute?.close ?? state.input.minutes[0].open;
            const intent = state.input.strategy.decide({
              decisionTs,
              bars: state.closedView,
              lastPrice,
              cg: state.input.cg,
              auxBars: state.auxBars !== null ? state.auxClosedView : undefined,
            });

            if (intent !== null && isValidIntent(intent)) {
              if (config.skipEntryAt !== undefined && config.skipEntryAt(decisionTs)) {
                // policy experiment: signal dropped, decision bar still consumed
              } else {
                const activationDelay = config.entryDelayMs !== undefined ? config.entryDelayMs(decisionTs) : 0;
                state.pending = {
                  intent,
                  placedTs: decisionTs,
                  activeFromTs: decisionTs + activationDelay,
                  expiresTs: decisionTs + activationDelay + intent.ttlMinutes * MINUTE_MS,
                };
                placedOrders++;
                slotsLeft--;
              }
            }
          }
        }

        state.nextDecisionIdx++;
      }

      if (minute === null) continue;

      if (state.pending !== null && ts >= state.pending.activeFromTs) {
        const fill = tryFillLimit(state.pending, minute, config.strictTouch);
        if (fill !== null) {
          filledOrders++;
          state.position = {
            intent: state.pending.intent,
            placedTs: state.pending.placedTs,
            entryTs: ts,
            entryPrice: fill.price,
            entryIsTaker: fill.isTaker,
            maxHoldUntilTs: state.pending.placedTs + config.maxHoldDecisionBars * state.input.strategy.decisionIntervalMs,
            fundingR: 0,
          };
          state.pending = null;

          const exit = checkExit(state.position, minute, config, true);
          if (exit !== null) closeTrade(state, exit.price, exit.reason, ts);
        }
      } else if (state.position !== null) {
        if (config.applyFunding && state.input.fundingRateProvider && ts % FUNDING_INTERVAL_MS === 0) {
          const rate = state.input.fundingRateProvider(ts);
          if (rate !== null) {
            const sign = state.position.intent.side === 'long' ? -1 : 1;
            state.position.fundingR += (sign * rate * state.position.entryPrice) / riskPerUnitOf(state.position);
          }
        }

        const exit = checkExit(state.position, minute, config, false);
        if (exit !== null) {
          closeTrade(state, exit.price, exit.reason, ts);
        } else if (ts + MINUTE_MS >= state.position.maxHoldUntilTs) {
          closeTrade(state, minute.close, 'time', ts);
        }
      }
    }

    let unrealized = 0;
    for (const state of states) {
      if (state.position !== null && state.lastMinute !== null) {
        unrealized += unrealizedR(state.position, state.lastMinute.close) * state.riskFraction;
      }
    }
    const mtmEquity = realizedEquity * (1 + unrealized);
    lastMtmEquity = mtmEquity;

    peakEquity = Math.max(peakEquity, mtmEquity);
    maxDDFraction = Math.max(maxDDFraction, 1 - mtmEquity / peakEquity);

    const key = new Date(ts).toISOString().slice(0, 10);
    if (key !== dayKey) {
      if (dayKey !== '') {
        daily.push({
          date: dayKey,
          returnPct: (lastMtmEquity / dayStartEquity - 1) * 100,
          minIntradayPct: (dayMinEquity / dayStartEquity - 1) * 100,
        });
      }
      dayKey = key;
      dayStartEquity = mtmEquity;
      dayMinEquity = mtmEquity;
    } else {
      dayMinEquity = Math.min(dayMinEquity, mtmEquity);
    }
  }

  for (const state of states) {
    if (state.position !== null && state.lastMinute !== null) {
      closeTrade(state, state.lastMinute.close, 'eod', state.lastMinute.ts);
    }
  }

  if (dayKey !== '') {
    daily.push({
      date: dayKey,
      returnPct: (realizedEquity / dayStartEquity - 1) * 100,
      minIntradayPct: (dayMinEquity / dayStartEquity - 1) * 100,
    });
  }

  const worstDailyPct = daily.reduce((worst, row) => Math.min(worst, row.minIntradayPct), 0);

  return {
    trades,
    finalEquity: realizedEquity,
    returnPct: (realizedEquity - 1) * 100,
    maxDrawdownPct: maxDDFraction * 100,
    worstDailyPct,
    daily,
    placedOrders,
    filledOrders,
    skippedByCap,
    skippedByCooldown,
  };
}
