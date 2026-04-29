import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { btcRangePro, DEFAULT_BTC_RANGE_PRO } from '../strategies/btc-range-pro';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.05,
  riskPctBase: 0.6,
  leverage: 10,
};

async function main() {
  // Coinglass coverage starts ~85d ago; use that as test window.
  const days = parseInt(process.argv[2] ?? '85', 10);
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;
  const strategy = btcRangePro(DEFAULT_BTC_RANGE_PRO);
  console.log(`== ${strategy.name} ==`);
  console.log(`== ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ==\n`);
  const r = await runBacktest(strategy, { symbol: 'BTCUSDT', startTs, endTs, ...COMMON });
  console.log(formatMetrics('BTCUSDT', r.metrics));
  if (r.trades.length > 0) {
    console.log('all trades:');
    for (const t of r.trades) {
      console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry ${t.entry.toFixed(2)} → exit ${t.exit.toFixed(2)}  R:${t.pnlR.toFixed(2)}  (${t.exitReason})`);
    }
  }
  await closePg();
}

main().catch(async e => {
  log.error('backtest-btc-pro failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
