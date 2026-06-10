import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

async function main() {
  // basis ts grid
  const r = await cgGet<any[]>('/futures/basis/history', { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 6 });
  const bts = (r as any).data.map((x: any) => x.time);
  console.log('basis ts (ms):', bts.map((t: number) => new Date(t).toISOString()).join(', '));
  console.log('basis ts mod 4h ms (should be 0):', bts.map((t: number) => t % (4*3600*1000)).join(', '));

  // candle ts grid
  const c = await query<any>(`SELECT ts::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m' ORDER BY ts DESC LIMIT 6`, []);
  console.log('candle ts:', c.rows.map((x: any) => new Date(parseInt(x.ts)).toISOString()).join(', '));

  // funding ts grid
  const f = await query<any>(`SELECT ts::text FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts DESC LIMIT 6`, []);
  console.log('funding ts:', f.rows.map((x: any) => new Date(parseInt(x.ts)).toISOString()).join(', '));
  console.log('funding ts mod 4h:', f.rows.map((x: any) => parseInt(x.ts) % (4*3600*1000)).join(', '));

  // overlap count basis ts vs candle ts
  const bAll = await cgGet<any[]>('/futures/basis/history', { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 4500 });
  const bset = new Set((bAll as any).data.map((x: any) => x.time));
  const cAll = await query<any>(`SELECT ts::text FROM candles WHERE symbol='BTCUSDT' AND tf='240m'`, []);
  let hit = 0;
  for (const row of cAll.rows) if (bset.has(parseInt(row.ts))) hit++;
  console.log(`basis rows=${bset.size}, candle rows=${cAll.rows.length}, exact-ts overlap=${hit}`);

  const fAll = await query<any>(`SELECT ts::text FROM cg_funding_oi_weighted WHERE symbol='BTC'`, []);
  let fhit = 0;
  for (const row of fAll.rows) if (bset.has(parseInt(row.ts))) fhit++;
  console.log(`funding rows=${fAll.rows.length}, exact-ts overlap with basis=${fhit}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
