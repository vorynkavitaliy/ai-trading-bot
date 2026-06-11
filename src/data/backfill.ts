import { query } from '../core/db';
import { log } from '../core/logger';
import { fetchKlines, fetchFunding, TF_MS, delay, BybitKline } from './bybit-public';
import { tier1Pairs } from '../runtime/pair-strategies';

// Ingestion universe = traded pairs PLUS BTCUSDT. BTC is NOT traded (excluded
// 2026-05-24, 0R) but IS the macro-trend reference for useBtcTrend strategies
// (8/10 live pairs, via scan-decide btcBars4h → cg-fade trendFiltersAllow). It must
// be refreshed every cycle even though it's not in tier1Pairs(), otherwise its 240m
// bars freeze and the macro filter silently gates live entries on stale data
// (regression 2026-05-25 → 2026-06-02: BTC frozen 8 days, short-biased 8 pairs).
export const SYMBOLS = [...new Set([...tier1Pairs(), 'BTCUSDT'])];
const TFS = ['1m', '5m', '15m', '60m', '240m'];

// TFs needed for live cycles AND backtest replay:
//   - 60m: live strategy decisions, indicators, VP
//   - 1D/1W: PWL/PWH structural levels
//   - 1m: required for backtest engine SL/TP fill simulation. Live doesn't use 1m
//     directly but if we ever run walk-back (recently we did) on stale 1m it lies.
//     Refreshing 1m every cycle keeps backtest=live aligned.
//   - 5m/15m/240m: enrichment multi-TF features (used by classifier)
export const TFS_FOR_SCAN = ['1m', '5m', '15m', '60m', '240m', '1D', '1W'];

export async function refreshForScan(): Promise<void> {
  const now = Date.now();
  for (const symbol of SYMBOLS) {
    for (const tf of TFS_FOR_SCAN) {
      const r = await query<{ last: string | null }>(
        `SELECT MAX(ts)::text AS last FROM candles WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );
      const last = r.rows[0]?.last ? parseInt(r.rows[0].last, 10) : null;
      // Re-fetch FROM the last stored bar (inclusive), not after it. `last + tf`
      // skipped the forming bar after its first insert — MAX(ts) became the forming
      // bar itself, `from` jumped past now, and the row froze at its first-seen
      // partial state forever (2026-06-02..06-10 regression: 240m bars captured
      // ~29% of true range, ATR(14) read ~half of reality). Refetching the last bar
      // keeps the forming row updating every cycle AND delivers the final values of
      // a just-closed bar on the next cycle (insertCandles grace window applies).
      const from = last ?? now - 30 * 24 * 60 * 60_000;
      if (from >= now) continue;
      await backfillCandles(symbol, tf, from, now);
    }
    // Funding refresh (cheap — at most 3 events/day)
    const fr = await query<{ last: string | null }>(
      `SELECT MAX(ts)::text AS last FROM funding_history WHERE symbol = $1`,
      [symbol]
    );
    const lastF = fr.rows[0]?.last ? parseInt(fr.rows[0].last, 10) : null;
    const fromF = lastF ? lastF + 60_000 : now - 7 * 24 * 60 * 60_000;
    if (fromF < now) await backfillFunding(symbol, fromF, now);
  }
}

// Update window: a bar is writable while OPEN and for one extra tf-duration after
// close (grace). The grace is what lets the cycle AFTER a bar closes deliver its
// FINAL exchange values — without it the row keeps whatever the last in-period
// refresh saw (missing the tail of the period). Bars older than close+grace are
// immutable (belt-and-suspenders vs API glitches rewriting deep history), except
// in force mode (one-off repairs of frozen eras — see repairCandles).
async function insertCandles(
  symbol: string,
  tf: string,
  rows: BybitKline[],
  force = false
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
    const guard = force ? '' : `
                 WHERE candles.ts + 2 * (CASE candles.tf
                                       WHEN '1m'   THEN 60000
                                       WHEN '5m'   THEN 300000
                                       WHEN '15m'  THEN 900000
                                       WHEN '60m'  THEN 3600000
                                       WHEN '240m' THEN 14400000
                                       WHEN '1D'   THEN 86400000
                                       WHEN '1W'   THEN 604800000
                                       ELSE 0
                                     END) > EXTRACT(EPOCH FROM NOW()) * 1000`;
    const sql = `INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
                 VALUES ${values.join(', ')}
                 ON CONFLICT (symbol, tf, ts) DO UPDATE SET
                   open     = EXCLUDED.open,
                   high     = EXCLUDED.high,
                   low      = EXCLUDED.low,
                   close    = EXCLUDED.close,
                   volume   = EXCLUDED.volume,
                   turnover = EXCLUDED.turnover${guard}`;
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

export async function backfillCandles(symbol: string, tf: string, fromMs: number, toMs: number, force = false) {
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
    const inserted = await insertCandles(symbol, tf, candles, force);
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

export async function backfillFunding(symbol: string, fromMs: number, toMs: number) {
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
      // Inclusive of the last stored bar — same forming-bar-freeze fix as refreshForScan.
      const from = last ?? now - 365 * 24 * 60 * 60_000;
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
