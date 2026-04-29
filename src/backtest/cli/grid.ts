import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { rangeFade, DEFAULT_RANGE_FADE } from '../strategies/range-fade';
import { trendPullback, DEFAULT_TREND_PULLBACK } from '../strategies/trend-pullback';
import { donchianBreakout, DEFAULT_DONCHIAN } from '../strategies/donchian-breakout';
import { extremeRsi, DEFAULT_EXTREME_RSI } from '../strategies/extreme-rsi';
import { sanityAlwaysLong } from '../strategies/sanity-always';
import { buyAndHold, formatBaseline } from '../baseline';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';
import { Strategy } from '../types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.05,
  riskPctBase: 0.6,
  leverage: 10,
};

async function main() {
  const days = parseInt(process.argv[2] ?? '365', 10);
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;

  console.log(`\n#### BACKTEST GRID — ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ####\n`);

  // Baseline first
  console.log('---- BASELINE (buy & hold) ----');
  for (const symbol of SYMBOLS) {
    const r = await buyAndHold(symbol, startTs, endTs);
    console.log(formatBaseline(r));
    console.log('');
  }

  const strategies: Strategy[] = [
    sanityAlwaysLong(),                                                     // engine self-check
    rangeFade(DEFAULT_RANGE_FADE),
    rangeFade({ ...DEFAULT_RANGE_FADE, slAtrMult: 1.0, minStopAtr: 0.5 }),
    trendPullback(DEFAULT_TREND_PULLBACK),
    trendPullback({ ...DEFAULT_TREND_PULLBACK, slAtrMult: 1.5, minStopAtr: 0.8, tp1R: 2, tp2R: 4 }),
    donchianBreakout(DEFAULT_DONCHIAN),
    donchianBreakout({ ...DEFAULT_DONCHIAN, adxMin: 25, slAtrMult: 2.0, tp1R: 1.0, tp2R: 3.0 }),
    extremeRsi(DEFAULT_EXTREME_RSI),
    extremeRsi({ ...DEFAULT_EXTREME_RSI, rsiLow: 18, rsiHigh: 82, slAtrMult: 2.0, tp1R: 1.5, tp2R: 4.0 }),
  ];

  const summary: Array<{
    strategy: string; symbol: string; trades: number; wr: number;
    totalR: number; pf: number; mdd: number; expectancy: number;
  }> = [];

  for (const strat of strategies) {
    console.log(`\n---- ${strat.name} ----`);
    for (const symbol of SYMBOLS) {
      const r = await runBacktest(strat, { symbol, startTs, endTs, ...COMMON });
      console.log(formatMetrics(symbol, r.metrics));
      summary.push({
        strategy: strat.name, symbol,
        trades: r.metrics.trades, wr: r.metrics.winRate,
        totalR: r.metrics.totalR,
        pf: r.metrics.profitFactor,
        mdd: r.metrics.maxDDPct,
        expectancy: r.metrics.expectancyR,
      });
      console.log('');
    }
  }

  // Final ranking
  console.log('\n#### SUMMARY (ranked by totalR) ####');
  console.log(
    [
      'strategy'.padEnd(70),
      'sym'.padEnd(8),
      'T'.padStart(4),
      'WR'.padStart(6),
      'totR'.padStart(8),
      'PF'.padStart(6),
      'MDD%'.padStart(7),
      'expR'.padStart(7),
    ].join(' ')
  );
  summary.sort((a, b) => b.totalR - a.totalR);
  for (const r of summary) {
    console.log(
      [
        r.strategy.padEnd(70),
        r.symbol.padEnd(8),
        String(r.trades).padStart(4),
        `${(r.wr * 100).toFixed(1)}%`.padStart(6),
        r.totalR.toFixed(2).padStart(8),
        (r.pf === Infinity ? '∞' : r.pf.toFixed(2)).padStart(6),
        r.mdd.toFixed(1).padStart(7),
        r.expectancy.toFixed(3).padStart(7),
      ].join(' ')
    );
  }

  await closePg();
}

main().catch(async (e) => {
  log.error('backtest-grid failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
