/** candles-inventory — read-only: what symbols/tfs/date-ranges exist in candles. */
import { query, close } from '../../core/db';

async function main() {
  const tfs = await query<{ tf: string; n: string }>(
    `SELECT tf, count(*)::text AS n FROM candles GROUP BY tf ORDER BY tf`
  );
  console.log('=== timeframes ===');
  for (const r of tfs.rows) console.log(`${r.tf}\t${r.n}`);

  const daily = await query<{ symbol: string; n: string; first_ts: string; last_ts: string }>(
    `SELECT symbol, count(*)::text AS n,
            min(ts)::text AS first_ts, max(ts)::text AS last_ts
     FROM candles WHERE tf = '1D' GROUP BY symbol ORDER BY symbol`
  );
  console.log('\n=== 1D symbols (symbol, nbars, firstTs, lastTs) ===');
  for (const r of daily.rows) {
    const f = new Date(parseInt(r.first_ts, 10)).toISOString().slice(0, 10);
    const l = new Date(parseInt(r.last_ts, 10)).toISOString().slice(0, 10);
    console.log(`${r.symbol}\t${r.n}\t${f}\t${l}`);
  }

  const h4 = await query<{ symbol: string; n: string; first_ts: string; last_ts: string }>(
    `SELECT symbol, count(*)::text AS n,
            min(ts)::text AS first_ts, max(ts)::text AS last_ts
     FROM candles WHERE tf = '240m' GROUP BY symbol ORDER BY symbol`
  );
  console.log('\n=== 240m symbols (symbol, nbars, firstTs, lastTs) ===');
  for (const r of h4.rows) {
    const f = new Date(parseInt(r.first_ts, 10)).toISOString().slice(0, 10);
    const l = new Date(parseInt(r.last_ts, 10)).toISOString().slice(0, 10);
    console.log(`${r.symbol}\t${r.n}\t${f}\t${l}`);
  }

  await close();
}
main().catch(e => { console.error(e); process.exit(1); });
