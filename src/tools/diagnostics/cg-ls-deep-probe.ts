// Probe L/S endpoint for deeper history via different intervals or paging params.
import { cgGet } from '../../core/coinglass';

async function probe(label: string, params: any) {
  try {
    const r = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', params);
    const d = r.data ?? [];
    if (d.length === 0) { console.log(`${label}: empty`); return; }
    const span = ((d[d.length-1].time - d[0].time) / 86_400_000).toFixed(0);
    console.log(`${label}: ${d.length} rows, span=${span}d  ${new Date(d[0].time).toISOString().slice(0,10)} → ${new Date(d[d.length-1].time).toISOString().slice(0,10)}`);
  } catch (e: any) {
    console.log(`${label}: ERROR ${e?.message?.slice(0,100)}`);
  }
}

async function main() {
  const base = { exchange: 'Binance', symbol: 'BTCUSDT' };
  // Try different intervals + limits
  await probe('4h_540',  { ...base, interval: '4h', limit: 540 });
  await probe('4h_4500', { ...base, interval: '4h', limit: 4500 });
  await probe('1d_4500', { ...base, interval: '1d', limit: 4500 });
  await probe('1h_4500', { ...base, interval: '1h', limit: 4500 });
  // Try end_time param to page
  const endTs = Date.parse('2026-01-29T00:00:00Z');
  await probe('4h_end_2026-01-29', { ...base, interval: '4h', limit: 4500, end_time: endTs });
  await probe('4h_end_str', { ...base, interval: '4h', limit: 4500, endTime: endTs });
  await probe('4h_end_s', { ...base, interval: '4h', limit: 4500, end_time: Math.floor(endTs / 1000) });
}

main().catch(e => { console.error(e); process.exit(1); });
