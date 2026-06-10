import { query } from '../../core/db';
async function main() {
  for (const sym of ['BTC', 'BTCUSDT', 'ETH', 'ETHUSDT']) {
    const r = await query<any>(
      `SELECT count(*) n, min(ts) a, max(ts) b FROM cg_funding_oi_weighted WHERE symbol=$1`, [sym]);
    const row = r.rows[0];
    if (Number(row.n) > 0) {
      console.log(`${sym}: n=${row.n}  ${new Date(Number(row.a)).toISOString().slice(0,10)} .. ${new Date(Number(row.b)).toISOString().slice(0,10)}`);
    } else {
      console.log(`${sym}: empty`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e?.message); process.exit(1); });
