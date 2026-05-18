// Check coverage depth of Coinbase Premium and ETF Flow endpoints.
import { cgGet } from '../../core/coinglass';

async function probe(name: string, path: string, params: any) {
  const r = await cgGet<any[]>(path, params);
  const d = r.data ?? [];
  if (d.length === 0) { console.log(`${name}: empty`); return; }
  // figure out time field
  const first = d[0];
  const last = d[d.length - 1];
  const tsField = 'time' in first ? 'time' : 'timestamp' in first ? 'timestamp' : null;
  if (!tsField) { console.log(`${name}: no time field, keys=${Object.keys(first).join(',')}`); return; }
  // first.time might be sec or ms
  let firstMs = Number(first[tsField]);
  let lastMs = Number(last[tsField]);
  if (firstMs < 1e12) { firstMs *= 1000; lastMs *= 1000; }
  const spanDays = ((lastMs - firstMs) / 86_400_000).toFixed(0);
  console.log(`${name.padEnd(20)} rows=${String(d.length).padStart(5)}  span=${spanDays}d  ${new Date(firstMs).toISOString().slice(0,10)} → ${new Date(lastMs).toISOString().slice(0,10)}`);
}

async function main() {
  await probe('cb_premium_4h_4500', '/coinbase-premium-index', { interval: '4h', limit: 4500 });
  await probe('cb_premium_1h_4500', '/coinbase-premium-index', { interval: '1h', limit: 4500 });
  await probe('cb_premium_1d_4500', '/coinbase-premium-index', { interval: '1d', limit: 4500 });
  await probe('etf_flow_full',     '/etf/bitcoin/flow-history', {});
  await probe('agg_taker_4500',    '/futures/aggregated-taker-buy-sell-volume/history', { symbol: 'BTC', interval: '4h', limit: 4500, exchange_list: 'Binance,OKX,Bybit' });
  await probe('agg_liq_4500',      '/futures/liquidation/aggregated-history', { symbol: 'BTC', interval: '4h', limit: 4500, exchange_list: 'Binance,OKX,Bybit' });
  await probe('fg_4500',           '/index/fear-greed-history', { interval: '4h', limit: 4500 });
}

main().catch(e => { console.error(e); process.exit(1); });
