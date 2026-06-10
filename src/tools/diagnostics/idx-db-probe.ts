/**
 * idx-db-probe — read-only: what candle symbols/tfs/date-ranges do we have for
 * forward-return computation, and confirm DB connectivity. No writes.
 */
import { query } from '../../core/db';

async function main() {
  const tfs = await query<any>(
    `SELECT symbol, tf, count(*) n, min(ts)::text mn, max(ts)::text mx
     FROM candles
     WHERE symbol IN ('BTCUSDT','ETHUSDT') AND tf IN ('1D','240m','60m')
     GROUP BY symbol, tf ORDER BY symbol, tf`,
  );
  console.log('=== candles coverage ===');
  for (const r of tfs.rows) {
    const mn = new Date(parseInt(r.mn, 10)).toISOString().slice(0, 10);
    const mx = new Date(parseInt(r.mx, 10)).toISOString().slice(0, 10);
    console.log(`${r.symbol} ${r.tf}: ${r.n} bars  ${mn} .. ${mx}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
