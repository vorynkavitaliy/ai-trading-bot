/**
 * Live-policy experiments for the 2026-06-10 src/ migration — answers two questions
 * the migration audit left open, on the SAME engine that validated the portfolio:
 *
 * 1. CG freshness. The validated runs used cgPublishLagMs=120s > gapMs=60s, so the
 *    "current" CG point at decision D was the bucket closed at D−4h. The repaired
 *    live pipeline (coinglass-backfill upsert fix) reads the FINAL value of the
 *    bucket closed AT D (cg-incremental finalizes it ~1 min after close, before
 *    scan-decide reads). lag0 models the fixed live information set.
 *
 * 2. Funding-window policy. Live risk-guard blocks entries ±10 min around 00/08/16
 *    UTC — exactly where the top-of-hour cron lands — so signals at 3 of 6 daily
 *    boundaries either retry at +1h on a stale anchor (defer) or die (drop).
 *    The validated backtest had no funding window at all (take).
 *
 * Variants (all market-entry offset-0 — what live actually does — except the
 * `validated` regression anchor which reproduces the committed +64.10%):
 *   validated         offset 0.3/liq-on BTC + 0.3 alts, lag120, take
 *   market-lag120     offset 0, lag120, take
 *   market-lag0       offset 0, lag0,   take
 *   market-lag0-defer offset 0, lag0,   +1h activation delay at 00/08/16
 *   market-lag0-drop  offset 0, lag0,   signals at 00/08/16 dropped
 *
 * Each variant runs on the full window + older/recent halves (robustness).
 */
import { readNdjson } from '../../data/store';
import { Candle } from '../../data/types';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { cgSlowFadeBtcAware } from '../../strategies/cg-slow-fade-btc';
import { CgView } from '../cg-view';
import { buildFundingProvider, clampMinutesToCgWindow, loadDataset } from '../dataset';
import { PortfolioConfig, PortfolioLegInput, runPortfolio } from '../portfolio-engine';
import { DEFAULT_CONFIG, Strategy } from '../types';

const HOUR_MS = 3_600_000;
const EIGHT_H_MS = 8 * HOUR_MS;

interface Variant {
  label: string;
  offsetAtr: number | 'validated';
  publishLagMs: number;
  fundingPolicy: 'take' | 'defer' | 'drop';
}

const VARIANTS: Variant[] = [
  { label: 'validated', offsetAtr: 'validated', publishLagMs: 120_000, fundingPolicy: 'take' },
  { label: 'market-lag120', offsetAtr: 0, publishLagMs: 120_000, fundingPolicy: 'take' },
  { label: 'market-lag0', offsetAtr: 0, publishLagMs: 0, fundingPolicy: 'take' },
  { label: 'market-lag0-defer', offsetAtr: 0, publishLagMs: 0, fundingPolicy: 'defer' },
  { label: 'market-lag0-drop', offsetAtr: 0, publishLagMs: 0, fundingPolicy: 'drop' },
  // The EXACT live configuration after the 2026-06-10 fixes: market entry,
  // one-bucket CG lag (validated info set), +1h defer at funding boundaries.
  { label: 'market-lag120-defer', offsetAtr: 0, publishLagMs: 120_000, fundingPolicy: 'defer' },
];

function isFundingBoundary(decisionTs: number): boolean {
  return (decisionTs - DEFAULT_CONFIG.gapMs) % EIGHT_H_MS === 0;
}

