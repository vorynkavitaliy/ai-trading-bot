import { createLogger } from '../../core/logger';
import { readNdjson } from '../../data/store';
import { Candle } from '../../data/types';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../../strategies/cg-slow-fade-btc';
import { CgView } from '../cg-view';
import { buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { PortfolioConfig, PortfolioLegInput, runPortfolio } from '../portfolio-engine';
import { DEFAULT_CONFIG } from '../types';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function main(): void {
  const logger = createLogger('risk-sweep');

  const btcMinutes = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const btcDataset = loadDataset('BTC', 'BTCUSDT', '4h');

  const legsSpec: Array<[string, string, () => ReturnType<typeof cgSlowFade>]> = [
    ['BTC', 'BTCUSDT', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })],
    ['ETH', 'ETHUSDT', () => cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true })],
    ['SOL', 'SOLUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal' })],
    ['XRP', 'XRPUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })],
  ];

  const buildLegs = (): PortfolioLegInput[] =>
    legsSpec.map(([coin, pair, factory]) => {
      const dataset = loadDataset(coin, pair, '4h');
      const mergedInputs = [
        ...dataset.cgInputs,
        { name: 'btcFunding', intervalMs: 4 * HOUR_MS, points: btcDataset.fundingPoints },
        { name: 'btcLsTopPosition', intervalMs: 4 * HOUR_MS, points: btcDataset.cgInputs.find(i => i.name === 'lsTopPosition')!.points },
        { name: 'btcLiq', intervalMs: 4 * HOUR_MS, points: btcDataset.cgInputs.find(i => i.name === 'liq')!.points },
      ];
      return {
        pair,
        strategy: factory(),
        minutes: clampMinutesToCgWindow(dataset, DEFAULT_CONFIG.cgPublishLagMs),
        cg: new CgView(mergedInputs, DEFAULT_CONFIG.cgPublishLagMs),
        fundingRateProvider: buildFundingProvider(dataset.fundingPoints, DEFAULT_CONFIG.cgPublishLagMs, 4 * HOUR_MS),
        auxMinutes: pair === 'BTCUSDT' ? undefined : btcMinutes,
      };
    });

  console.log('risk%   P&L        annualized  maxDD(MTM)  worstDay  days<=-2.5%  days<=-4%');

  for (const riskPct of [0.5, 0.625, 0.75, 0.875]) {
    const config: PortfolioConfig = {
      ...DEFAULT_CONFIG,
      maxHoldDecisionBars: 12,
      maxParallelPositions: 4,
      cooldownAfterSlMs: 12 * HOUR_MS,
      cooldownAfterTpMs: 4 * HOUR_MS,
      riskPctPerTrade: riskPct,
    };

    const result = runPortfolio(buildLegs(), config);

    const periodDays = result.daily.length;
    const annualized = (Math.pow(1 + result.returnPct / 100, 365 / Math.max(periodDays, 1)) - 1) * 100;
    const softDays = result.daily.filter(d => d.minIntradayPct <= -2.5).length;
    const hardDays = result.daily.filter(d => d.minIntradayPct <= -4).length;

    console.log(
      `${riskPct.toFixed(3).padEnd(7)} +${result.returnPct.toFixed(2).padStart(6)}%   ` +
        `+${annualized.toFixed(2).padStart(6)}%    ` +
        `-${result.maxDrawdownPct.toFixed(2)}%      ` +
        `${result.worstDailyPct.toFixed(2)}%    ` +
        `${String(softDays).padStart(2)}           ${String(hardDays).padStart(2)}`,
    );
  }

  void DAY_MS;
  logger.info('risk sweep done');
}

main();
