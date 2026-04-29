// One-shot diagnostic: dump candle / funding coverage by symbol+tf.
import { query, close as closePg } from '../lib/db';
import { log } from '../lib/logger';

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error('usage: db-status.ts <SYMBOL> [<SYMBOL>...]');
    process.exit(1);
  }

  const r = await query<any>(
    `SELECT symbol, tf, COUNT(*)::int AS rows,
            to_timestamp(MIN(ts)/1000)::date AS first_day,
            to_timestamp(MAX(ts)/1000)::date AS last_day
     FROM candles WHERE symbol = ANY($1)
     GROUP BY symbol, tf ORDER BY symbol, tf`,
    [symbols]
  );
  console.log('candles:');
  for (const row of r.rows) {
    console.log(`  ${row.symbol.padEnd(10)} ${row.tf.padEnd(5)} rows=${String(row.rows).padStart(6)}  ${row.first_day} → ${row.last_day}`);
  }
  console.log('');

  const fr = await query<any>(
    `SELECT symbol, COUNT(*)::int AS rows,
            to_timestamp(MIN(ts)/1000)::date AS first_day,
            to_timestamp(MAX(ts)/1000)::date AS last_day
     FROM funding_history WHERE symbol = ANY($1)
     GROUP BY symbol ORDER BY symbol`,
    [symbols]
  );
  console.log('funding:');
  for (const row of fr.rows) {
    console.log(`  ${row.symbol.padEnd(10)} rows=${String(row.rows).padStart(6)}  ${row.first_day} → ${row.last_day}`);
  }

  await closePg();
}

main().catch(async (e) => {
  log.error('db-status failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
