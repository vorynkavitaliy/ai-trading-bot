/**
 * candle-depth — min/max 1m candle ts + count per current-book pair, to pick a
 * backtest window the data actually supports.
 * Run: npx tsx src/tools/diagnostics/candle-depth.ts
 */
import { query, close as closePg } from '../../core/db';

async function main(): Promise<void> {
  const pairs = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];
  const now = Date.now();
  const { rows } = await query<{ symbol: string; tf: string; mn: string; mx: string; n: string }>(
    `SELECT symbol, tf, MIN(ts)::text AS mn, MAX(ts)::text AS mx, COUNT(*)::text AS n
     FROM candles WHERE symbol = ANY($1) AND tf IN ('1m','240m')
     GROUP BY symbol, tf ORDER BY symbol, tf`,
    [pairs],
  );
  for (const r of rows) {
    const mn = Number(r.mn), mx = Number(r.mx);
    const depthDays = ((mx - mn) / 86_400_000).toFixed(0);
    const ageMn = ((now - mn) / 86_400_000).toFixed(0);
    console.log(`  ${r.symbol.padEnd(8)} ${r.tf.padEnd(5)}  from ${new Date(mn).toISOString().slice(0, 10)} → ${new Date(mx).toISOString().slice(0, 10)}  span=${depthDays}d  (oldest ${ageMn}d ago)  bars=${r.n}`);
  }
  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
