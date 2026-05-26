// Print column names + 1 sample row for each cg_* table that we care about.
// Used to build the enricher in step 2 — need to know exact column names per table.
import { query, close as closePg } from '../../core/db';

const TABLES = [
  'cg_cb_premium',
  'cg_btc_etf_flow',
  'cg_agg_taker_coin',
  'cg_agg_liq_coin',
  'cg_orderbook_pair',
  'cg_funding_oi_weighted',
  'cg_funding_vol_weighted',
  'cg_ls_top_position',
  'cg_ls_top_account',
  'cg_ls_global_account',
  'cg_oi_aggregated',
  'cg_liq_pair',
  'cg_taker_pair',
];

async function main() {
  const pair = process.argv[2] ?? 'BTCUSDT';
  const coin = process.argv[3] ?? 'BTC';

  for (const tbl of TABLES) {
    const cols = await query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [tbl]
    );
    const cn = cols.rows.map(c => c.column_name);
    const filters: string[] = [];
    const params: any[] = [];
    if (cn.includes('symbol')) { filters.push(`symbol = $${params.length + 1}`); params.push(coin); }
    if (cn.includes('pair'))   { filters.push(`pair = $${params.length + 1}`);   params.push(pair); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    console.log(`\n=== ${tbl} ===`);
    console.log('cols:', cols.rows.map(c => `${c.column_name}:${c.data_type}`).join('  '));

    const sample = await query<any>(
      `SELECT * FROM ${tbl} ${where} ORDER BY ts DESC LIMIT 1`,
      params
    );
    if (sample.rows.length) {
      const row = sample.rows[0];
      const fmt: Record<string, any> = {};
      for (const k of Object.keys(row)) {
        if (k === 'ts') fmt[k] = `${row[k]} (${new Date(Number(row[k])).toISOString()})`;
        else fmt[k] = row[k];
      }
      console.log('latest row:', JSON.stringify(fmt));
    } else {
      console.log('no rows');
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
