import { createLogger } from '../../core/logger';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { splitTradesByTs } from '../metrics';
import { BacktestConfig, DEFAULT_CONFIG, Strategy, Trade } from '../types';

const HOUR_MS = 3_600_000;

function agg(trades: readonly Trade[]): { n: number; sumR: number; expR: number; pf: number; maxDD: number; wr: number } {
  let sumR = 0;
  let wins = 0;
  let gp = 0;
  let gl = 0;
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    sumR += t.netR;
    if (t.netR > 0) {
      wins++;
      gp += t.netR;
    } else gl -= t.netR;
    equity += t.netR;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  return {
    n: trades.length,
    sumR,
    expR: trades.length ? sumR / trades.length : 0,
    pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    maxDD,
    wr: trades.length ? wins / trades.length : 0,
  };
}

function row(label: string, trades: readonly Trade[], splitTs: number): string {
  const full = agg(trades);
  const { is, oos } = splitTradesByTs(trades, splitTs);
  const isM = agg(is);
  const oosM = agg(oos);
  const pf = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : 'inf');
  return [
    label,
    `n=${full.n}`,
    `expR=${full.expR.toFixed(3)}`,
    `PF=${pf(full.pf)}`,
    `dd=${full.maxDD.toFixed(1)}`,
    `wr=${(full.wr * 100).toFixed(0)}%`,
    `| IS n=${isM.n} expR=${isM.expR.toFixed(3)} PF=${pf(isM.pf)}`,
    `| OOS n=${oosM.n} expR=${oosM.expR.toFixed(3)} PF=${pf(oosM.pf)} sumR=${oosM.sumR.toFixed(1)}`,
  ].join(' ');
}

interface RunSpec {
  label: string;
  strategy: Strategy;
  config: BacktestConfig;
  filterSide?: 'long' | 'short';
}

function main(): void {
  const logger = createLogger('refine-4h');
  const base: BacktestConfig = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const dataset = loadBtcDataset('4h');
  const minutes = clampMinutesToCgWindow(dataset, base.cgPublishLagMs);
  const fundingProvider = buildFundingProvider(dataset.fundingPoints, base.cgPublishLagMs, 4 * HOUR_MS);
  const fromTs = minutes[0].ts;
  const toTs = minutes[minutes.length - 1].ts;
  const splitTs = fromTs + (toTs - fromTs) / 2;
  logger.info('refine start', { splitIso: new Date(splitTs).toISOString() });

  const best = () => cgSlowFade({ useLiqMomentum: true });

  const specs: RunSpec[] = [
    { label: 'best baseline', strategy: best(), config: base },
    { label: 'hold18', strategy: best(), config: { ...base, maxHoldDecisionBars: 18 } },
    { label: 'hold8', strategy: best(), config: { ...base, maxHoldDecisionBars: 8 } },
    { label: 'tp5', strategy: cgSlowFade({ useLiqMomentum: true, tpAtrMult: 5 }), config: base },
    { label: 'tp2.5', strategy: cgSlowFade({ useLiqMomentum: true, tpAtrMult: 2.5 }), config: base },
    { label: 'sl2.5/tp4', strategy: cgSlowFade({ useLiqMomentum: true, slAtrMult: 2.5, tpAtrMult: 4 }), config: base },
    { label: 'off0.3', strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 }), config: base },
    { label: 'off0.1', strategy: cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.1 }), config: base },
    { label: 'liq0.99', strategy: cgSlowFade({ useLiqMomentum: true, liqSpikePct: 0.99 }), config: base },
    { label: 'pctWindow120', strategy: cgSlowFade({ useLiqMomentum: true, pctWindow: 120 }), config: base },
    { label: 'pctWindow240', strategy: cgSlowFade({ useLiqMomentum: true, pctWindow: 240 }), config: base },

    { label: 'STRESS lag10m', strategy: best(), config: { ...base, cgPublishLagMs: 600_000 } },
    { label: 'STRESS lag30m', strategy: best(), config: { ...base, cgPublishLagMs: 1_800_000 } },
    { label: 'STRESS gap2m', strategy: best(), config: { ...base, gapMs: 120_000 } },
    { label: 'STRESS slip5bps', strategy: best(), config: { ...base, slSlippageBps: 5 } },
    { label: 'STRESS noFunding', strategy: best(), config: { ...base, applyFunding: false } },
    { label: 'STRESS all', strategy: best(), config: { ...base, cgPublishLagMs: 1_800_000, gapMs: 120_000, slSlippageBps: 5 } },

    { label: 'SIDE long-only', strategy: best(), config: base, filterSide: 'long' },
    { label: 'SIDE short-only', strategy: best(), config: base, filterSide: 'short' },
  ];

  for (const spec of specs) {
    const cg = buildCgView(dataset, spec.config.cgPublishLagMs);
    const provider = buildFundingProvider(dataset.fundingPoints, spec.config.cgPublishLagMs, 4 * HOUR_MS);
    void fundingProvider;
    const result = runBacktest({
      strategy: spec.strategy,
      minuteCandles: minutes,
      cg,
      config: spec.config,
      fundingRateProvider: provider,
    });
    const trades = spec.filterSide ? result.trades.filter(t => t.side === spec.filterSide) : result.trades;
    console.log(row(spec.label.padEnd(16), trades, splitTs));
  }
}

main();
