import { query } from '../lib/db';
import { log } from '../lib/logger';
import { fetchKlines, fetchFunding, TF_MS, delay, BybitKline } from './bybit-public';

// v3 universe: 10 pairs (BTC/ETH primary, 8 alts for extra setups)
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'OPUSDT',
  'NEARUSDT', 'AVAXUSDT', 'SUIUSDT', 'XLMUSDT', 'TAOUSDT',
];
const TFS = ['1m', '5m', '15m', '60m', '240m'];

async function insertCandles(
  symbol: string,
  tf: string,
  rows: BybitKline[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 1000; // 1000 rows × 9 params = 9000 params, well under Postgres' 65535 limit
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: any[] = [];
    chunk.forEach((r, idx) => {
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
    total += r.rowCount;
  }
  return total;
}

async function insertFunding(symbol: string, rows: { ts: number; rate: number }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values: string[] = [];
  const params: any[] = [];
  rows.forEach((r, idx) => {
    const base = idx * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(symbol, r.ts, r.rate);
  });
  const sql = `INSERT INTO funding_history (symbol, ts, rate)
               VALUES ${values.join(', ')}
               ON CONFLICT (symbol, ts) DO NOTHING`;
  const r = await query(sql, params);
  return r.rowCount;
}

async function backfillCandles(symbol: string, tf: string, fromMs: number, toMs: number) {
  const stepMs = TF_MS[tf] * 1000; // 1000 candles per request
  let cursor = fromMs;
  let totalInserted = 0;
  let batches = 0;
  while (cursor < toMs) {
    const windowEnd = Math.min(cursor + stepMs, toMs);
    let candles: BybitKline[];
    try {
      candles = await fetchKlines(symbol, tf, cursor, windowEnd);
    } catch (e: any) {
      log.warn('fetchKlines failed, retrying after 1s', {
        symbol, tf, cursor, err: e.message,
      });
      await delay(1000);
      candles = await fetchKlines(symbol, tf, cursor, windowEnd);
    }
    if (candles.length === 0) {
      // empty window — skip ahead
      cursor = windowEnd + 1;
      continue;
    }
    const inserted = await insertCandles(symbol, tf, candles);
    totalInserted += inserted;
    batches++;
    // advance cursor past the last fetched candle
    cursor = candles[candles.length - 1].startTime + TF_MS[tf];
    if (batches % 20 === 0) {
      log.info('backfill progress', {
        symbol, tf, inserted_total: totalInserted, batches,
        cursor_iso: new Date(cursor).toISOString(),
      });
    }
    await delay(120); // ~8 req/s — well under Bybit's public limit
  }
  log.info('backfill candles done', { symbol, tf, inserted: totalInserted, batches });
}

async function backfillFunding(symbol: string, fromMs: number, toMs: number) {
  // Bybit funding has 8h cadence — ~1100 entries / year
  let cursor = fromMs;
  let totalInserted = 0;
  while (cursor < toMs) {
    // fetch up to 200 entries forward
    const windowEnd = Math.min(cursor + 200 * 8 * 60 * 60_000, toMs);
    let rows: { ts: number; rate: number }[];
    try {
      rows = await fetchFunding(symbol, cursor, windowEnd);
    } catch (e: any) {
      log.warn('fetchFunding failed, retrying', { symbol, err: e.message });
      await delay(1000);
      rows = await fetchFunding(symbol, cursor, windowEnd);
    }
    if (rows.length === 0) {
      cursor = windowEnd + 1;
      continue;
    }
    totalInserted += await insertFunding(symbol, rows);
    cursor = rows[rows.length - 1].ts + 60_000;
    await delay(120);
  }
  log.info('backfill funding done', { symbol, inserted: totalInserted });
}

export async function runBackfill(daysBack = 365): Promise<void> {
  const now = Date.now();
  const fromMs = now - daysBack * 24 * 60 * 60_000;
  log.info('=== backfill start ===', {
    daysBack, fromIso: new Date(fromMs).toISOString(), symbols: SYMBOLS, tfs: TFS,
  });
  for (const symbol of SYMBOLS) {
    for (const tf of TFS) {
      log.info('--- candles ---', { symbol, tf });
      await backfillCandles(symbol, tf, fromMs, now);
    }
    log.info('--- funding ---', { symbol });
    await backfillFunding(symbol, fromMs, now);
  }
  // Verify counts
  for (const symbol of SYMBOLS) {
    for (const tf of TFS) {
      const r = await query<{ c: string; first: string; last: string }>(
        `SELECT COUNT(*)::text AS c,
                MIN(ts)::text AS first,
                MAX(ts)::text AS last
         FROM candles WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );
      const row = r.rows[0];
      log.info('candle stats', {
        symbol, tf,
        count: row.c,
        first: row.first ? new Date(parseInt(row.first, 10)).toISOString() : null,
        last: row.last ? new Date(parseInt(row.last, 10)).toISOString() : null,
      });
    }
    const fr = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM funding_history WHERE symbol = $1`, [symbol]
    );
    log.info('funding stats', { symbol, count: fr.rows[0].c });
  }
  log.info('=== backfill done ===');
}

export async function runIncremental(): Promise<void> {
  const now = Date.now();
  for (const symbol of SYMBOLS) {
    for (const tf of TFS) {
      const r = await query<{ last: string | null }>(
        `SELECT MAX(ts)::text AS last FROM candles WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );
      const last = r.rows[0]?.last ? parseInt(r.rows[0].last, 10) : null;
      const from = last ? last + TF_MS[tf] : now - 365 * 24 * 60 * 60_000;
      if (from >= now) {
        log.debug('incremental: up-to-date', { symbol, tf });
        continue;
      }
      await backfillCandles(symbol, tf, from, now);
    }
    const fr = await query<{ last: string | null }>(
      `SELECT MAX(ts)::text AS last FROM funding_history WHERE symbol = $1`,
      [symbol]
    );
    const lastF = fr.rows[0]?.last ? parseInt(fr.rows[0].last, 10) : null;
    const fromF = lastF ? lastF + 60_000 : now - 365 * 24 * 60 * 60_000;
    if (fromF < now) {
      await backfillFunding(symbol, fromF, now);
    }
  }
}
