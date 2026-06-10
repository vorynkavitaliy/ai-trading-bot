import { createLogger } from '../../core/logger';
import { cgSlowFade } from '../../strategies/cg-slow-fade';
import { atr } from '../indicators';
import { buildCgView, buildFundingProvider, clampMinutesToCgWindow, loadBtcDataset } from '../dataset';
import { runBacktest } from '../engine';
import { BacktestConfig, DEFAULT_CONFIG, OrderIntent, Strategy, StrategyContext, Trade } from '../types';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sumR(trades: readonly Trade[]): number {
  return trades.reduce((acc, t) => acc + t.netR, 0);
}

function randomEntryStrategy(signalRate: number, rng: () => number): Strategy {
  return {
    id: 'random',
    decisionIntervalMs: 4 * HOUR_MS,
    warmupBars: 190,
    decide(ctx: StrategyContext): OrderIntent | null {
      if (rng() >= signalRate) return null;

      const atrValue = atr(ctx.bars, 14);
      if (atrValue === null || atrValue <= 0) return null;

      const side = rng() < 0.5 ? 'long' : 'short';
      const price = ctx.lastPrice;
      const offset = 0.3 * atrValue;
      const limitPrice = side === 'long' ? price - offset : price + offset;
      const slPrice = side === 'long' ? limitPrice - 2 * atrValue : limitPrice + 2 * atrValue;
      const tpPrice = side === 'long' ? limitPrice + 3.5 * atrValue : limitPrice - 3.5 * atrValue;

      return { side, limitPrice, slPrice, tpPrice, ttlMinutes: 230, tag: 'random' };
    },
  };
}

interface Runner {
  run(strategy: Strategy, config?: BacktestConfig): { trades: Trade[]; placed: number; decisions: number };
}

