/**
 * macro-regime-inventory — read-only: inventory candle coverage + probe the two
 * macro-regime CG endpoints (bitcoin-dominance, fear-greed-history) shapes.
 */
import { query } from '../../core/db';
import { cgGet } from '../../core/coinglass';

async function main() {
  const btc = await query<any>(
    `SELECT tf, count(*) n, min(ts) mn, max(ts) mx FROM candles WHERE symbol='BTCUSDT' GROUP BY tf ORDER BY tf`,
  );
  console.log('=== BTCUSDT candle coverage ===');
  for (const r of btc.rows) {
    console.log(`${r.tf}: ${r.n} rows  ${new Date(Number(r.mn)).toISOString()} .. ${new Date(Number(r.mx)).toISOString()}`);
  }

  const day = await query<any>(`SELECT DISTINCT symbol FROM candles WHERE tf='1D' ORDER BY symbol`);
  console.log('\n=== 1D symbols ===');
  console.log(day.rows.map((r: any) => r.symbol).join(', '));

  const h4 = await query<any>(`SELECT DISTINCT symbol FROM candles WHERE tf='240m' ORDER BY symbol`);
  console.log('\n=== 240m symbols ===');
  console.log(h4.rows.map((r: any) => r.symbol).join(', '));

  console.log('\n=== CG /index/bitcoin-dominance ===');
  const dom = await cgGet<any>('/index/bitcoin-dominance', {});
  const d = dom.data;
  console.log('top-level type:', Array.isArray(d) ? `array len ${d.length}` : typeof d);
  if (Array.isArray(d)) {
    console.log('first row:', JSON.stringify(d[0]));
    console.log('last row:', JSON.stringify(d[d.length - 1]));
  } else if (d && typeof d === 'object') {
    console.log('keys:', Object.keys(d));
    for (const k of Object.keys(d)) {
      const v: any = (d as any)[k];
      if (Array.isArray(v)) console.log(`  ${k}: array len ${v.length}, sample [${v[0]}, ${v[1]}]`);
    }
  }

  console.log('\n=== CG /index/fear-greed-history ===');
  const fng = await cgGet<any>('/index/fear-greed-history', {});
  const f = fng.data;
  console.log('top-level type:', Array.isArray(f) ? `array len ${f.length}` : typeof f);
  if (Array.isArray(f)) {
    console.log('first row:', JSON.stringify(f[0]));
    console.log('last row:', JSON.stringify(f[f.length - 1]));
  } else if (f && typeof f === 'object') {
    console.log('keys:', Object.keys(f));
    for (const k of Object.keys(f)) {
      const v: any = (f as any)[k];
      if (Array.isArray(v)) console.log(`  ${k}: array len ${v.length}, sample [${v[0]}, ${v[1]}]`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });
