// Generic single-pair backtest using VP-SMC strategy.
// Usage: npx tsx src/backtest/cli/single-pair.ts <SYMBOL> [days] [maxStopAtrPct] [slippagePct]
// Default: 365 days, maxStopAtrPct=5.0, slippagePct=0.25

import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { btcVpSmc, DEFAULT_BTC_VP_SMC } from '../../strategies/btc-vp-smc';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  const days = parseInt(process.argv[3] ?? '365', 10);
  const maxStopAtrPct = parseFloat(process.argv[4] ?? '5.0');
  const slippagePct = parseFloat(process.argv[5] ?? '0.25');

  if (!symbol) {
    console.error('usage: single-pair.ts <SYMBOL> [days=365] [maxStopAtrPct=5.0] [slippagePct=0.25]');
    process.exit(1);
  }

  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;

  const params = { ...DEFAULT_BTC_VP_SMC, maxStopAtrPct };
  const strategy = btcVpSmc(params);

  console.log(`== single-pair backtest: ${symbol} ==`);
  console.log(`== ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ==`);
  console.log(`== params: maxStopAtrPct=${maxStopAtrPct}, slippagePct=${slippagePct} ==\n`);

  const r = await runBacktest(strategy, {
    symbol,
    startTs,
    endTs,
    startEquity: 50_000,
    takerFeeRate: 0.00055,
    makerFeeRate: 0.0002,
    slippagePct,
    riskPctBase: 0.6,
    leverage: 10,
    tp1SlMode: 'no_move' as const,
    bePlusBufferPct: 0.10,
  });

  console.log(formatMetrics(symbol, r.metrics));

  if (r.trades.length > 0) {
    console.log('\nlast 20 trades:');
    const tail = r.trades.slice(-20);
    for (const t of tail) {
      console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)}  ${t.side.toUpperCase().padEnd(5)}  entry ${t.entry.toFixed(4)} → exit ${t.exit.toFixed(4)}  R=${t.pnlR.toFixed(2).padStart(6)}  (${t.exitReason})`);
    }
  } else {
    console.log('\nno trades fired.');
  }

  await closePg();
}

main().catch(async (e) => {
  log.error('single-pair backtest failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
