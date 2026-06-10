import { query } from '../../core/db';
async function main() {
  const tfs = await query<any>(`SELECT tf, count(*) n, min(ts) mn, max(ts) mx FROM candles WHERE symbol='BTCUSDT' GROUP BY tf ORDER BY tf`, []);
  console.log('BTCUSDT candles by tf:');
  for (const r of tfs.rows) {
    console.log(`  tf=${r.tf} n=${r.n} min=${new Date(parseInt(r.mn)).toISOString()} max=${new Date(parseInt(r.mx)).toISOString()}`);
  }
  const f = await query<any>(`SELECT count(*) n, min(ts) mn, max(ts) mx FROM cg_funding_oi_weighted WHERE symbol='BTC'`, []);
  const fr = f.rows[0];
  console.log('cg_funding_oi_weighted BTC:', fr ? `n=${fr.n} min=${fr.mn?new Date(parseInt(fr.mn)).toISOString():'-'} max=${fr.mx?new Date(parseInt(fr.mx)).toISOString():'-'}` : 'none');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
