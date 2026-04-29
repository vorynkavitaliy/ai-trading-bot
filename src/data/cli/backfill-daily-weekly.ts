// Quick backfill for daily and weekly OHLCV across the 10-pair v3 universe.
// 1D × 365 = 365 candles per pair. 1W × 52 = 52 candles per pair.
// One API call per (pair, tf) since limit=1000 covers it.

import { query } from '../lib/db';
import { fetchKlines, BybitKline, delay } from '../data/bybit-public';
import { close as closePg } from '../lib/db';
import { log } from '../lib/logger';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'OPUSDT',
  'NEARUSDT', 'AVAXUSDT', 'SUIUSDT', 'XLMUSDT', 'TAOUSDT',
];
const TFS = ['1D', '1W'];

async function insertCandles(symbol: string, tf: string, rows: BybitKline[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values: string[] = [];
  const params: any[] = [];
  rows.forEach((r, idx) => {
    const b = idx * 9;
    values.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`
    );
    params.push(symbol, tf, r.startTime, r.open, r.high, r.low, r.close, r.volume, r.turnover);
  });
  const sql = `INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
               VALUES ${values.join(', ')}
               ON CONFLICT (symbol, tf, ts) DO NOTHING`;
  const r = await query(sql, params);
  return r.rowCount;
}

async function main() {
  // 2 years back to give weekly EMA50 some warmup; daily EMA200 needs ~200 days.
  const daysBack = parseInt(process.argv[2] ?? '730', 10);
  const now = Date.now();
  const fromMs = now - daysBack * 24 * 60 * 60_000;
  log.info('=== daily/weekly backfill ===', {
    daysBack, fromIso: new Date(fromMs).toISOString(), symbols: SYMBOLS.length, tfs: TFS,
  });
  for (const symbol of SYMBOLS) {
    for (const tf of TFS) {
      const candles = await fetchKlines(symbol, tf, fromMs, now);
      const inserted = await insertCandles(symbol, tf, candles);
      const r = await query<{ c: string; first: string; last: string }>(
        `SELECT COUNT(*)::text AS c, MIN(ts)::text AS first, MAX(ts)::text AS last
         FROM candles WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );
      const row = r.rows[0];
      log.info('done', {
        symbol, tf, fetched: candles.length, inserted, total: row.c,
        first: row.first ? new Date(parseInt(row.first, 10)).toISOString().slice(0, 10) : null,
        last: row.last ? new Date(parseInt(row.last, 10)).toISOString().slice(0, 10) : null,
      });
      await delay(150); // gentle pace
    }
  }
  await closePg();
  log.info('=== daily/weekly backfill complete ===');
}

main().catch(async e => {
  log.error('daily-weekly backfill failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
