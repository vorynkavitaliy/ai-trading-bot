import { createLogger } from '../../core/logger';
import { readNdjson } from '../../data/store';
import { Candle } from '../../data/types';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../../strategies/cg-slow-fade-btc';
import { CgView } from '../cg-view';
import { buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { runBacktest } from '../engine';
import { DailyRow, PortfolioLegInput, PortfolioConfig, runPortfolio } from '../portfolio-engine';
import { DEFAULT_CONFIG, Strategy, Trade } from '../types';

const HOUR_MS = 3_600_000;

const PORTFOLIO_CONFIG: PortfolioConfig = {
  ...DEFAULT_CONFIG,
  maxHoldDecisionBars: 12,
  maxParallelPositions: 4,
  cooldownAfterSlMs: 12 * HOUR_MS,
  cooldownAfterTpMs: 4 * HOUR_MS,
  riskPctPerTrade: 0.5,
};

interface PairData {
  coin: string;
  pair: string;
  minutes: Candle[];
  mergedInputs: ReturnType<typeof loadDataset>['cgInputs'];
  fundingProvider: (ts: number) => number | null;
}

function variantsFor(pair: string): Array<[string, () => Strategy]> {
  if (pair === 'BTCUSDT') {
    return [
      ['D', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })],
      ['D-S', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3, lsPctLo: -0.1 })],
    ];
  }
  return [
    ['base', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })],
    ['base-S', () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3, lsPctLo: -0.1 })],
    ['btc-trend', () => cgSlowFadeBtcAware({ btcMode: 'trend' })],
    ['btc-trend-S', () => cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true })],
    ['btc-signal', () => cgSlowFadeBtcAware({ btcMode: 'signal' })],
    ['btc-signal-S', () => cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })],
  ];
}

function tradeAgg(trades: readonly Trade[]): { n: number; sumR: number; expR: number; pf: number; wr: number } {
  let sumR = 0;
  let gp = 0;
  let gl = 0;
  let wins = 0;
  for (const t of trades) {
    sumR += t.netR;
    if (t.netR > 0) {
      gp += t.netR;
      wins++;
    } else gl -= t.netR;
  }
  return {
    n: trades.length,
    sumR,
    expR: trades.length ? sumR / trades.length : 0,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    wr: trades.length ? wins / trades.length : 0,
  };
}

function windowDailyMetrics(daily: readonly DailyRow[], fromTs: number, toTs: number): {
  returnPct: number;
  maxDDPct: number;
  worstDailyPct: number;
  softKillDays: number;
} {
  const fromKey = new Date(fromTs).toISOString().slice(0, 10);
  const toKey = new Date(toTs).toISOString().slice(0, 10);
  const rows = daily.filter(d => d.date >= fromKey && d.date <= toKey);

  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  let worstDaily = 0;
  let softKillDays = 0;

  for (const row of rows) {
    const intradayMin = equity * (1 + row.minIntradayPct / 100);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, 1 - intradayMin / peak);
    equity *= 1 + row.returnPct / 100;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, 1 - equity / peak);
    worstDaily = Math.min(worstDaily, row.minIntradayPct);
    if (row.minIntradayPct <= -2.5) softKillDays++;
  }

  return { returnPct: (equity - 1) * 100, maxDDPct: maxDD * 100, worstDailyPct: worstDaily, softKillDays };
}

