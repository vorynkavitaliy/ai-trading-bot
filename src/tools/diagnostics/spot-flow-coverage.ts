/**
 * spot-flow-coverage — verify candles table has 4h coverage for the coins we want to
 * test forward returns on, plus cg_funding_oi_weighted coverage (for orthogonality).
 * Read-only. Run: npx tsx src/tools/diagnostics/spot-flow-coverage.ts
 */
import { query } from '../../core/db';

async function main() {
  const pairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  console.log('=== candles 4h (240m) coverage ===');
  for (const p of pairs) {
    for (const tf of ['240m']) {
      const r = await query<any>(
        `SELECT count(*) n, min(ts) mn, max(ts) mx FROM candles WHERE symbol=$1 AND tf=$2`, [p, tf]);
      const row = r.rows[0];
      if (row && row.n > 0) {
        const days = (Number(row.mx) - Number(row.mn)) / 86400000;
        console.log(`${p} ${tf}: n=${row.n} span=${days.toFixed(0)}d first=${new Date(Number(row.mn)).toISOString().slice(0,10)} last=${new Date(Number(row.mx)).toISOString().slice(0,10)}`);
      } else {
        console.log(`${p} ${tf}: NONE`);
      }
    }
  }
  console.log('\n=== cg_funding_oi_weighted coverage (orthogonality ref) ===');
  for (const c of ['BTC', 'ETH', 'SOL']) {
    const r = await query<any>(
      `SELECT count(*) n, min(ts) mn, max(ts) mx FROM cg_funding_oi_weighted WHERE symbol=$1`, [c]);
    const row = r.rows[0];
    if (row && row.n > 0) {
      const days = (Number(row.mx) - Number(row.mn)) / 86400000;
      console.log(`${c}: n=${row.n} span=${days.toFixed(0)}d first=${new Date(Number(row.mn)).toISOString().slice(0,10)} last=${new Date(Number(row.mx)).toISOString().slice(0,10)}`);
    } else {
      console.log(`${c}: NONE`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