function main(): void {
  const logger = createLogger('validate');
  const base: BacktestConfig = { ...DEFAULT_CONFIG, maxHoldDecisionBars: 12 };

  const dataset = loadBtcDataset('4h');
  const minutes = clampMinutesToCgWindow(dataset, base.cgPublishLagMs);
  const fromTs = minutes[0].ts;
  const toTs = minutes[minutes.length - 1].ts;

  const runner: Runner = {
    run(strategy, config = base) {
      const cg = buildCgView(dataset, config.cgPublishLagMs);
      const provider = buildFundingProvider(dataset.fundingPoints, config.cgPublishLagMs, 4 * HOUR_MS);
      const result = runBacktest({ strategy, minuteCandles: minutes, cg, config, fundingRateProvider: provider });
      return { trades: result.trades, placed: result.placedOrders, decisions: result.decisions };
    },
  };

  const mainStrategy = () => cgSlowFade({ useLiqMomentum: true, entryOffsetAtr: 0.3 });

  logger.info('=== base run ===');
  const baseRun = runner.run(mainStrategy());
  const baseSumR = sumR(baseRun.trades);
  const signalRate = baseRun.placed / baseRun.decisions;
  console.log(`BASE: trades=${baseRun.trades.length} sumR=${baseSumR.toFixed(2)} signalRate=${(signalRate * 100).toFixed(1)}% (placed ${baseRun.placed} / decisions ${baseRun.decisions})`);

  console.log('\n=== 1) ROLLING WINDOWS ===');
  for (const windowDays of [7, 30, 90]) {
    const stepMs = windowDays * DAY_MS;
    let positive = 0;
    let total = 0;
    let worst = Infinity;
    let best = -Infinity;
    const cells: string[] = [];
    for (let start = fromTs; start + stepMs <= toTs; start += stepMs) {
      const windowTrades = baseRun.trades.filter(t => t.placedTs >= start && t.placedTs < start + stepMs);
      const r = sumR(windowTrades);
      total++;
      if (r > 0) positive++;
      worst = Math.min(worst, r);
      best = Math.max(best, r);
      if (windowDays >= 30) cells.push(`${new Date(start).toISOString().slice(0, 10)}: ${r >= 0 ? '+' : ''}${r.toFixed(1)}R(${windowTrades.length})`);
    }
    console.log(`${windowDays}d windows: ${positive}/${total} positive (${((positive / total) * 100).toFixed(0)}%), worst=${worst.toFixed(1)}R best=${best.toFixed(1)}R`);
    if (cells.length > 0) console.log(`  ${cells.join(' | ')}`);
  }

  console.log('\n=== 2) PERMUTATION TEST (random entries, same exits/frequency) ===');
  const PERMS = 150;
  const randomSums: number[] = [];
  for (let i = 0; i < PERMS; i++) {
    const rng = mulberry32(1000 + i);
    const run = runner.run(randomEntryStrategy(signalRate, rng));
    randomSums.push(sumR(run.trades));
  }
  randomSums.sort((a, b) => a - b);
  const beat = randomSums.filter(r => r >= baseSumR).length;
  const pValue = beat / PERMS;
  const randMean = randomSums.reduce((a, b) => a + b, 0) / PERMS;
  const randP95 = randomSums[Math.floor(PERMS * 0.95)];
  const randMax = randomSums[PERMS - 1];
  console.log(`random runs=${PERMS}: mean=${randMean.toFixed(1)}R p95=${randP95.toFixed(1)}R max=${randMax.toFixed(1)}R`);
  console.log(`strategy=${baseSumR.toFixed(1)}R -> p-value=${pValue.toFixed(3)} (${beat}/${PERMS} random runs >= strategy)`);

  console.log('\n=== 3) BOOTSTRAP (10k resamples of trade R) ===');
  const rng = mulberry32(42);
  const rs = baseRun.trades.map(t => t.netR);
  const bootSums: number[] = [];
  for (let i = 0; i < 10_000; i++) {
    let s = 0;
    for (let k = 0; k < rs.length; k++) s += rs[Math.floor(rng() * rs.length)];
    bootSums.push(s);
  }
  bootSums.sort((a, b) => a - b);
  const ci5 = bootSums[Math.floor(0.05 * bootSums.length)];
  const ci95 = bootSums[Math.floor(0.95 * bootSums.length)];
  const probNegative = bootSums.filter(s => s <= 0).length / bootSums.length;
  console.log(`sumR 90% CI: [${ci5.toFixed(1)}R, ${ci95.toFixed(1)}R], P(period <= 0) = ${(probNegative * 100).toFixed(2)}%`);

  console.log('\n=== 4) SIGNAL ABLATION ===');
  const ablations: Array<[string, Strategy]> = [
    ['lsTopPos only', cgSlowFade({ entryOffsetAtr: 0.3, fundingPctHi: 1.1, useLiqMomentum: false })],
    ['funding only', cgSlowFade({ entryOffsetAtr: 0.3, lsPctHi: 1.1, lsPctLo: -0.1, useLiqMomentum: false })],
    ['liq only', cgSlowFade({ entryOffsetAtr: 0.3, lsPctHi: 1.1, lsPctLo: -0.1, fundingPctHi: 1.1, useLiqMomentum: true })],
    ['ls+funding (no liq)', cgSlowFade({ entryOffsetAtr: 0.3, useLiqMomentum: false })],
    ['shorts disabled (long-only signals)', cgSlowFade({ entryOffsetAtr: 0.3, lsPctHi: 1.1, fundingPctHi: 1.1, useLiqMomentum: false })],
  ];
  for (const [label, strategy] of ablations) {
    const run = runner.run(strategy);
    const s = sumR(run.trades);
    const exp = run.trades.length ? s / run.trades.length : 0;
    console.log(`${label.padEnd(36)} trades=${String(run.trades.length).padStart(3)} sumR=${s.toFixed(1).padStart(7)}R expR=${exp.toFixed(3)}`);
  }

  console.log('\n=== 5) COST STRESS ===');
  const costConfigs: Array<[string, BacktestConfig]> = [
    ['fees x2', { ...base, makerFee: 0.0004, takerFee: 0.0011 }],
    ['slip 5bps', { ...base, slSlippageBps: 5 }],
    ['slip 10bps', { ...base, slSlippageBps: 10 }],
    ['fees x2 + slip 10bps', { ...base, makerFee: 0.0004, takerFee: 0.0011, slSlippageBps: 10 }],
  ];
  for (const [label, config] of costConfigs) {
    const run = runner.run(mainStrategy(), config);
    const s = sumR(run.trades);
    console.log(`${label.padEnd(24)} trades=${run.trades.length} sumR=${s.toFixed(1)}R expR=${(s / run.trades.length).toFixed(3)}`);
  }

  console.log('\n=== 6) PARAMETER CUBE (3x3x3 around D) ===');
  let positiveCells = 0;
  let totalCells = 0;
  for (const lsPctHi of [0.93, 0.95, 0.97]) {
    for (const slAtrMult of [1.75, 2.0, 2.25]) {
      for (const tpAtrMult of [3.0, 3.5, 4.0]) {
        const strategy = cgSlowFade({
          useLiqMomentum: true,
          entryOffsetAtr: 0.3,
          lsPctHi,
          lsPctLo: Math.round((1 - lsPctHi) * 100) / 100,
          fundingPctHi: lsPctHi,
          slAtrMult,
          tpAtrMult,
        });
        const run = runner.run(strategy);
        const s = sumR(run.trades);
        totalCells++;
        if (s > 0) positiveCells++;
        console.log(`ls${lsPctHi} sl${slAtrMult} tp${tpAtrMult}: n=${String(run.trades.length).padStart(3)} sumR=${s.toFixed(1).padStart(7)}R expR=${(run.trades.length ? s / run.trades.length : 0).toFixed(3)}`);
      }
    }
  }
  console.log(`cube: ${positiveCells}/${totalCells} positive (${((positiveCells / totalCells) * 100).toFixed(0)}%)`);
}

main();
