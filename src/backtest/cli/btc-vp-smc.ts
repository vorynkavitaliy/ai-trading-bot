import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { runWalkforward, formatWalkforward } from '../walkforward';
import { btcVpSmc, DEFAULT_BTC_VP_SMC } from '../strategies/btc-vp-smc';
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
  // Coinglass coverage: ~85d. Default = 85.
  // Pass any number to override (e.g. 365 for full year — Coinglass features will be null
  // outside the coverage window; strategy permissively skips those checks then).
  const days = parseInt(process.argv[2] ?? '85', 10);
  const wfFlag = process.argv[3] === 'wf';
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;
  const strategy = btcVpSmc(DEFAULT_BTC_VP_SMC);
  console.log(`== ${strategy.name} ==`);
  console.log(`== ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)}, mode=${wfFlag ? 'walk-forward' : 'single'} ==\n`);

  if (wfFlag) {
    const report = await runWalkforward(strategy, {
      symbol: 'BTCUSDT', startTs, endTs, windowDays: 30, ...COMMON,
    });
    console.log(formatWalkforward(report));
  } else {
    const r = await runBacktest(strategy, { symbol: 'BTCUSDT', startTs, endTs, ...COMMON });
    console.log(formatMetrics('BTCUSDT', r.metrics));
    if (r.trades.length > 0) {
      console.log('\nall trades:');
      for (const t of r.trades) {
        console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry ${t.entry.toFixed(2)} → exit ${t.exit.toFixed(2)}  R:${t.pnlR.toFixed(2)}  (${t.exitReason})`);
      }
    } else {
      console.log('\nno trades fired.');
    }
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('backtest-btc-vp-smc failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
