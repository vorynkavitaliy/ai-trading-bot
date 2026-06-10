import { cgGet } from '../../core/coinglass';

function ts(t: any) { const n = Number(t); return Number.isFinite(n) ? new Date(n).toISOString() : String(t); }

async function main() {
  // 1. exchange balance chart — full structure + range
  const bal: any = await cgGet<any>('/exchange/balance/chart', { symbol: 'BTC' });
  const d = bal.data;
  const tl = d.time_list as number[];
  console.log('=== /exchange/balance/chart (BTC) ===');
  console.log('keys:', Object.keys(d));
  console.log('time_list len:', tl.length, 'first:', ts(tl[0]), 'last:', ts(tl[tl.length-1]));
  console.log('exchanges in data_map:', Object.keys(d.data_map));
  // total = sum across exchanges per index (handle missing)
  const exNames = Object.keys(d.data_map);
  console.log('Coinbase head:', (d.data_map['Coinbase']||[]).slice(0,3), 'tail:', (d.data_map['Coinbase']||[]).slice(-3));
  console.log('price_list head:', d.price_list.slice(0,3), 'tail:', d.price_list.slice(-3));

  // 2. stablecoin marketcap
  const sc: any = await cgGet<any>('/index/stableCoin-marketCap-history', {});
  const sd = sc.data;
  const stl = sd.time_list as number[];
  console.log('\n=== /index/stableCoin-marketCap-history ===');
  console.log('keys:', Object.keys(sd));
  console.log('time_list len:', stl.length, 'first:', ts(stl[0]), 'last:', ts(stl[stl.length-1]));
  console.log('data_list[0] keys:', Object.keys(sd.data_list[0]||{}), 'sample:', JSON.stringify(sd.data_list[0]));
  console.log('data_list[last]:', JSON.stringify(sd.data_list[sd.data_list.length-1]));
  console.log('price_list head:', sd.price_list.slice(0,2), 'tail:', sd.price_list.slice(-2));

  // 3. chain tx list — inspect raw
  try {
    const tx: any = await cgGet<any>('/exchange/chain/tx/list', { symbol: 'BTC' });
    console.log('\n=== /exchange/chain/tx/list (BTC) ===');
    console.log('typeof data:', typeof tx.data, 'isArray:', Array.isArray(tx.data));
    console.log('raw data:', JSON.stringify(tx.data).slice(0, 600));
  } catch (e: any) { console.log('chain tx err:', e.message); }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
