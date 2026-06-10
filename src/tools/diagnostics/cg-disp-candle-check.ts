import { query } from '../../core/db';

async function main() {
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'LTCUSDT', 'ATOMUSDT', 'ARBUSDT', 'INJUSDT', 'TAOUSDT', 'LINKUSDT', 'ADAUSDT', 'DOGEUSDT'];
  for (const s of syms) {
    const r = await query<any>(
      `SELECT count(*)::int n, min(ts)::text mn, max(ts)::text mx FROM candles WHERE symbol=$1 AND tf='240m'`, [s]);
    const row = r.rows[0];
    const mn = row.mn ? new Date(parseInt(row.mn)).toISOString().slice(0, 10) : '-';
    const mx = row.mx ? new Date(parseInt(row.mx)).toISOString().slice(0, 10) : '-';
    console.log(`${s.padEnd(10)} 240m n=${String(row.n).padStart(5)} ${mn}..${mx}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
