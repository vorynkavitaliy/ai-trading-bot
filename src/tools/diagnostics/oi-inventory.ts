/**
 * oi-inventory — read-only: what OI + candle data do we actually have for the
 * OI x price quadrant study? Reports row counts, time spans, symbols, and the
 * per-exchange OI endpoint shape from CG.
 */
import { query } from '../../core/db';
import { cgGet } from '../../core/coinglass';

async function main() {
  console.log('=== cg_oi_aggregated inventory ===');
  const oi = await query<any>(
    `SELECT symbol, COUNT(*) AS n, MIN(ts)::text AS min_ts, MAX(ts)::text AS max_ts
     FROM cg_oi_aggregated GROUP BY symbol ORDER BY symbol`,
  );
  for (const r of oi.rows) {
    const span = (Number(r.max_ts) - Number(r.min_ts)) / 86400000;
    console.log(`  ${r.symbol.padEnd(8)} n=${String(r.n).padStart(5)}  ${new Date(Number(r.min_ts)).toISOString()} -> ${new Date(Number(r.max_ts)).toISOString()}  span=${span.toFixed(0)}d`);
  }

  // sample bar spacing for BTC
  const sp = await query<any>(
    `SELECT ts::text FROM cg_oi_aggregated WHERE symbol='BTC' ORDER BY ts DESC LIMIT 6`,
  );
  const tss = sp.rows.map((r: any) => Number(r.ts));
  console.log('  BTC recent ts spacing (h):', tss.slice(0, -1).map((t: number, i: number) => ((t - tss[i + 1]) / 3600000).toFixed(1)).join(','));

  console.log('\n=== candles inventory (240m) for study symbols ===');
  for (const sym of ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT', 'ETHUSDT']) {
    const c = await query<any>(
      `SELECT tf, COUNT(*) AS n, MIN(ts)::text AS min_ts, MAX(ts)::text AS max_ts
       FROM candles WHERE symbol=$1 AND tf IN ('240m','60m') GROUP BY tf ORDER BY tf`,
      [sym],
    );
    for (const r of c.rows) {
      const span = (Number(r.max_ts) - Number(r.min_ts)) / 86400000;
      console.log(`  ${sym.padEnd(9)} ${r.tf.padEnd(5)} n=${String(r.n).padStart(5)}  ${new Date(Number(r.min_ts)).toISOString().slice(0,10)} -> ${new Date(Number(r.max_ts)).toISOString().slice(0,10)}  span=${span.toFixed(0)}d`);
    }
  }

  console.log('\n=== per-exchange OI history chart shape (BTC, range=4h) ===');
  try {
    const r = await cgGet<any>('/futures/open-interest/exchange-history-chart', { symbol: 'BTC', range: '4h' });
    const d = r.data;
    console.log('  top-level keys:', Object.keys(d).join(','));
    if (d.time_list) {
      const tl = d.time_list;
      console.log(`  time_list len=${tl.length}  first=${tl[0]}  last=${tl[tl.length-1]}`);
      console.log(`  first ms? ${String(tl[0]).length >= 12 ? 'ms' : 'sec'}  -> ${new Date(Number(tl[0]) * (String(tl[0]).length >= 12 ? 1 : 1000)).toISOString()}`);
      const spacingH = ((Number(tl[1]) - Number(tl[0])) * (String(tl[0]).length >= 12 ? 1 : 1000)) / 3600000;
      console.log(`  spacing ~ ${spacingH.toFixed(2)}h`);
    }
    if (d.price_list) console.log(`  price_list len=${d.price_list.length} sample=${d.price_list.slice(0,3)}`);
    if (d.data_map) console.log(`  data_map keys (exchanges):`, Object.keys(d.data_map).join(','));
  } catch (e: any) {
    console.log('  ERR', e?.message ?? String(e));
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
