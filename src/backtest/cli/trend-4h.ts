import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { trend4h, DEFAULT_TREND_4H } from '../strategies/trend-4h';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'OPUSDT',
  'NEARUSDT', 'AVAXUSDT', 'SUIUSDT', 'XLMUSDT', 'TAOUSDT',
];
const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.05,
  riskPctBase: 0.6,
  leverage: 10,
  decisionTf: '240m' as const,
};

async function main() {
  const days = parseInt(process.argv[2] ?? '365', 10);
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;
  const strategy = trend4h(DEFAULT_TREND_4H);
  console.log(`== ${strategy.name} ==`);
  console.log(`== ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ==\n`);

  const all: Array<{ symbol: string; trades: number; wr: number; totalR: number; pf: number; mdd: number; expR: number }> = [];

  for (const symbol of SYMBOLS) {
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    console.log(formatMetrics(symbol, r.metrics));
    if (r.trades.length > 0 && r.trades.length <= 30) {
      console.log('trades:');
      for (const t of r.trades) {
        console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry ${t.entry.toFixed(4)} → exit ${t.exit.toFixed(4)}  R:${t.pnlR.toFixed(2)}  (${t.exitReason})`);
      }
    }
    all.push({
      symbol, trades: r.metrics.trades, wr: r.metrics.winRate,
      totalR: r.metrics.totalR, pf: r.metrics.profitFactor,
      mdd: r.metrics.maxDDPct, expR: r.metrics.expectancyR,
    });
    console.log('');
  }

  console.log('==== AGGREGATE ====');
  console.log('symbol     T   WR    totR   PF    MDD%   expR');
  let totalTrades = 0, totalRsum = 0, sumWins = 0, sumLosses = 0;
  for (const r of all) {
    console.log(
      `${r.symbol.padEnd(9)} ${String(r.trades).padStart(3)} ${(r.wr*100).toFixed(0).padStart(4)}% ${r.totalR.toFixed(2).padStart(7)} ${(r.pf === Infinity ? '∞' : r.pf.toFixed(2)).padStart(5)} ${r.mdd.toFixed(1).padStart(6)} ${r.expR.toFixed(3).padStart(7)}`
    );
    totalTrades += r.trades;
    totalRsum += r.totalR;
  }
  console.log(`TOTAL    ${String(totalTrades).padStart(5)}        ${totalRsum.toFixed(2).padStart(7)}`);

  await closePg();
}

main().catch(async e => {
  log.error('backtest-trend-4h failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
