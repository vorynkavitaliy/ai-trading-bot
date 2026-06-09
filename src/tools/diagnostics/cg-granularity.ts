/**
 * cg-granularity — print the timestamp spacing of the Coinglass tables to settle
 * whether the "current" CG value a 4H strategy reads actually moves intra-4H (i.e.
 * whether live's hourly scan-decide can produce a different SIDE than the 4H-only
 * backtest, or only different entry prices).
 *
 * Run: npx tsx src/tools/diagnostics/cg-granularity.ts SOLUSDT
 */
import { query, close as closePg } from '../../core/db';

async function spacing(label: string, sql: string, params: any[]): Promise<void> {
  try {
    const { rows } = await query<{ ts: string }>(sql, params);
    if (rows.length < 2) { console.log(`  ${label}: <2 rows (${rows.length})`); return; }
    const ts = rows.map(r => Number(r.ts)).sort((a, b) => b - a); // newest first
    const deltas: number[] = [];
    for (let i = 0; i < ts.length - 1; i++) deltas.push((ts[i] - ts[i + 1]) / 60_000); // minutes
    const newest = new Date(ts[0]).toISOString();
    console.log(`  ${label}: newest ${newest} | last ${deltas.length} gaps (min): ${deltas.map(d => Math.round(d)).join(', ')}`);
  } catch (e: any) {
    console.log(`  ${label}: ERROR ${e?.message ?? e}`);
  }
}

async function main() {
  const pair = (process.argv[2] ?? 'SOLUSDT').toUpperCase();
  const coin = pair.replace(/USDT$/, '');
  console.log(`CG table granularity for ${pair} (coin ${coin}) — newest 12 rows, gaps in minutes:\n`);
  await spacing('cg_ls_top_position ', `SELECT ts::text FROM cg_ls_top_position WHERE pair = $1 AND exchange = 'Binance' ORDER BY ts DESC LIMIT 12`, [pair]);
  await spacing('cg_ls_top_account  ', `SELECT ts::text FROM cg_ls_top_account WHERE pair = $1 AND exchange = 'Binance' ORDER BY ts DESC LIMIT 12`, [pair]);
  await spacing('cg_funding_oi_wtd  ', `SELECT ts::text FROM cg_funding_oi_weighted WHERE symbol = $1 ORDER BY ts DESC LIMIT 12`, [pair]);
  console.log('\n(4H spacing = ~240 min gaps → CG is 4H-bucketed; ~60 = hourly. If the NEWEST');
  console.log(' gap is small/irregular, the open bucket is being refreshed intra-period.)');
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
