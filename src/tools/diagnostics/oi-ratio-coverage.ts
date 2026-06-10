/**
 * oi-ratio-coverage round2 — check history depth of fut + spot taker volume daily
 * (BTC) for building a futures-vs-spot volume ratio, and re-confirm OI-ratio depth.
 */
import { cgGet } from '../../core/coinglass';

function depth(d: any): string {
  if (Array.isArray(d)) {
    const f = d[0], l = d[d.length - 1];
    const ft = f?.time ?? f?.timestamp, lt = l?.time ?? l?.timestamp;
    return `len=${d.length} first=${ft ? new Date(Number(ft)).toISOString().slice(0,10) : '?'} last=${lt ? new Date(Number(lt)).toISOString().slice(0,10) : '?'}`;
  }
  return 'non-array';
}

async function main() {
  const fut = await cgGet<any>('/futures/aggregated-taker-buy-sell-volume/history', { exchange_list: 'Binance', symbol: 'BTC', interval: '1d', limit: 3000 });
  console.log('fut taker vol daily:', depth((fut as any).data));
  await new Promise(r=>setTimeout(r,350));
  const spot = await cgGet<any>('/spot/aggregated-taker-buy-sell-volume/history', { exchange_list: 'Binance', symbol: 'BTC', interval: '1d', limit: 3000 });
  console.log('spot taker vol daily:', depth((spot as any).data));
  await new Promise(r=>setTimeout(r,350));
  const oi = await cgGet<any>('/index/option-vs-futures-oi-ratio', {});
  const d = (oi as any).data;
  console.log('oi ratio daily:', depth(d));
  // cadence check
  if (Array.isArray(d) && d.length > 3) {
    const dt = Number(d[1].timestamp) - Number(d[0].timestamp);
    console.log('  oi-ratio cadence ms between rows[0,1]:', dt, '(86400000 = daily)');
    console.log('  sample rows:', JSON.stringify(d.slice(0,2)), '...', JSON.stringify(d.slice(-2)));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });
