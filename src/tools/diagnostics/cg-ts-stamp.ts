/**
 * cg-ts-stamp — determine whether 4H Coinglass bars are OPEN-stamped (look-ahead risk)
 * or CLOSE-stamped. Prints recent cg_ls_top_position rows for a pair with ts→ISO.
 * Cross-check: the live per-pair X-ray at 08:00 UTC showed BTC ls_top_position ≈ 1.17.
 * If that value sits on ts=08:00 → close-stamped (bar = prior 4h, value at its close).
 * If on ts=04:00 → open-stamped (loadCoinglassAt returns a future-close value early).
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/cg-ts-stamp.ts [PAIR=BTCUSDT] [COIN=BTC]
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const pair = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
  const coin = (process.argv[3] ?? pair.replace(/USDT$/, '')).toUpperCase();

  const { rows: pos } = await query<any>(
    `SELECT ts, ratio::float8 r FROM cg_ls_top_position
     WHERE pair=$1 AND exchange='Binance' ORDER BY ts DESC LIMIT 14`, [pair]);
  console.log(`\n=== cg_ls_top_position ${pair} (recent 14, ts→UTC) ===`);
  for (const x of pos) {
    const d = new Date(Number(x.ts));
    console.log(`  ts=${Number(x.ts)}  ${d.toISOString()}  H${String(d.getUTCHours()).padStart(2,'0')}  ratio=${x.r.toFixed(4)}`);
  }
  // spacing
  if (pos.length >= 2) {
    const dtH = (Number(pos[0].ts) - Number(pos[1].ts)) / 3600_000;
    console.log(`  spacing: ${dtH}h between bars; UTC hours present: ${[...new Set(pos.map((p:any)=>new Date(Number(p.ts)).getUTCHours()))].sort((a,b)=>a-b).join(',')}`);
  }

  const { rows: fund } = await query<any>(
    `SELECT ts, fr_close::float8 f FROM cg_funding_oi_weighted
     WHERE symbol=$1 ORDER BY ts DESC LIMIT 6`, [coin]);
  console.log(`\n=== cg_funding_oi_weighted ${coin} (recent 6) ===`);
  for (const x of fund) {
    const d = new Date(Number(x.ts));
    console.log(`  ts=${Number(x.ts)}  ${d.toISOString()}  H${String(d.getUTCHours()).padStart(2,'0')}  fr_close=${x.f}`);
  }
  await closePg();
}
main().catch(e => { console.error(e); process.exit(1); });
