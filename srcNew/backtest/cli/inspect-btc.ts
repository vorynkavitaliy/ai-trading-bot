import { createLogger } from '../../core/logger';
import { fundingFade } from '../../strategies/cg-percentile-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { computeMetrics, formatMetrics } from '../metrics';
import { BacktestConfig, DEFAULT_CONFIG, Trade } from '../types';

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function summarize(label: string, trades: readonly Trade[]): string {
  let sumR = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.netR;
    if (t.netR > 0) wins++;
  }
  const wr = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : '0';
  return `${label}: n=${trades.length} sumR=${sumR.toFixed(1)} WR=${wr}%`;
}

function run(label: string, config: BacktestConfig): void {
  const dataset = loadBtcDataset();
  const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 3_600_000);
  const strategy = fundingFade({ windowBars: 360, pctHi: 0.9, pctLo: 0.1, slAtrMult: 1.5, tpAtrMult: 3.0 });

  const cg = buildCgView(dataset, config.cgPublishLagMs);
  const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: fundingProvider });
  const metrics = computeMetrics(result);

  console.log(`\n===== ${label} =====`);
  console.log(formatMetrics(strategy.id, metrics));

  console.log(summarize('  longs ', result.trades.filter(t => t.side === 'long')));
  console.log(summarize('  shorts', result.trades.filter(t => t.side === 'short')));

  const byMonth = new Map<string, Trade[]>();
  for (const t of result.trades) {
    const key = monthKey(t.exitTs);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(t);
  }
  for (const [month, trades] of [...byMonth.entries()].sort()) {
    console.log(summarize(`  ${month}`, trades));
  }
}

function main(): void {
  const logger = createLogger('inspect-btc');
  logger.info('inspect start');

  run('baseline (lag 2m, gap 60s, slip 2bps)', DEFAULT_CONFIG);
  run('stress: CG lag 10m', { ...DEFAULT_CONFIG, cgPublishLagMs: 600_000 });
  run('stress: gap 2m', { ...DEFAULT_CONFIG, gapMs: 120_000 });
  run('stress: slippage 5bps', { ...DEFAULT_CONFIG, slSlippageBps: 5 });
  run('stress: all of the above', {
    ...DEFAULT_CONFIG,
    cgPublishLagMs: 600_000,
    gapMs: 120_000,
    slSlippageBps: 5,
  });
  run('no funding cost', { ...DEFAULT_CONFIG, applyFunding: false });
}

main();
