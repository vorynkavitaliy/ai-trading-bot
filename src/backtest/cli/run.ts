import { runBacktest } from '../engine';
import { runWalkforward, formatWalkforward } from '../walkforward';
import { combined } from '../strategies/combined';
import { rangeFade } from '../strategies/range-fade';
import { trendPullback } from '../strategies/trend-pullback';
import { formatMetrics } from '../metrics';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

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
  const mode = process.argv[2] ?? 'combined-1y';
  const days = parseInt(process.argv[3] ?? '365', 10);
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;

  // Pick strategy
  let strategy;
  if (mode.startsWith('combined')) strategy = combined();
  else if (mode.startsWith('range')) strategy = rangeFade();
  else if (mode.startsWith('trend')) strategy = trendPullback();
  else {
    log.error('unknown mode', { mode });
    process.exit(1);
  }

  console.log(`== strategy: ${strategy.name} ==`);
  console.log(`== window: ${days} days, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ==\n`);

  if (mode.endsWith('-walkforward') || mode.endsWith('-wf')) {
    for (const symbol of SYMBOLS) {
      const rep = await runWalkforward(strategy, {
        symbol, startTs, endTs, windowDays: 30, ...COMMON,
      });
      console.log(formatWalkforward(rep));
      console.log('');
    }
  } else {
    for (const symbol of SYMBOLS) {
      const r = await runBacktest(strategy, {
        symbol, startTs, endTs, ...COMMON,
      });
      console.log(formatMetrics(symbol, r.metrics));
      console.log(`first 5 trades:`);
      for (const t of r.trades.slice(0, 5)) {
        console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} ` +
          `entry ${t.entry.toFixed(2)} exit ${t.exit.toFixed(2)} R:${t.pnlR.toFixed(2)} (${t.exitReason})`);
      }
      console.log('');
    }
  }

  await closePg();
}

main().catch(async (e) => {
  log.error('backtest-run failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
