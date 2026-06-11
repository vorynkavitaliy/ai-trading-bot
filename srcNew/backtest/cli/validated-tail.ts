// Prints the validated headline portfolio (limit entries, lag120, take) summary
// plus the LAST trades — to compare the engine's recent behavior against live.
import { readNdjson } from '../../data/store';
import { Candle } from '../../data/types';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../../strategies/cg-slow-fade-btc';
import { CgView } from '../cg-view';
import { buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { PortfolioConfig, PortfolioLegInput, runPortfolio } from '../portfolio-engine';
import { DEFAULT_CONFIG, Strategy } from '../types';

const HOUR_MS = 3_600_000;

function main(): void {
  const btcMinutes = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const btcDataset = loadDataset('BTC', 'BTCUSDT', '4h');
  const legsSpec: Array<[string, string, () => Strategy]> = [
    ['BTC', 'BTCUSDT', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })],
    ['ETH', 'ETHUSDT', () => cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true })],
    ['SOL', 'SOLUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal' })],
    ['XRP', 'XRPUSDT', () => cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })],
  ];
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
      riskPctPerTrade: pair === 'BTCUSDT' ? 1.0 : 0.5,
    };
  });

  const config: PortfolioConfig = {
    ...DEFAULT_CONFIG,
    maxHoldDecisionBars: 12,
    maxParallelPositions: 4,
    cooldownAfterSlMs: 12 * HOUR_MS,
    cooldownAfterTpMs: 4 * HOUR_MS,
    riskPctPerTrade: 0.5,
  };
  const result = runPortfolio(legs, config);
  const days = result.daily.length;
  const ann = (Math.pow(1 + result.returnPct / 100, 365 / Math.max(days, 1)) - 1) * 100;
  const wins = result.trades.filter(t => t.netR > 0).length;

  console.log(`window: ${result.daily[0]?.date} .. ${result.daily[days - 1]?.date} (${days}d)`);
  console.log(
    `P&L +${result.returnPct.toFixed(2)}% (ann +${ann.toFixed(2)}%)  maxDD -${result.maxDrawdownPct.toFixed(2)}%  ` +
    `worstDay ${result.worstDailyPct.toFixed(2)}%  trades ${result.trades.length}  WR ${(100 * wins / result.trades.length).toFixed(1)}%  ` +
    `placed ${result.placedOrders} filled ${result.filledOrders} (fill-rate ${(100 * result.filledOrders / Math.max(result.placedOrders, 1)).toFixed(0)}%)`,
  );
  console.log('\nlast 14 trades:');
  for (const t of result.trades.slice(-14)) {
    const d = (ts: number) => new Date(ts).toISOString().slice(5, 16).replace('T', ' ');
    console.log(
      `  ${d(t.placedTs)}  ${t.pair.padEnd(8)} ${t.side.padEnd(5)} entry ${t.entryPrice.toFixed(t.entryPrice > 100 ? 0 : 4)} -> exit ${t.exitPrice.toFixed(t.exitPrice > 100 ? 0 : 4)}  ${t.exitReason.padEnd(4)} netR ${t.netR >= 0 ? '+' : ''}${t.netR.toFixed(2)}  hold ${(t.holdMinutes / 60).toFixed(0)}h`,
    );
  }
}

main();
