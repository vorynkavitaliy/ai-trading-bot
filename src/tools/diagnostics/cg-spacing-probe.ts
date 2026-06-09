import { query, close as closePg } from '../../core/db';

async function main() {
  const pair = process.argv[2] ?? 'XRPUSDT';
  const coin = pair.replace(/USDT$/, '');
  const rows = await query<{ ts: string; ratio: string }>(
    `SELECT ts::text, ratio::text FROM cg_ls_top_position
     WHERE pair = $1 AND exchange = 'Binance' ORDER BY ts DESC LIMIT 12`,
    [pair],
  );
  console.log(`cg_ls_top_position last 12 rows for ${pair}:`);
  for (const r of rows.rows) {
    const t = Number(r.ts);
    console.log(`  ts=${t} iso=${new Date(t).toISOString()} ratio=${r.ratio}`);
  }
  const fr = await query<{ ts: string; fr_close: string }>(
    `SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted
     WHERE symbol = $1 ORDER BY ts DESC LIMIT 12`,
    [coin],
  );
  console.log(`\ncg_funding_oi_weighted last 12 rows for ${coin}:`);
  for (const r of fr.rows) {
    const t = Number(r.ts);
    console.log(`  ts=${t} iso=${new Date(t).toISOString()} fr_close=${r.fr_close}`);
  }
  await closePg();
}
main().catch(async (e) => { console.error(e?.message ?? e); try { await closePg(); } catch {} process.exit(1); });
