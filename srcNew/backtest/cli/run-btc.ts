import { createLogger } from '../../core/logger';
import { fundingFade, lsTopPositionFade } from '../../strategies/cg-percentile-fade';
import { liqCascadeRevert } from '../../strategies/liq-cascade-revert';
import { donchianRetest, rsiDip } from '../../strategies/ta-benchmarks';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { computeMetrics, formatMetrics } from '../metrics';
import { DEFAULT_CONFIG, Strategy } from '../types';

function buildStrategies(): Strategy[] {
  return [
    lsTopPositionFade(),
    lsTopPositionFade({ trendFilter: 'none' }),
    lsTopPositionFade({ pctHi: 0.95, pctLo: 0.05 }),
    fundingFade(),
    fundingFade({ trendFilter: 'none' }),
    fundingFade({ pctHi: 0.95, pctLo: 0.05 }),
    liqCascadeRevert(),
    liqCascadeRevert({ spikePct: 0.99 }),
    rsiDip(),
    rsiDip({ rsiWindow: 3, rsiLow: 15, rsiHigh: 85 }),
    donchianRetest(),
    donchianRetest({ channelBars: 24 }),
  ];
}

function main(): void {
  const logger = createLogger('run-btc');
  const config = DEFAULT_CONFIG;

  const dataset = loadBtcDataset();
  const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 3_600_000);

  logger.info('dataset ready', {
    minuteBars: minutes.length,
    fromIso: new Date(minutes[0].ts).toISOString(),
    toIso: new Date(minutes[minutes.length - 1].ts).toISOString(),
  });

  for (const strategy of buildStrategies()) {
    const cg = buildCgView(dataset, config.cgPublishLagMs);
    const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: fundingProvider });
    const metrics = computeMetrics(result);
    console.log(formatMetrics(strategy.id, metrics));
    console.log(`  decisions=${result.decisions} placed=${result.placedOrders}`);
  }
}

main();
