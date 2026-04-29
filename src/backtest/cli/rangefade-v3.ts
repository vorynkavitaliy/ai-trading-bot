import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { rangeFadeV3, DEFAULT_RANGE_FADE_V3 } from '../strategies/range-fade-v3';
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
  // Coinglass data only goes back ~85 days, so 90d window is the right test range.
  const days = parseInt(process.argv[2] ?? '85', 10);
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;
  const strategy = rangeFadeV3(DEFAULT_RANGE_FADE_V3);

  console.log(`== ${strategy.name} ==`);
  console.log(`== ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ==\n`);

  for (const symbol of SYMBOLS) {
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    console.log(formatMetrics(symbol, r.metrics));
    if (r.trades.length > 0) {
      console.log('all trades:');
      for (const t of r.trades) {
        console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry ${t.entry.toFixed(2)} → exit ${t.exit.toFixed(2)}  R:${t.pnlR.toFixed(2)}  (${t.exitReason})`);
      }
    } else {
      console.log('(no trades)');
    }
    console.log('');
  }
  await closePg();
}

main().catch(async e => {
  log.error('backtest-rangefade-v3 failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
