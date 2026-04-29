import { runBacktest } from '../engine';
import { runWalkforward, formatWalkforward } from '../walkforward';
import { formatMetrics } from '../metrics';
import { rangeFadeV2, DEFAULT_RANGE_FADE_V2 } from '../strategies/range-fade-v2';
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
  const days = parseInt(process.argv[2] ?? '365', 10);
  const wfFlag = process.argv[3] === 'wf';
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;
  const slAtrMult = parseFloat(process.argv[4] ?? String(DEFAULT_RANGE_FADE_V2.slAtrMult));
  const minStopAtr = parseFloat(process.argv[5] ?? String(DEFAULT_RANGE_FADE_V2.minStopAtr));
  const strategy = rangeFadeV2({ ...DEFAULT_RANGE_FADE_V2, slAtrMult, minStopAtr });
  console.log(`== ${strategy.name} ==`);
  console.log(`== ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)} ==\n`);

  if (wfFlag) {
    for (const symbol of SYMBOLS) {
      const rep = await runWalkforward(strategy, {
        symbol, startTs, endTs, windowDays: 30, ...COMMON,
      });
      console.log(formatWalkforward(rep));
      console.log('');
    }
  } else {
    for (const symbol of SYMBOLS) {
      const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
      console.log(formatMetrics(symbol, r.metrics));
      if (r.trades.length > 0) {
        console.log('all trades (showing R, exit reason):');
        for (const t of r.trades) {
          console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry ${t.entry.toFixed(2)} → exit ${t.exit.toFixed(2)}  R:${t.pnlR.toFixed(2)}  (${t.exitReason})`);
        }
      }
      console.log('');
    }
  }
  await closePg();
}

main().catch(async e => {
  log.error('backtest-rangefade-v2 failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
