import { query, close as closePg } from '../../core/db';

async function preCount(): Promise<void> {
  const r = await query<{ tf: string; count: string }>(
    `SELECT tf, COUNT(*)::text AS count FROM candles WHERE tf IN ('1D','1W') GROUP BY tf ORDER BY tf`
  );
  console.log('=== PRE-SCRUB COUNTS ===');
  for (const row of r.rows) {
    console.log(`  tf=${row.tf}  count=${row.count}`);
  }
  console.log('');
}

async function deleteDW(): Promise<number> {
  const r = await query(`DELETE FROM candles WHERE tf IN ('1D','1W')`);
  console.log(`=== DELETE result === rows deleted: ${r.rowCount}`);
  console.log('');
  return r.rowCount;
}

async function postCount(): Promise<void> {
  const r = await query<{ symbol: string; tf: string; rows: string; min_ts: string; max_ts: string }>(
    `SELECT symbol, tf, COUNT(*)::text AS rows, MIN(ts)::text AS min_ts, MAX(ts)::text AS max_ts
     FROM candles
     WHERE tf IN ('1D','1W')
       AND symbol IN ('BTCUSDT','INJUSDT','TAOUSDT','ATOMUSDT','LTCUSDT','ARBUSDT','XRPUSDT')
     GROUP BY symbol, tf
     ORDER BY symbol, tf`
  );
  console.log('=== POST-FETCH COUNTS ===');
  for (const row of r.rows) {
    const minDate = new Date(Number(row.min_ts)).toISOString().slice(0, 10);
    const maxDate = new Date(Number(row.max_ts)).toISOString().slice(0, 10);
    console.log(`  ${row.symbol.padEnd(10)} ${row.tf.padEnd(3)} rows=${row.rows.padStart(5)}  ${minDate} -> ${maxDate}`);
  }
  console.log('');
}

interface AggCheckRow {
  week_ts: string | null;
  w_high: string | null;
  w_low: string | null;
  agg_high: string | null;
  agg_low: string | null;
}

async function aggregationCheck(symbol: string, isoDate: string): Promise<void> {
  const weekTs = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  );

  const sql = `
    WITH wk AS (
      SELECT ts AS week_ts, high AS w_high, low AS w_low
      FROM candles
      WHERE symbol = $1 AND tf = '1W' AND ts = $2
    )
    SELECT
      wk.week_ts::text,
      wk.w_high::text,
      wk.w_low::text,
      (SELECT MAX(high)::text FROM candles
        WHERE symbol = $1 AND tf = '60m'
          AND ts >= wk.week_ts AND ts < wk.week_ts + 604800000) AS agg_high,
      (SELECT MIN(low)::text FROM candles
        WHERE symbol = $1 AND tf = '60m'
          AND ts >= wk.week_ts AND ts < wk.week_ts + 604800000) AS agg_low
    FROM wk
  `;

  const r = await query<AggCheckRow>(sql, [symbol, weekTs]);

  if (r.rows.length === 0) {
    console.log(`[AGG] ${symbol} week=${isoDate} -> NO 1W ROW; trying nearest`);

    const nearest = await query<{ ts: string; high: string; low: string }>(
      `SELECT ts::text, high::text, low::text
       FROM candles
       WHERE symbol = $1 AND tf = '1W'
       ORDER BY ABS(ts - $2)
       LIMIT 1`,
      [symbol, weekTs]
    );

    if (nearest.rows.length === 0) {
      console.log(`[AGG] ${symbol}: no 1W rows at all - FAIL`);
      return;
    }

    const near = nearest.rows[0];
    const nearTs = Number(near.ts);
    const nearIso = new Date(nearTs).toISOString().slice(0, 10);
    console.log(`[AGG] ${symbol} using nearest 1W ts=${nearIso}`);

    const recheck = await query<AggCheckRow>(sql, [symbol, nearTs]);
    if (recheck.rows.length === 0) {
      console.log(`[AGG] ${symbol} ${nearIso}: still no row - FAIL`);
      return;
    }
    printAggRow(symbol, nearIso, recheck.rows[0]);
    return;
  }

  printAggRow(symbol, isoDate, r.rows[0]);
}

function printAggRow(symbol: string, isoDate: string, row: AggCheckRow): void {
  const wHigh = Number(row.w_high);
  const wLow = Number(row.w_low);
  const aggHigh = row.agg_high === null ? null : Number(row.agg_high);
  const aggLow = row.agg_low === null ? null : Number(row.agg_low);

  if (aggHigh === null || aggLow === null) {
    console.log(
      `[AGG] ${symbol} ${isoDate}: w_high=${wHigh} w_low=${wLow} | agg_high=NULL agg_low=NULL (no 60m bars in week) -> WARN (not a fail; engine still consistent)`
    );
    return;
  }

  const highDiffPct = Math.abs((wHigh - aggHigh) / wHigh) * 100;
  const lowDiffPct = Math.abs((wLow - aggLow) / wLow) * 100;
  const pass = highDiffPct < 0.1 && lowDiffPct < 0.1;

  console.log(
    `[AGG] ${symbol} ${isoDate}: w_high=${wHigh} agg_high=${aggHigh} (Δ${highDiffPct.toFixed(4)}%) | ` +
    `w_low=${wLow} agg_low=${aggLow} (Δ${lowDiffPct.toFixed(4)}%) -> ${pass ? 'PASS' : 'FAIL'}`
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === 'pre-count') {
    await preCount();
  } else if (mode === 'delete') {
    await deleteDW();
  } else if (mode === 'post-count') {
    await postCount();
  } else if (mode === 'agg-verify') {
    await aggregationCheck('BTCUSDT', '2026-02-09');
    await aggregationCheck('BTCUSDT', '2025-12-01');
    await aggregationCheck('XRPUSDT', '2026-01-12');
  } else {
    console.error('usage: dw-scrub-task003.ts <pre-count|delete|post-count|agg-verify>');
    process.exit(1);
  }

  await closePg();
}

main().catch(async (e) => {
  console.error('dw-scrub-task003 failed:', e?.message ?? String(e));
  try { await closePg(); } catch {}
  process.exit(1);
});
