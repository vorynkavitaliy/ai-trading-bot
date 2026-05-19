// Backfill 1h+4h candles for major pairs (BTC/ETH/SOL/XRP) back to 2020-03 (Bybit linear launch).
// Required for multi-year walk-forward backtest validation.
import { backfillCandles } from '../../data/backfill';
import { close as closePg, query } from '../../core/db';
import { log } from '../../core/logger';

const MAJORS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
const TFS = ['60m', '240m'];
const FROM_MS = Date.parse('2020-03-01T00:00:00Z');
const TO_MS = Date.now();

async function main() {
  console.log(`Backfilling ${MAJORS.join(', ')} on ${TFS.join('/')} from ${new Date(FROM_MS).toISOString().slice(0,10)} to now`);
  for (const symbol of MAJORS) {
    for (const tf of TFS) {
      log.info('starting deep backfill', { symbol, tf });
      await backfillCandles(symbol, tf, FROM_MS, TO_MS);
    }
  }
  // Print final coverage
  console.log('\n=== Final coverage ===');
  const r = await query<any>(
    `SELECT symbol, tf, COUNT(*) as bars,
            MIN(ts)::bigint as min_ts, MAX(ts)::bigint as max_ts
     FROM candles
     WHERE symbol = ANY($1) AND tf = ANY($2)
     GROUP BY symbol, tf ORDER BY symbol, tf`,
    [MAJORS, TFS]
  );
  for (const row of r.rows) {
    const min = new Date(Number(row.min_ts)).toISOString().slice(0,10);
    const max = new Date(Number(row.max_ts)).toISOString().slice(0,10);
    const days = Math.round((Number(row.max_ts) - Number(row.min_ts)) / 86400000);
    console.log(`  ${row.symbol.padEnd(10)} tf=${row.tf.padEnd(5)} bars=${String(row.bars).padStart(7)}  ${min} → ${max}  (${days}d)`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
