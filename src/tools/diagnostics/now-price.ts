/**
 * now-price — latest 1m candle close (our perp DB) + age, for setting manual order levels.
 * Run: npx tsx src/tools/diagnostics/now-price.ts [SYM...]   (default BTCUSDT SOLUSDT)
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const syms = process.argv.slice(2).length ? process.argv.slice(2).map(s => s.toUpperCase()) : ['BTCUSDT', 'SOLUSDT'];
  for (const s of syms) {
    const r = await query<{ c: string; ts: string }>(
      `SELECT close::text c, ts::text FROM candles WHERE symbol=$1 AND tf='1m' ORDER BY ts DESC LIMIT 1`, [s]);
    const row = r.rows[0];
    if (!row) { console.log(`${s}: no 1m`); continue; }
    const age = Math.round((Date.now() - Number(row.ts)) / 60_000);
    console.log(`${s.padEnd(9)} ${row.c}   (1m close, ${age}min old, ${new Date(Number(row.ts)).toISOString().slice(11, 16)} UTC)`);
  }
  await closePg();
}
main().catch((e) => { console.error(e); process.exit(1); });
