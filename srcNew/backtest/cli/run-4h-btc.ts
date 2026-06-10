import { createLogger } from '../../core/logger';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { computeMetrics, formatMetrics, splitTradesByTs } from '../metrics';
import { DEFAULT_CONFIG, Strategy, Trade } from '../types';

const HOUR_MS = 3_600_000;

function quarterKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

function brief(trades: readonly Trade[]): string {
  let sumR = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.netR;
    if (t.netR > 0) wins++;
  }
  const wr = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : '-';
  return `n=${trades.length} sumR=${sumR.toFixed(1)} WR=${wr}%`;
}

function buildStrategies(): Strategy[] {
  return [
    cgSlowFade(),
    cgSlowFade({ tpAtrMult: 99, slAtrMult: 2.0 }),
    cgSlowFade({ lsPctHi: 0.9, lsPctLo: 0.1, fundingPctHi: 0.9 }),
    cgSlowFade({ useLiqMomentum: true }),
    cgSlowFade({ entryOffsetAtr: 0.0 }),
    cgSlowFade({ entryOffsetAtr: 0.4 }),
    cgSlowFade({ slAtrMult: 1.5, tpAtrMult: 2.5 }),
    cgSlowFade({ slAtrMult: 3.0, tpAtrMult: 5.0 }),
  ];
}

function main(): void {
  const logger = createLogger('run-4h');
  const config = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const dataset = loadBtcDataset('4h');
  const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 4 * HOUR_MS);

  const fromTs = minutes[0].ts;
  const toTs = minutes[minutes.length - 1].ts;
  const splitTs = fromTs + (toTs - fromTs) / 2;

  logger.info('dataset ready', {
    minuteBars: minutes.length,
    fromIso: new Date(fromTs).toISOString(),
    splitIso: new Date(splitTs).toISOString(),
    toIso: new Date(toTs).toISOString(),
  });

  for (const strategy of buildStrategies()) {
    const cg = buildCgView(dataset, config.cgPublishLagMs);
    const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: fundingProvider });
    const metrics = computeMetrics(result);
    console.log('\n' + formatMetrics(strategy.id, metrics));

    const { is, oos } = splitTradesByTs(result.trades, splitTs);
    console.log(`  IS : ${brief(is)}`);
    console.log(`  OOS: ${brief(oos)}`);
    console.log(`  longs: ${brief(result.trades.filter(t => t.side === 'long'))} | shorts: ${brief(result.trades.filter(t => t.side === 'short'))}`);

    const byQuarter = new Map<string, Trade[]>();
    for (const t of result.trades) {
      const key = quarterKey(t.exitTs);
      if (!byQuarter.has(key)) byQuarter.set(key, []);
      byQuarter.get(key)!.push(t);
    }
    const quarterParts: string[] = [];
    for (const [quarter, trades] of [...byQuarter.entries()].sort()) {
      quarterParts.push(`${quarter}: ${brief(trades)}`);
    }
    console.log(`  ${quarterParts.join(' | ')}`);
  }
}

main();