function buildLegs(variant: Variant, window: 'full' | 'older' | 'recent'): PortfolioLegInput[] {
  const btcMinutes = readNdjson<Candle>('bybit_BTCUSDT_1m');
  const btcDataset = loadDataset('BTC', 'BTCUSDT', '4h');

  const off = variant.offsetAtr;
  const legsSpec: Array<[string, string, () => Strategy]> = [
    ['BTC', 'BTCUSDT', () =>
      off === 'validated'
        ? cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 })
        : cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: off })],
    ['ETH', 'ETHUSDT', () =>
      off === 'validated'
        ? cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true })
        : cgSlowFadeBtcAware({ btcMode: 'trend', shortsOnly: true, entryOffsetAtr: off })],
    ['SOL', 'SOLUSDT', () =>
      off === 'validated'
        ? cgSlowFadeBtcAware({ btcMode: 'signal' })
        : cgSlowFadeBtcAware({ btcMode: 'signal', entryOffsetAtr: off })],
    ['XRP', 'XRPUSDT', () =>
      off === 'validated'
        ? cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true })
        : cgSlowFadeBtcAware({ btcMode: 'signal', shortsOnly: true, entryOffsetAtr: off })],
  ];

  return legsSpec.map(([coin, pair, factory]) => {
    const dataset = loadDataset(coin, pair, '4h');
    const mergedInputs = [
      ...dataset.cgInputs,
      { name: 'btcFunding', intervalMs: 4 * HOUR_MS, points: btcDataset.fundingPoints },
      { name: 'btcLsTopPosition', intervalMs: 4 * HOUR_MS, points: btcDataset.cgInputs.find(i => i.name === 'lsTopPosition')!.points },
      { name: 'btcLiq', intervalMs: 4 * HOUR_MS, points: btcDataset.cgInputs.find(i => i.name === 'liq')!.points },
    ];
    let minutes = clampMinutesToCgWindow(dataset, variant.publishLagMs);
    if (window !== 'full') {
      const midTs = minutes[0].ts + (minutes[minutes.length - 1].ts - minutes[0].ts) / 2;
      minutes = window === 'older' ? minutes.filter(m => m.ts < midTs) : minutes.filter(m => m.ts >= midTs);
    }
    return {
      pair,
      strategy: factory(),
      minutes,
      cg: new CgView(mergedInputs, variant.publishLagMs),
      fundingRateProvider: buildFundingProvider(dataset.fundingPoints, variant.publishLagMs, 4 * HOUR_MS),
      auxMinutes: pair === 'BTCUSDT' ? undefined : btcMinutes,
      riskPctPerTrade: pair === 'BTCUSDT' ? 1.0 : 0.5,
    };
  });
}

function main(): void {
  console.log('variant                 window  P&L%      ann%      maxDD%   worstDay  trades  WR%    PF     defer/drop@funding');
  for (const variant of VARIANTS) {
    for (const window of ['full', 'older', 'recent'] as const) {
      const legs = buildLegs(variant, window);
      const config: PortfolioConfig = {
        ...DEFAULT_CONFIG,
        cgPublishLagMs: variant.publishLagMs,
        maxHoldDecisionBars: 12,
        maxParallelPositions: 4,
        cooldownAfterSlMs: 12 * HOUR_MS,
        cooldownAfterTpMs: 4 * HOUR_MS,
        riskPctPerTrade: 0.5,
        entryDelayMs: variant.fundingPolicy === 'defer'
          ? (ts: number) => (isFundingBoundary(ts) ? HOUR_MS : 0)
          : undefined,
        skipEntryAt: variant.fundingPolicy === 'drop'
          ? (ts: number) => isFundingBoundary(ts)
          : undefined,
      };
      const result = runPortfolio(legs, config);
      const periodDays = result.daily.length;
      const annualized = (Math.pow(1 + result.returnPct / 100, 365 / Math.max(periodDays, 1)) - 1) * 100;
      const wins = result.trades.filter(t => t.netR > 0);
      const losses = result.trades.filter(t => t.netR <= 0);
      const grossWin = wins.reduce((s, t) => s + t.netR, 0);
      const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
      const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;
      const wr = result.trades.length > 0 ? (wins.length / result.trades.length) * 100 : 0;
      const affected = result.trades.filter(t => isFundingBoundary(t.placedTs)).length;
      console.log(
        `${variant.label.padEnd(22)}  ${window.padEnd(6)}  ${result.returnPct.toFixed(2).padStart(7)}  ${annualized.toFixed(2).padStart(7)}  ` +
        `${(-result.maxDrawdownPct).toFixed(2).padStart(7)}  ${result.worstDailyPct.toFixed(2).padStart(7)}   ${String(result.trades.length).padStart(4)}  ` +
        `${wr.toFixed(1).padStart(5)}  ${Number.isFinite(pf) ? pf.toFixed(2).padStart(5) : '  inf'}   ${affected}`,
      );
    }
  }
}

main();
