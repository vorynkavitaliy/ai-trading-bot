import { createLogger } from '../../core/logger';
import { fundingFade, lsTopPositionFade } from '../../strategies/cg-percentile-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { computeMetrics, splitTradesByTs } from '../metrics';
import { DEFAULT_CONFIG, Strategy, Trade } from '../types';

interface SweepRow {
  id: string;
  isTrades: number;
  isExpR: number;
  isPf: number;
  oosTrades: number;
  oosExpR: number;
  oosPf: number;
  oosSumR: number;
  oosMaxDdR: number;
}

function metricsOf(trades: Trade[]): { n: number; expR: number; pf: number; sumR: number; maxDD: number } {
  let sumR = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    sumR += t.netR;
    if (t.netR > 0) grossProfit += t.netR;
    else grossLoss -= t.netR;
    equity += t.netR;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  return {
    n: trades.length,
    expR: trades.length > 0 ? sumR / trades.length : 0,
    pf: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    sumR,
    maxDD,
  };
}

function buildGrid(): Strategy[] {
  const out: Strategy[] = [];
  const windows = [360, 720, 1080];
  const pcts: Array<[number, number]> = [
    [0.85, 0.15],
    [0.9, 0.1],
    [0.95, 0.05],
  ];
  const slMults = [1.0, 1.5];
  const tpMults = [1.5, 2.0, 3.0];

  for (const windowBars of windows) {
    for (const [pctHi, pctLo] of pcts) {
      for (const slAtrMult of slMults) {
        for (const tpAtrMult of tpMults) {
          out.push(fundingFade({ windowBars, pctHi, pctLo, slAtrMult, tpAtrMult }));
          out.push(lsTopPositionFade({ windowBars, pctHi, pctLo, slAtrMult, tpAtrMult }));
        }
      }
    }
  }
  return out;
}

function main(): void {
  const logger = createLogger('sweep-btc');
  const config = DEFAULT_CONFIG;

  const dataset = loadBtcDataset();
  const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs);

  const fromTs = minutes[0].ts;
  const toTs = minutes[minutes.length - 1].ts;
  const splitTs = fromTs + (toTs - fromTs) / 2;
  logger.info('sweep start', {
    fromIso: new Date(fromTs).toISOString(),
    splitIso: new Date(splitTs).toISOString(),
    toIso: new Date(toTs).toISOString(),
  });

  const rows: SweepRow[] = [];
  const strategies = buildGrid();

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const cg = buildCgView(dataset, config.cgPublishLagMs);
    const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: fundingProvider });
    const { is, oos } = splitTradesByTs(result.trades, splitTs);
    const isM = metricsOf(is);
    const oosM = metricsOf(oos);
    rows.push({
      id: strategy.id,
      isTrades: isM.n,
      isExpR: isM.expR,
      isPf: isM.pf,
      oosTrades: oosM.n,
      oosExpR: oosM.expR,
      oosPf: oosM.pf,
      oosSumR: oosM.sumR,
      oosMaxDdR: oosM.maxDD,
    });
    if ((i + 1) % 20 === 0) logger.info('sweep progress', { done: i + 1, total: strategies.length });
  }

  rows.sort((a, b) => b.isExpR - a.isExpR);

  console.log('id\tisN\tisExpR\tisPF\toosN\toosExpR\toosPF\toosSumR\toosMaxDD');
  for (const row of rows) {
    console.log(
      [
        row.id,
        row.isTrades,
        row.isExpR.toFixed(3),
        Number.isFinite(row.isPf) ? row.isPf.toFixed(2) : 'inf',
        row.oosTrades,
        row.oosExpR.toFixed(3),
        Number.isFinite(row.oosPf) ? row.oosPf.toFixed(2) : 'inf',
        row.oosSumR.toFixed(1),
        row.oosMaxDdR.toFixed(1),
      ].join('\t'),
    );
  }
}

main();