function main(): void {
  const logger = createLogger('pf-wf');

  const btcMinutesFull = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const pairs: PairData[] = [];
  for (const [coin, pair] of [
    ['BTC', 'BTCUSDT'],
    ['ETH', 'ETHUSDT'],
    ['SOL', 'SOLUSDT'],
    ['XRP', 'XRPUSDT'],
  ] as Array<[string, string]>) {
    const dataset = loadDataset(coin, pair, '4h');
    const btcDataset = loadDataset('BTC', 'BTCUSDT', '4h');
    const mergedInputs = [
      ...dataset.cgInputs,
      { name: 'btcFunding', intervalMs: 4 * HOUR_MS, points: btcDataset.fundingPoints },
      { name: 'btcLsTopPosition', intervalMs: 4 * HOUR_MS, points: btcDataset.cgInputs.find(i => i.name === 'lsTopPosition')!.points },
      { name: 'btcLiq', intervalMs: 4 * HOUR_MS, points: btcDataset.cgInputs.find(i => i.name === 'liq')!.points },
    ];
    pairs.push({
      coin,
      pair,
      minutes: clampMinutesToCgWindow(dataset, PORTFOLIO_CONFIG.cgPublishLagMs),
      mergedInputs,
      fundingProvider: buildFundingProvider(dataset.fundingPoints, PORTFOLIO_CONFIG.cgPublishLagMs, 4 * HOUR_MS),
    });
  }

  const commonFrom = Math.max(...pairs.map(p => p.minutes[0].ts));
  const commonTo = Math.min(...pairs.map(p => p.minutes[p.minutes.length - 1].ts));
  const splitTs = commonFrom + (commonTo - commonFrom) / 2;
  logger.info('window', {
    fromIso: new Date(commonFrom).toISOString(),
    splitIso: new Date(splitTs).toISOString(),
    toIso: new Date(commonTo).toISOString(),
  });

  const singleRun = (pairData: PairData, strategy: Strategy): Trade[] => {
    const cg = new CgView(pairData.mergedInputs, PORTFOLIO_CONFIG.cgPublishLagMs);
    const result = runBacktest({
      strategy,
      minuteCandles: pairData.minutes,
      cg,
      config: PORTFOLIO_CONFIG,
      fundingRateProvider: pairData.fundingProvider,
      auxMinutes: pairData.pair === 'BTCUSDT' ? undefined : btcMinutesFull,
    });
    return result.trades;
  };

  const selectOnWindow = (windowFrom: number, windowTo: number, label: string): Map<string, string> => {
    console.log(`\n--- TRAIN ${label}: per-pair selection ---`);
    const selection = new Map<string, string>();
    for (const pairData of pairs) {
      let bestVariant = '';
      let bestScore = -Infinity;
      const parts: string[] = [];
      for (const [variantName, factory] of variantsFor(pairData.pair)) {
        const trades = singleRun(pairData, factory()).filter(t => t.placedTs >= windowFrom && t.placedTs < windowTo);
        const m = tradeAgg(trades);
        const score = m.n >= 15 ? m.sumR : -Infinity;
        parts.push(`${variantName}:${m.sumR.toFixed(1)}R(n${m.n})`);
        if (score > bestScore) {
          bestScore = score;
          bestVariant = variantName;
        }
      }
      selection.set(pairData.pair, bestVariant);
      console.log(`  ${pairData.pair}: ${parts.join(' ')} -> pick ${bestVariant}`);
    }
    return selection;
  };

  const buildLegs = (selection: Map<string, string>): PortfolioLegInput[] =>
    pairs.map(pairData => {
      const variantName = selection.get(pairData.pair)!;
      const factory = variantsFor(pairData.pair).find(([name]) => name === variantName)![1];
      return {
        pair: pairData.pair,
        strategy: factory(),
        minutes: pairData.minutes,
        cg: new CgView(pairData.mergedInputs, PORTFOLIO_CONFIG.cgPublishLagMs),
        fundingRateProvider: pairData.fundingProvider,
        auxMinutes: pairData.pair === 'BTCUSDT' ? undefined : btcMinutesFull,
      };
    });

  const reportWindow = (label: string, daily: readonly DailyRow[], trades: readonly Trade[], fromTs: number, toTs: number): void => {
    const m = windowDailyMetrics(daily, fromTs, toTs);
    const t = tradeAgg(trades.filter(tr => tr.placedTs >= fromTs && tr.placedTs < toTs));
    const pf = Number.isFinite(t.pf) ? t.pf.toFixed(2) : 'inf';
    console.log(
      `${label.padEnd(26)} P&L=${m.returnPct >= 0 ? '+' : ''}${m.returnPct.toFixed(2)}% ` +
        `maxDD=-${m.maxDDPct.toFixed(2)}% worstDay=${m.worstDailyPct.toFixed(2)}% softKillDays=${m.softKillDays} ` +
        `| trades=${t.n} WR=${(t.wr * 100).toFixed(0)}% expR=${t.expR.toFixed(3)} PF=${pf}`,
    );
  };

  console.log('\n===== FULL-WINDOW PORTFOLIO (final picks: BTC=D, ETH=btc-trend-S, SOL=btc-signal, XRP=btc-signal-S) =====');
  const finalSelection = new Map<string, string>([
    ['BTCUSDT', 'D'],
    ['ETHUSDT', 'btc-trend-S'],
    ['SOLUSDT', 'btc-signal'],
    ['XRPUSDT', 'btc-signal-S'],
  ]);
  const fullResult = runPortfolio(buildLegs(finalSelection), PORTFOLIO_CONFIG);
  console.log(
    `cap=${PORTFOLIO_CONFIG.maxParallelPositions} CD(sl)=${PORTFOLIO_CONFIG.cooldownAfterSlMs / HOUR_MS}h CD(tp)=${PORTFOLIO_CONFIG.cooldownAfterTpMs / HOUR_MS}h risk=${PORTFOLIO_CONFIG.riskPctPerTrade}%`,
  );
  console.log(
    `P&L=+${fullResult.returnPct.toFixed(2)}% maxDD(MTM)=-${fullResult.maxDrawdownPct.toFixed(2)}% worstDay=${fullResult.worstDailyPct.toFixed(2)}%`,
  );
  console.log(
    `placed=${fullResult.placedOrders} filled=${fullResult.filledOrders} skippedByCap=${fullResult.skippedByCap} skippedByCooldown=${fullResult.skippedByCooldown}`,
  );
  const fullAgg = tradeAgg(fullResult.trades);
  console.log(`trades=${fullAgg.n} WR=${(fullAgg.wr * 100).toFixed(1)}% expR=${fullAgg.expR.toFixed(3)} PF=${fullAgg.pf.toFixed(2)}`);
  for (const pairData of pairs) {
    const pairTrades = fullResult.trades.filter(t => t.pair === pairData.pair);
    const a = tradeAgg(pairTrades);
    const pf = Number.isFinite(a.pf) ? a.pf.toFixed(2) : 'inf';
    console.log(`  ${pairData.pair}: n=${a.n} sumR=${a.sumR.toFixed(1)} WR=${(a.wr * 100).toFixed(0)}% PF=${pf}`);
  }
  reportWindow('  half1 (in-window)', fullResult.daily, fullResult.trades, commonFrom, splitTs);
  reportWindow('  half2 (in-window)', fullResult.daily, fullResult.trades, splitTs, commonTo);

  console.log('\n===== WALK-FORWARD A: train H1 -> test H2 =====');
  const selectionA = selectOnWindow(commonFrom, splitTs, 'H1');
  const resultA = runPortfolio(buildLegs(selectionA), PORTFOLIO_CONFIG);
  reportWindow('TEST H2 (OOS)', resultA.daily, resultA.trades, splitTs, commonTo);

  console.log('\n===== WALK-FORWARD B: train H2 -> test H1 =====');
  const selectionB = selectOnWindow(splitTs, commonTo, 'H2');
  const resultB = runPortfolio(buildLegs(selectionB), PORTFOLIO_CONFIG);
  reportWindow('TEST H1 (OOS)', resultB.daily, resultB.trades, commonFrom, splitTs);

  console.log('\n===== MONTHLY (full-window portfolio, MTM daily) =====');
  const byMonth = new Map<string, DailyRow[]>();
  for (const row of fullResult.daily) {
    const key = row.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(row);
  }
  for (const [month, rows] of [...byMonth.entries()].sort()) {
    let equity = 1;
    let worstDay = 0;
    for (const row of rows) {
      equity *= 1 + row.returnPct / 100;
      worstDay = Math.min(worstDay, row.minIntradayPct);
    }
    const pct = (equity - 1) * 100;
    console.log(`  ${month}: ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% (worstDay ${worstDay.toFixed(2)}%)`);
  }

  logger.info('portfolio walk-forward done');
}

main();
