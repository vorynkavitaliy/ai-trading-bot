// Probe which CG endpoints support 5m interval on Standard plan.
import { cgGet } from '../../core/coinglass';

const probes: Array<{ name: string; path: string; params: any }> = [
  { name: 'oi_aggregated',     path: '/futures/open-interest/aggregated-history',       params: { symbol: 'BTC', interval: '5m', limit: 10 } },
  { name: 'funding_oi_w',      path: '/futures/funding-rate/oi-weight-history',         params: { symbol: 'BTC', interval: '5m', limit: 10 } },
  { name: 'ls_top_pos',        path: '/futures/top-long-short-position-ratio/history',  params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', limit: 10 } },
  { name: 'ls_top_acct',       path: '/futures/top-long-short-account-ratio/history',   params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', limit: 10 } },
  { name: 'ls_global',         path: '/futures/global-long-short-account-ratio/history',params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', limit: 10 } },
  { name: 'taker_pair',        path: '/futures/taker-buy-sell-volume/history',          params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', limit: 10 } },
  { name: 'liq_pair',          path: '/futures/liquidation/history',                    params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', limit: 10 } },
  { name: 'ob_history',        path: '/futures/orderbook/ask-bids-history',             params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', range: 5, limit: 10 } },
  { name: 'cb_premium',        path: '/coinbase-premium-index',                         params: { interval: '5m', limit: 10 } },
  { name: 'agg_taker',         path: '/futures/aggregated-taker-buy-sell-volume/history', params: { symbol: 'BTC', interval: '5m', limit: 10, exchange_list: 'Binance,OKX,Bybit' } },
  { name: 'agg_liq',           path: '/futures/liquidation/aggregated-history',         params: { symbol: 'BTC', interval: '5m', limit: 10, exchange_list: 'Binance,OKX,Bybit' } },
];

async function main() {
  console.log('=== 5m interval probe (Standard plan) ===\n');
  for (const p of probes) {
    try {
      const r = await cgGet<any[]>(p.path, p.params);
      const d = r.data ?? [];
      console.log(`✅ ${p.name.padEnd(18)} ${d.length} rows  sample: ${JSON.stringify(d[0]).slice(0, 130)}`);
    } catch (e: any) {
      console.log(`❌ ${p.name.padEnd(18)} ERROR: ${e?.message?.slice(0,100)}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  // Now check max coverage on 5m for one endpoint
  console.log('\n=== 5m coverage depth ===');
  for (const limit of [4500, 9000]) {
    try {
      const r = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', {
        exchange: 'Binance', symbol: 'BTCUSDT', interval: '5m', limit,
      });
      const d = r.data ?? [];
      const span = ((d[d.length-1].time - d[0].time) / 86_400_000).toFixed(1);
      console.log(`ls_top_pos limit=${limit}: ${d.length} rows, span ${span}d (${new Date(d[0].time).toISOString().slice(0,10)} → ${new Date(d[d.length-1].time).toISOString().slice(0,10)})`);
    } catch (e: any) {
      console.log(`limit=${limit} ERROR: ${e?.message?.slice(0,80)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
