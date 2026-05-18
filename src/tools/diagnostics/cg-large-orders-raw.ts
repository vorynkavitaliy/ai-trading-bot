// Dump raw response of Large Orderbook endpoint — find actual field names
// (last probe returned NaN for prices/sizes).
import { cgGet } from '../../core/coinglass';

async function main() {
  const r = await cgGet<any[]>('/futures/orderbook/large-limit-order', {
    exchange: 'Binance', symbol: 'BTCUSDT',
  });
  const orders = r.data ?? [];
  console.log(`got ${orders.length} orders`);
  console.log('first 3 raw rows:');
  for (const o of orders.slice(0, 3)) {
    console.log(JSON.stringify(o, null, 2));
  }
  if (orders.length > 0) {
    console.log('\nall keys in first row:', Object.keys(orders[0]).join(', '));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
