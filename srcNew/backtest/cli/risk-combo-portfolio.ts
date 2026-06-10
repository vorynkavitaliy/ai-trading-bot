import { createLogger } from '../../core/logger';
import { readNdjson } from '../../data/store';
import { Candle } from '../../data/types';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../../strategies/cg-slow-fade-btc';
import { CgView } from '../cg-view';
import { buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { PortfolioConfig, PortfolioLegInput, runPortfolio } from '../portfolio-engine';
import { DEFAULT_CONFIG, Strategy } from '../types';

const HOUR_MS = 3_600_000;

interface ComboSpec {
  label: string;
  btcRisk: number;
  altRisk: number;
}

function main(): void {
  const logger = createLogger('risk-combo');

  const btcMinutes = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const btcDataset = loadDataset('BTC', 'BTCUSDT', '4h');

  const mode = process.argv[2] ?? 'four';
  const legsSpec: Array<[string, string, () => Strategy]> = [
    ['BTC', 'BTCUSDT', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })],
    ['ETH', 'ETHUSDT', () => cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true })],
    ['SOL', 'SOLUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal' })],
  ];
  if (mode !== 'doge-replaces-xrp') {
    legsSpec.push(['XRP', 'XRPUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })]);
  }
  if (mode === 'five' || mode === 'doge-replaces-xrp') {
    legsSpec.push(['DOGE', 'DOGEUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })]);
  }
  const withDoge = mode === 'five';

  const combos: ComboSpec[] =
    mode === 'five'
      ? [
          { label: '5p BTC1/alts0.5 cap4', btcRisk: 1.0, altRisk: 0.5 },
          { label: '5p BTC1/alts0.5 cap5', btcRisk: 1.0, altRisk: 0.5 },
          { label: '5p base 0.5 cap4', btcRisk: 0.5, altRisk: 0.5 },
        ]
      : mode === 'doge-replaces-xrp'
        ? [{ label: 'BTC/ETH/SOL/DOGE 1/0.5', btcRisk: 1.0, altRisk: 0.5 }]
        : [
            { label: 'base 0.5/0.5', btcRisk: 0.5, altRisk: 0.5 },
            { label: 'BTC 0.75 / alts 0.5', btcRisk: 0.75, altRisk: 0.5 },
            { label: 'BTC 1.0 / alts 0.5', btcRisk: 1.0, altRisk: 0.5 },
            { label: 'BTC 1.0 / alts 0.625', btcRisk: 1.0, altRisk: 0.625 },
            { label: 'BTC 1.25 / alts 0.5', btcRisk: 1.25, altRisk: 0.5 },
          ];
  void withDoge;

  console.log('combo                     P&L        annualized  maxDD(MTM)  worstDay  d<=-2.5%  d<=-4%  cap-skips');

  for (const combo of combos) {
    const legs: PortfolioLegInput[] = legsSpec.map(([coin, pair, factory]) => {
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
        riskPctPerTrade: pair === 'BTCUSDT' ? combo.btcRisk : combo.altRisk,
      };
    });

    const config: PortfolioConfig = {
      ...DEFAULT_CONFIG,
      maxHoldDecisionBars: 12,
      maxParallelPositions: combo.label.includes('cap5') ? 5 : 4,
      cooldownAfterSlMs: 12 * HOUR_MS,
      cooldownAfterTpMs: 4 * HOUR_MS,
      riskPctPerTrade: combo.altRisk,
    };

    const result = runPortfolio(legs, config);
    const periodDays = result.daily.length;
    const annualized = (Math.pow(1 + result.returnPct / 100, 365 / Math.max(periodDays, 1)) - 1) * 100;
    const softDays = result.daily.filter(d => d.minIntradayPct <= -2.5).length;
    const hardDays = result.daily.filter(d => d.minIntradayPct <= -4).length;

    console.log(
      `${combo.label.padEnd(25)} +${result.returnPct.toFixed(2).padStart(6)}%   +${annualized.toFixed(2).padStart(6)}%    ` +
        `-${result.maxDrawdownPct.toFixed(2)}%      ${result.worstDailyPct.toFixed(2)}%    ${String(softDays).padStart(2)}        ${String(hardDays).padStart(2)}      ${result.skippedByCap}`,
    );
  }

  logger.info('risk combo done');
}

main();
