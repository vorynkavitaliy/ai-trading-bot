// Backfill 1W and 1m for major pairs back to listing date.
// Required for multi-year walk-forward (strategy needs 1W PWL/PWH; engine needs 1m for entry fill).
import { backfillCandles } from '../../data/backfill';
import { close as closePg, query } from '../../core/db';
import { log } from '../../core/logger';

const MAJORS_WITH_START: { symbol: string; startMs: number }[] = [
  { symbol: 'BTCUSDT', startMs: Date.parse('2020-03-25T00:00:00Z') },
  { symbol: 'ETHUSDT', startMs: Date.parse('2021-03-15T00:00:00Z') },
  { symbol: 'SOLUSDT', startMs: Date.parse('2021-10-15T00:00:00Z') },
  { symbol: 'XRPUSDT', startMs: Date.parse('2021-05-13T00:00:00Z') },
];

const TO_MS = Date.now();

async function main() {
  // 1W first (fast)
  for (const { symbol, startMs } of MAJORS_WITH_START) {
    log.info('1W backfill', { symbol });
    await backfillCandles(symbol, '1W', startMs, TO_MS);
  }

  // Then 1m (slow — ~30 min per pair)
  for (const { symbol, startMs } of MAJORS_WITH_START) {
    log.info('1m backfill (slow)', { symbol });
    await backfillCandles(symbol, '1m', startMs, TO_MS);
  }

  // Final coverage
  const r = await query<any>(
    `SELECT symbol, tf, COUNT(*) as bars, MIN(ts)::bigint as min_ts, MAX(ts)::bigint as max_ts
     FROM candles WHERE symbol = ANY($1) AND tf IN ('1W','1m')
     GROUP BY symbol, tf ORDER BY symbol, tf`,
    [MAJORS_WITH_START.map(m => m.symbol)]
  );
  console.log('\n=== Coverage ===');
  for (const row of r.rows) {
    const min = new Date(Number(row.min_ts)).toISOString().slice(0,10);
    const max = new Date(Number(row.max_ts)).toISOString().slice(0,10);
    console.log(`  ${row.symbol.padEnd(10)} tf=${row.tf.padEnd(3)} bars=${String(row.bars).padStart(8)}  ${min} → ${max}`);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
