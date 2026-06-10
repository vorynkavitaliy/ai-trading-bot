import { CgView } from '../backtest/cg-view';
import { isValidIntent } from '../backtest/execution-sim';
import { BybitPublicClient } from '../clients/bybit/public';
import { CoinglassClient } from '../clients/coinglass';
import { TelegramClient } from '../clients/telegram';
import { coinglassConfigFromEnv, telegramConfigFromEnv } from '../config/clients';
import { createLogger } from '../core/logger';
import { Candle } from '../data/types';
import { LIVE_PORTFOLIO, LivePairConfig } from './config';
import {
  fetchClosedDecisionBars,
  fetchClosedMinutes,
  fetchLastClosedMinuteClose,
  fetchPairCgInputs,
} from './market-data';
import { occupiedSlots, placeOrder, processMinutes } from './paper-broker';
import { loadState, saveState, statePath } from './state';
import { PaperReporter } from './telegram-reporter';

const MINUTE_MS = 60_000;

async function monitorPhase(
  bybit: BybitPublicClient,
  reporter: PaperReporter,
  nowTs: number,
): Promise<void> {
  const state = loadState(nowTs);
  const pairsToWatch = new Set([...state.orders.map(o => o.pair), ...state.positions.map(p => p.pair)]);

  for (const pair of pairsToWatch) {
    const fromTs = Math.max(state.lastMonitorTs - 2 * MINUTE_MS, nowTs - 6 * 3_600_000);
    const minutes = await fetchClosedMinutes(bybit, pair, fromTs, nowTs);
    const fresh = minutes.filter(m => m.ts >= state.lastMonitorTs - MINUTE_MS);
    const events = processMinutes(state, pair, fresh, LIVE_PORTFOLIO);
    await reporter.reportEvents(events, state);
  }

  state.lastMonitorTs = nowTs;
  saveState(state);
}

async function decisionPhase(
  bybit: BybitPublicClient,
  cg: CoinglassClient,
  reporter: PaperReporter,
  nowTs: number,
): Promise<void> {
  const config = LIVE_PORTFOLIO;
  const intervalMs = config.decisionIntervalMs;

  const lastClosedBarTs = Math.floor(nowTs / intervalMs) * intervalMs - intervalMs;
  const decisionTs = lastClosedBarTs + intervalMs + config.gapMs;
  if (nowTs < decisionTs) return;

  const state = loadState(nowTs);
  const needsDecision = config.pairs.filter(p => (state.lastDecisionBarTs[p.pair] ?? 0) < lastClosedBarTs);
  if (needsDecision.length === 0) return;

  const btcInputs = await fetchPairCgInputs(cg, 'BTC', 'BTCUSDT', config, 'btc');
  const btcBars = await fetchClosedDecisionBars(bybit, 'BTCUSDT', config, nowTs);

  for (const pairConfig of needsDecision) {
    try {
      await decideForPair(pairConfig, state, btcInputs, btcBars, bybit, cg, reporter, nowTs, decisionTs);
    } catch (error) {
      reporterSafeError(reporter, pairConfig.pair, error);
    }
    state.lastDecisionBarTs[pairConfig.pair] = lastClosedBarTs;
  }

  saveState(state);
}

async function decideForPair(
  pairConfig: LivePairConfig,
  state: ReturnType<typeof loadState>,
  btcInputs: Awaited<ReturnType<typeof fetchPairCgInputs>>,
  btcBars: Candle[],
  bybit: BybitPublicClient,
  cg: CoinglassClient,
  reporter: PaperReporter,
  nowTs: number,
  decisionTs: number,
): Promise<void> {
  const config = LIVE_PORTFOLIO;
  const logger = createLogger(`decide-${pairConfig.pair}`);

  if ((state.cooldownUntilTs[pairConfig.pair] ?? 0) > nowTs) {
    logger.info('skipped: cooldown active');
    return;
  }
  if (state.orders.some(o => o.pair === pairConfig.pair) || state.positions.some(p => p.pair === pairConfig.pair)) {
    logger.info('skipped: order or position already open');
    return;
  }
  if (occupiedSlots(state) >= config.maxParallelPositions) {
    logger.info('skipped: cap reached');
    return;
  }

  const ownInputs =
    pairConfig.pair === 'BTCUSDT'
      ? renamePrefix(btcInputs)
      : await fetchPairCgInputs(cg, pairConfig.coin, pairConfig.pair, config);
  const cgView = new CgView(
    pairConfig.usesBtcContext ? [...ownInputs, ...btcInputs] : ownInputs,
    config.cgPublishLagMs,
  );
  cgView.setCursor(decisionTs);

  const bars = pairConfig.pair === 'BTCUSDT' ? btcBars : await fetchClosedDecisionBars(bybit, pairConfig.pair, config, nowTs);
  const lastPrice = await fetchLastClosedMinuteClose(bybit, pairConfig.pair, nowTs);

  const strategy = pairConfig.buildStrategy();
  const intent = strategy.decide({
    decisionTs,
    bars,
    lastPrice,
    cg: cgView,
    auxBars: pairConfig.usesBtcContext ? btcBars : undefined,
  });

  if (intent === null) {
    logger.info('no signal');
    return;
  }
  if (!isValidIntent(intent)) {
    logger.warn('invalid intent rejected', { intent: JSON.stringify(intent) });
    return;
  }

  placeOrder(state, {
    pair: pairConfig.pair,
    side: intent.side,
    limitPrice: intent.limitPrice,
    slPrice: intent.slPrice,
    tpPrice: intent.tpPrice,
    placedTs: nowTs,
    expiresTs: nowTs + intent.ttlMinutes * MINUTE_MS,
    maxHoldUntilTs: nowTs + config.maxHoldDecisionBars * config.decisionIntervalMs,
    riskPctPerTrade: pairConfig.riskPctPerTrade,
    tag: intent.tag ?? strategy.id,
  });
  await reporter.reportOrderPlaced(pairConfig.pair, intent.side, intent.limitPrice, intent.slPrice, intent.tpPrice);
}

const BTC_TO_OWN_NAME: Record<string, string> = {
  btcLsTopPosition: 'lsTopPosition',
  btcFunding: 'funding',
  btcLiq: 'liq',
};

function renamePrefix(btcInputs: Awaited<ReturnType<typeof fetchPairCgInputs>>) {
  return btcInputs.map(input => ({ ...input, name: BTC_TO_OWN_NAME[input.name] ?? input.name }));
}

function reporterSafeError(reporter: PaperReporter, pair: string, error: unknown): void {
  const logger = createLogger('cycle');
  logger.error('decision failed', { pair, error: (error as Error).message });
  void reporter;
}

async function main(): Promise<void> {
  const logger = createLogger('paper-cycle');
  const nowTs = Date.now();
  const noTelegram = process.argv.includes('--no-telegram');

  const bybit = new BybitPublicClient({ logger });
  const cg = new CoinglassClient(coinglassConfigFromEnv(), { logger });
  const telegram = noTelegram ? null : new TelegramClient(telegramConfigFromEnv(), { logger });
  const reporter = new PaperReporter(telegram, logger);

  logger.info('cycle start', { nowIso: new Date(nowTs).toISOString(), statePath: statePath() });

  await monitorPhase(bybit, reporter, nowTs);
  await decisionPhase(bybit, cg, reporter, nowTs);

  logger.info('cycle done');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
