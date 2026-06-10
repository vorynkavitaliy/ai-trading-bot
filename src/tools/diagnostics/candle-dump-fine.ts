/**
 * candle-dump-fine — print last N candles for a pair/tf with volume, body %, range %,
 * close position within bar, and volume vs SMA20. Adaptive decimals for low-priced pairs.
 * Run: npx tsx src/tools/diagnostics/candle-dump-fine.ts BTCUSDT 15m 30
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const pair = process.argv[2];
  const tf = process.argv[3] ?? '15m';
  const n = Number(process.argv[4] ?? 30);
  if (!pair) { console.error('usage: candle-dump-fine.ts <PAIR> <tf> <lastN>'); process.exit(1); }
  const { rows } = await query<any>(
    `SELECT ts, open::float8 o, high::float8 h, low::float8 l, close::float8 c, volume::float8 v
       FROM candles WHERE symbol=$1 AND tf=$2 ORDER BY ts DESC LIMIT $3`,
    [pair, tf, n + 20]);
  rows.reverse();
  const px = rows[rows.length - 1].c;
  const d = px >= 1000 ? 1 : px >= 100 ? 2 : px >= 1 ? 3 : 5;
  const fmt = (x: number) => x.toFixed(d).padStart(9);
  const out = rows.slice(-n);
  console.log(`\n${pair} ${tf} last ${out.length} bars (UTC)  body%=close-open  pos=close position in H-L range  volX=vol/SMA20(prior)`);
  console.log('  time           open      high      low       close     body%   range%  pos   vol        volX');
  out.forEach((r, idx) => {
    const i = rows.indexOf(r);
    const sma = rows.slice(Math.max(0, i - 20), i).reduce((s, x) => s + x.v, 0) / Math.min(20, i || 1);
    const body = (r.c - r.o) / r.o * 100;
    const range = (r.h - r.l) / r.l * 100;
    const pos = r.h > r.l ? (r.c - r.l) / (r.h - r.l) : 0.5;
    const t = new Date(Number(r.ts)).toISOString().slice(5, 16).replace('T', ' ');
    console.log(`  ${t}  ${fmt(r.o)} ${fmt(r.h)} ${fmt(r.l)} ${fmt(r.c)}  ${(body >= 0 ? '+' : '') + body.toFixed(2).padStart(5)}  ${range.toFixed(2).padStart(6)}  ${pos.toFixed(2)}  ${r.v.toFixed(0).padStart(9)}  ${sma > 0 ? (r.v / sma).toFixed(2) : ' n/a'}`);
  });
  await closePg();
}
main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
