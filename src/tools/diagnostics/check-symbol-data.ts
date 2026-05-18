// Diagnostic: check what historical candle data we have for a symbol across all timeframes.
import { query, close as closePg } from '../../core/db';

async function main() {
  const symbol = process.argv[2];
  if (!symbol) {
    console.error('usage: npx tsx src/tools/diagnostics/check-symbol-data.ts <SYMBOL>');
    process.exit(1);
  }
  const r = await query<any>(
    `SELECT tf, COUNT(*) as bars,
            MIN(ts) as min_ts, MAX(ts) as max_ts
     FROM candles
     WHERE symbol = $1
     GROUP BY tf
     ORDER BY tf`,
    [symbol]
  );
  if (r.rows.length === 0) {
    console.log(`No candle data found for ${symbol}`);
  } else {
    console.log(`Candle data for ${symbol}:`);
    for (const row of r.rows) {
      const minIso = new Date(Number(row.min_ts)).toISOString().slice(0, 10);
      const maxIso = new Date(Number(row.max_ts)).toISOString().slice(0, 10);
      console.log(`  tf=${row.tf.padEnd(5)} bars=${String(row.bars).padStart(6)}  ${minIso} → ${maxIso}`);
    }
  }
  await closePg();
}

main().catch(async (e) => {
  console.error(e);
  try { await closePg(); } catch {}
  process.exit(1);
});
