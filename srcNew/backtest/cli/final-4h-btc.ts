import { createLogger } from '../../core/logger';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { computeMetrics, formatMetrics, splitTradesByTs } from '../metrics';
import { BacktestConfig, DEFAULT_CONFIG, Strategy, Trade } from '../types';

const HOUR_MS = 3_600_000;

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
  const wr = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : '-';
  return `n=${trades.length} sumR=${sumR.toFixed(1)} WR=${wr}%`;
}

interface Combo {
  label: string;
  strategy: Strategy;
  config: BacktestConfig;
}

function main(): void {
  const logger = createLogger('final-4h');
  const base: BacktestConfig = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const dataset = loadBtcDataset('4h');
  const minutes = clampMinutesToCgWindow(dataset, base.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, base.cgPublishLagMs, 4 * HOUR_MS);
  const fromTs = minutes[0].ts;
  const toTs = minutes[minutes.length - 1].ts;
  const splitTs = fromTs + (toTs - fromTs) / 2;
  logger.info('final start', { splitIso: new Date(splitTs).toISOString() });

  const combos: Combo[] = [
    {
      label: 'A: hold18 + off0.3',
      strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 }),
      config: { ...base, maxHoldDecisionBars: 18 },
    },
    {
      label: 'B: hold18 + off0.3 + tp5',
      strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3, tpAtrMult: 5 }),
      config: { ...base, maxHoldDecisionBars: 18 },
    },
    {
      label: 'C: hold18 + off0.2',
      strategy: cgSlowFade({ useLiqMomentum: true }),
      config: { ...base, maxHoldDecisionBars: 18 },
    },
    {
      label: 'D: hold12 + off0.3',
      strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 }),
      config: base,
    },
    {
      label: 'E: hold15 + off0.25 + tp4',
      strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.25, tpAtrMult: 4 }),
      config: { ...base, maxHoldDecisionBars: 15 },
    },
    {
      label: 'F: hold18 + off0.25 + tp4',
      strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.25, tpAtrMult: 4 }),
      config: { ...base, maxHoldDecisionBars: 18 },
    },
  ];

  for (const combo of combos) {
    const cg = buildCgView(dataset, combo.config.cgPublishLagMs);
    const result = runBacktest({
      strategy: combo.strategy,
      minuteCandles: minutes,
      cg,
      config: combo.config,
      fundingRateProvider: fundingProvider,
    });
    const metrics = computeMetrics(result);

    console.log(`\n===== ${combo.label} =====`);
    console.log(formatMetrics(combo.strategy.id, metrics));
    const { is, oos } = splitTradesByTs(result.trades, splitTs);
    console.log(`  IS : ${brief(is)} | OOS: ${brief(oos)}`);
    console.log(`  L: ${brief(result.trades.filter(t => t.side === 'long'))} | S: ${brief(result.trades.filter(t => t.side === 'short'))}`);

    const byMonth = new Map<string, Trade[]>();
    for (const t of result.trades) {
      const key = monthKey(t.exitTs);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(t);
    }
    for (const [month, trades] of [...byMonth.entries()].sort()) {
      console.log(`    ${month}: ${brief(trades)}`);
    }
  }
}

main();
