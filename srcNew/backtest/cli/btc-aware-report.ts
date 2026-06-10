import { createLogger } from '../../core/logger';
import { readNdjson } from '../../data/store';
import { Candle } from '../../data/types';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../../strategies/cg-slow-fade-btc';
import { CgView } from '../cg-view';
import { buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { runBacktest } from '../engine';
import { splitTradesByTs } from '../metrics';
import { DEFAULT_CONFIG, Strategy, Trade } from '../types';

const HOUR_MS = 3_600_000;

const ALTS: Array<[string, string]> =
  process.argv[2] === 'candidates'
    ? [
        ['BNB', 'BNBUSDT'],
        ['DOGE', 'DOGEUSDT'],
        ['LTC', 'LTCUSDT'],
      ]
    : [
        ['ETH', 'ETHUSDT'],
        ['SOL', 'SOLUSDT'],
        ['XRP', 'XRPUSDT'],
      ];

function agg(trades: readonly Trade[]): { n: number; sumR: number; expR: number; pf: number } {
  let sumR = 0;
  let gp = 0;
  let gl = 0;
  for (const t of trades) {
    sumR += t.netR;
    if (t.netR > 0) gp += t.netR;
    else gl -= t.netR;
  }
  return {
    n: trades.length,
    sumR,
    expR: trades.length ? sumR / trades.length : 0,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
  };
}

function row(label: string, trades: readonly Trade[], splitTs: number): string {
  const full = agg(trades);
  const { is, oos } = splitTradesByTs(trades, splitTs);
  const isM = agg(is);
  const oosM = agg(oos);
  const pf = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : 'inf');
  return (
    `${label.padEnd(34)} n=${String(full.n).padStart(3)} sumR=${full.sumR.toFixed(1).padStart(6)} ` +
    `expR=${full.expR.toFixed(3)} PF=${pf(full.pf)} | IS ${isM.sumR.toFixed(1)} | OOS ${oosM.sumR.toFixed(1)} (PF ${pf(oosM.pf)})`
  );
}

function main(): void {
  const logger = createLogger('btc-aware');
  const config = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const btcMinutes = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const btcDataset = loadDataset('BTC', 'BTCUSDT', '4h');

  for (const [coin, pair] of ALTS) {
    const dataset = loadDataset(coin, pair, '4h');

    const mergedInputs = [
      ...dataset.cgInputs,
      { name: 'btcFunding', intervalMs: 4 * HOUR_MS, points: btcDataset.fundingPoints },
      {
        name: 'btcLsTopPosition',
        intervalMs: 4 * HOUR_MS,
        points: btcDataset.cgInputs.find(i => i.name === 'lsTopPosition')!.points,
      },
      {
        name: 'btcLiq',
        intervalMs: 4 * HOUR_MS,
        points: btcDataset.cgInputs.find(i => i.name === 'liq')!.points,
      },
    ];

    const minutes = clampMinutesToCgWindow(dataset, config.cgPublishLagMs);
    const fundingProvider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 4 * HOUR_MS);
    const fromTs = minutes[0].ts;
    const toTs = minutes[minutes.length - 1].ts;
    const splitTs = fromTs + (toTs - fromTs) / 2;

    console.log(`\n##### ${pair}`);

    const variants: Array<[string, Strategy]> = [
      ['base (own signals)', cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })],
      ['base shorts-only', cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3, lsPctLo: -0.1 })],
      ['btc-trend filter', cgSlowFadeBtcAware({ btcMode: 'trend' })],
      ['btc-trend shorts-only', cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true })],
      ['btc-signal (trade alt on BTC sig)', cgSlowFadeBtcAware({ btcMode: 'signal' })],
      ['btc-signal shorts-only', cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })],
      ['confluence 0.9/0.9', cgSlowFadeBtcAware({ btcMode: 'confluence', ownPctHi: 0.9, ownPctLo: 0.1, btcPctHi: 0.9, btcPctLo: 0.1 })],
      ['confluence shorts-only', cgSlowFadeBtcAware({ btcMode: 'confluence', ownPctHi: 0.9, ownPctLo: 0.1, btcPctHi: 0.9, btcPctLo: 0.1, shortsOnly: true })],
    ];

    for (const [label, strategy] of variants) {
      const cg = new CgView(mergedInputs, config.cgPublishLagMs);
      const result = runBacktest({
        strategy,
        minuteCandles: minutes,
        cg,
        config,
        fundingRateProvider: fundingProvider,
        auxMinutes: btcMinutes,
      });
      console.log(row(label, result.trades, splitTs));
    }
  }

  logger.info('btc-aware report done');
}

main();
