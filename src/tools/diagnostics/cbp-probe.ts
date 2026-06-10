/**
 * cbp-probe — inspect the Coinbase Premium Index endpoint shape + history depth,
 * and the BTC candle coverage we'll align against. Read-only.
 */
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';

async function main() {
  for (const interval of ['1h', '4h']) {
    try {
      const r = await cgGet<any>('/coinbase-premium-index', { interval, limit: 5 });
      const d: any = r.data;
      console.log(`\n=== interval=${interval} (limit 5) ===`);
      console.log('top-level type:', Array.isArray(d) ? 'array' : typeof d);
      if (Array.isArray(d)) {
        console.log('rows:', d.length);
        console.log('first row:', JSON.stringify(d[0]));
        console.log('last  row:', JSON.stringify(d[d.length - 1]));
      } else if (d && typeof d === 'object') {
        console.log('keys:', Object.keys(d));
        console.log('sample:', JSON.stringify(d).slice(0, 500));
      }
    } catch (e: any) {
      console.log(`interval=${interval} ERROR: ${e?.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  // Big pull to learn max depth at 4h and 1h
  for (const interval of ['1h', '4h']) {
    try {
      const r = await cgGet<any>('/coinbase-premium-index', { interval, limit: 4500 });
      const d: any = r.data;
      const arr = Array.isArray(d) ? d : (d?.data_list ?? d?.list ?? null);
      if (Array.isArray(arr) && arr.length) {
        const f = arr[0], l = arr[arr.length - 1];
        const ft = f.time ?? f.t ?? f.timestamp;
        const lt = l.time ?? l.t ?? l.timestamp;
        console.log(`\n[depth] interval=${interval}: rows=${arr.length} firstTime=${ft} lastTime=${lt}`);
      } else {
        console.log(`\n[depth] interval=${interval}: non-array or empty, keys=${d && typeof d === 'object' ? Object.keys(d) : typeof d}`);
      }
    } catch (e: any) {
      console.log(`[depth] interval=${interval} ERROR: ${e?.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  for (const tf of ['240m', '60m']) {
    const c = await query<any>(
      `SELECT count(*) AS n, min(ts)::text AS mn, max(ts)::text AS mx FROM candles WHERE symbol='BTCUSDT' AND tf=$1`,
      [tf],
    );
    console.log(`\nBTCUSDT candles tf=${tf}: n=${c.rows[0].n} min=${c.rows[0].mn} max=${c.rows[0].mx}`);
  }
  await closePg();
}
main().catch(e => { console.error(e); process.exit(1); });
