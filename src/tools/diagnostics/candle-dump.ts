/**
 * candle-dump — print OHLC for a pair/tf over a date range, with per-bar % move and a
 * crude trend marker. For eyeballing what price actually did (e.g. why a short got stopped).
 * Run: npx tsx src/tools/diagnostics/candle-dump.ts BTCUSDT 240m 2026-05-21 2026-05-28
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const [pair, tf, from, to] = [process.argv[2], process.argv[3] ?? '240m', process.argv[4], process.argv[5]];
  if (!pair || !from) { console.error('usage: candle-dump.ts <PAIR> <tf> <fromYYYY-MM-DD> <toYYYY-MM-DD>'); process.exit(1); }
  const fromTs = Date.parse(from + 'T00:00:00Z'), toTs = Date.parse((to ?? from) + 'T23:59:59Z');
  const { rows } = await query<any>(
    `SELECT ts, open::text o, high::text h, low::text l, close::text c FROM candles
     WHERE symbol=$1 AND tf=$2 AND ts BETWEEN $3 AND $4 ORDER BY ts ASC`,
    [pair, tf, fromTs, toTs]);
  console.log(`\n${pair} ${tf}  ${from}..${to ?? from}   (O/H/L/C, %move close-to-close)\n`);
  console.log('  time             open      high      low       close     move%');
  let prev: number | null = null;
  for (const r of rows) {
    const o = +r.o, h = +r.h, l = +r.l, c = +r.c;
    const mv = prev != null ? (c - prev) / prev * 100 : 0;
    const t = new Date(Number(r.ts)).toISOString().slice(5, 16).replace('T', ' ');
    console.log(`  ${t}   ${o.toFixed(0).padStart(8)}  ${h.toFixed(0).padStart(8)}  ${l.toFixed(0).padStart(8)}  ${c.toFixed(0).padStart(8)}  ${(mv >= 0 ? '+' : '') + mv.toFixed(2).padStart(6)}${mv > 0.5 ? ' ↑' : mv < -0.5 ? ' ↓' : ''}`);
    prev = c;
  }
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
