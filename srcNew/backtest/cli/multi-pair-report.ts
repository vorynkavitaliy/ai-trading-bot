import { createLogger } from '../../core/logger';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { runBacktest } from '../engine';
import { computeMetrics, computePctMetrics, formatMetrics, formatPctMetrics, splitTradesByTs } from '../metrics';
import { DEFAULT_CONFIG, Trade } from '../types';

const HOUR_MS = 3_600_000;

const PAIRS: Array<[string, string]> = [
  ['BTC', 'BTCUSDT'],
  ['ETH', 'ETHUSDT'],
  ['SOL', 'SOLUSDT'],
  ['XRP', 'XRPUSDT'],
];

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function brief(trades: readonly Trade[]): string {
  let sumR = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.netR;
    if (t.netR > 0) wins++;
  }
  const wr = trades.length ? ((wins / trades.length) * 100).toFixed(0) : '-';
  return `n=${trades.length} sumR=${sumR.toFixed(1)} WR=${wr}%`;
}

function main(): void {
  const logger = createLogger('multi-pair');
  const config = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const allTrades: Trade[] = [];

  for (const [coin, pair] of PAIRS) {
    let dataset;
    try {
      dataset = loadDataset(coin, pair, '4h');
    } catch (error) {
      console.log(`\n##### ${pair}: dataset missing (${(error as Error).message.slice(0, 80)})`);
      continue;
    }

    const shortsOnly = process.argv[2] === 'shorts-only';
    const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
    const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 4 * HOUR_MS);
    const strategy = shortsOnly
      ? cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3, lsPctLo: -0.1 })
      : cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 });
    const cg = buildCgView(dataset, config.cgPublishLagMs);

    const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: fundingProvider });
    const metrics = computeMetrics(result);
    const fromTs = minutes[0].ts;
    const toTs = minutes[minutes.length - 1].ts;
    const splitTs = fromTs + (toTs - fromTs) / 2;

    allTrades.push(...result.trades);

    console.log(`\n##### ${pair} (${new Date(fromTs).toISOString().slice(0, 10)} .. ${new Date(toTs).toISOString().slice(0, 10)})`);
    console.log(formatMetrics(strategy.id, metrics));
    console.log(`  ${formatPctMetrics(computePctMetrics(result.trades, 0.5, fromTs, toTs))}`);
    const { is, oos } = splitTradesByTs(result.trades, splitTs);
    console.log(`  IS : ${brief(is)} | OOS: ${brief(oos)}`);
    console.log(`  L: ${brief(result.trades.filter(t => t.side === 'long'))} | S: ${brief(result.trades.filter(t => t.side === 'short'))}`);

    const byMonth = new Map<string, Trade[]>();
    for (const t of result.trades) {
      const key = monthKey(t.placedTs);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(t);
    }
    const cells: string[] = [];
    for (const [month, list] of [...byMonth.entries()].sort()) {
      const r = list.reduce((a, t) => a + t.netR, 0);
      cells.push(`${month.slice(2)}: ${r >= 0 ? '+' : ''}${r.toFixed(1)}(${list.length})`);
    }
    console.log(`  ${cells.join(' | ')}`);
  }

  console.log(`\n##### PORTFOLIO (all pairs pooled, independent equal-risk)`);
  console.log(`  ${brief(allTrades)}`);
  const monthsAll = new Map<string, Trade[]>();
  for (const t of allTrades) {
    const key = monthKey(t.placedTs);
    if (!monthsAll.has(key)) monthsAll.set(key, []);
    monthsAll.get(key)!.push(t);
  }
  const cells: string[] = [];
  let positiveMonths = 0;
  for (const [month, list] of [...monthsAll.entries()].sort()) {
    const r = list.reduce((a, t) => a + t.netR, 0);
    if (r > 0) positiveMonths++;
    cells.push(`${month.slice(2)}: ${r >= 0 ? '+' : ''}${r.toFixed(1)}(${list.length})`);
  }
  console.log(`  ${cells.join(' | ')}`);
  console.log(`  positive months: ${positiveMonths}/${monthsAll.size}`);

  logger.info('multi-pair report done');
}

main();
