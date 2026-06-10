/**
 * cg-large-ob-depth — measure history depth of the large-limit-order endpoints
 * and the time span we can actually get. Read-only.
 * Run: npx tsx src/tools/diagnostics/cg-large-ob-depth.ts
 */
import { cgGet } from '../../core/coinglass';

async function tryCall(label: string, path: string, params: Record<string, any>) {
  try {
    const r: any = await cgGet<any>(path, params);
    const d = r.data;
    if (Array.isArray(d)) {
      const times = d.map((x: any) => x.start_time ?? x.current_time ?? x.order_end_time ?? x.time).filter(Boolean);
      const min = Math.min(...times), max = Math.max(...times);
      const sides = d.reduce((acc: any, x: any) => { acc[x.order_side] = (acc[x.order_side] ?? 0) + 1; return acc; }, {});
      const states = d.reduce((acc: any, x: any) => { acc[x.order_state] = (acc[x.order_state] ?? 0) + 1; return acc; }, {});
      console.log(`${label}: len=${d.length}  tspan=${new Date(min).toISOString()} .. ${new Date(max).toISOString()}`);
      console.log(`   order_side counts=${JSON.stringify(sides)}  order_state counts=${JSON.stringify(states)}`);
    } else {
      console.log(`${label}: non-array`, JSON.stringify(d).slice(0, 200));
    }
  } catch (e: any) {
    console.log(`${label}: ERR ${(e?.message ?? String(e)).slice(0, 180)}`);
  }
}

async function main() {
  // history with big limit
  await tryCall('hist limit=4000', '/futures/orderbook/large-limit-order-history', { exchange: 'Binance', symbol: 'BTCUSDT', limit: 4000 });
  await new Promise(r => setTimeout(r, 400));
  await tryCall('hist no-limit', '/futures/orderbook/large-limit-order-history', { exchange: 'Binance', symbol: 'BTCUSDT' });
  await new Promise(r => setTimeout(r, 400));
  // try with time params
  await tryCall('hist start/end', '/futures/orderbook/large-limit-order-history', { exchange: 'Binance', symbol: 'BTCUSDT', start_time: 1750000000000, end_time: 1781000000000, limit: 4000 });
  await new Promise(r => setTimeout(r, 400));
  // live snapshot
  await tryCall('live snapshot', '/futures/orderbook/large-limit-order', { exchange: 'Binance', symbol: 'BTCUSDT' });
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
