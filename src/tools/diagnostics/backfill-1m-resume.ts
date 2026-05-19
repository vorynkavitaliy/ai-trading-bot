// Resume 1m backfill with longer delay (Bybit rate-limited last attempt).
// Use 500ms delay to stay well under 120/5s public API limit.
// Fills gaps in existing coverage rather than re-pulling everything.

import { fetchKlines } from '../../data/bybit-public';
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const TF = '1m';
const TF_MS = 60_000;
const STEP_BARS = 1000;
const STEP_MS = STEP_BARS * TF_MS;
const DELAY_MS = 500;

const TARGETS: { symbol: string; startMs: number }[] = [
  { symbol: 'ETHUSDT', startMs: Date.parse('2022-06-13T00:00:00Z') }, // resume from gap
  { symbol: 'SOLUSDT', startMs: Date.parse('2021-10-15T00:00:00Z') },
  { symbol: 'XRPUSDT', startMs: Date.parse('2021-05-13T00:00:00Z') },
];

async function insertBatch(symbol: string, tf: string, rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const placeholders: string[] = [];
    const flat: any[] = [];
    let p = 1;
    for (const r of slice) {
      placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      flat.push(symbol, tf, r.startTime, r.open, r.high, r.low, r.close, r.volume, r.turnover);
    }
    const sql = `INSERT INTO candles (symbol, tf, ts, open, high, low, close, volume, turnover)
                 VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`;
    const r = await query(sql, flat);
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function backfillResume(symbol: string, startMs: number, toMs: number) {
  let cursor = startMs;
  let totalInserted = 0;
  let batches = 0;
  let retries = 0;

  while (cursor < toMs) {
    const windowEnd = Math.min(cursor + STEP_MS, toMs);
    let candles: any[] = [];
    try {
      candles = await fetchKlines(symbol, TF, cursor, windowEnd);
    } catch (e: any) {
      if (e.message?.includes('10006')) {
        retries++;
        log.warn('rate limit, sleeping 30s', { symbol, retries });
        await sleep(30_000);
        try { candles = await fetchKlines(symbol, TF, cursor, windowEnd); }
        catch (e2: any) {
          log.warn('still failing, sleep 60s', { symbol, err: e2.message });
          await sleep(60_000);
          candles = await fetchKlines(symbol, TF, cursor, windowEnd);
        }
      } else { throw e; }
    }

    if (candles.length === 0) { cursor = windowEnd + 1; continue; }
    const n = await insertBatch(symbol, TF, candles);
    totalInserted += n;
    batches++;
    cursor = candles[candles.length - 1].startTime + TF_MS;
    if (batches % 30 === 0) {
      log.info('progress', { symbol, inserted: totalInserted, batches, cursor_iso: new Date(cursor).toISOString() });
    }
    await sleep(DELAY_MS);
  }
  log.info('done', { symbol, inserted: totalInserted, batches, retries });
}

async function main() {
  const toMs = Date.now();
  for (const t of TARGETS) {
    log.info('starting', { symbol: t.symbol, startIso: new Date(t.startMs).toISOString() });
    await backfillResume(t.symbol, t.startMs, toMs);
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
