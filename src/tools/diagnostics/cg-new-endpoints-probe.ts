// Probe new endpoints we haven't explored yet:
//   ETF flows, exchange reserves, Coinbase Premium, taker aggregated, premium index
import { cgGet } from '../../core/coinglass';

interface Probe {
  name: string;
  path: string;
  params: Record<string, any>;
}

const PROBES: Probe[] = [
  { name: 'btc_etf_flow', path: '/bitcoin/etf-net-assets/history', params: {} },
  { name: 'btc_etf_flow_alt', path: '/bitcoin/etf-flow-history', params: {} },
  { name: 'btc_etf_v4', path: '/etf/bitcoin/flow-history', params: {} },
  { name: 'eth_etf_flow', path: '/ethereum/etf-flow-history', params: {} },
  { name: 'cb_premium', path: '/coinbase-premium-index', params: { interval: '4h', limit: 10 } },
  { name: 'cb_premium_alt', path: '/futures/coinbase-premium-index', params: { interval: '4h', limit: 10 } },
  { name: 'exchange_balance', path: '/exchange/balance/list', params: { symbol: 'BTC' } },
  { name: 'exchange_chain_tx', path: '/exchange/chain/tx/list', params: { symbol: 'BTC' } },
  { name: 'premium_index', path: '/futures/premium-index', params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  { name: 'agg_taker', path: '/futures/aggregated-taker-buy-sell-volume/history', params: { symbol: 'BTC', interval: '4h', limit: 10, exchange_list: 'Binance,OKX,Bybit' } },
  { name: 'agg_liq', path: '/futures/liquidation/aggregated-history', params: { symbol: 'BTC', interval: '4h', limit: 10, exchange_list: 'Binance,OKX,Bybit' } },
  { name: 'fr_arbitrage', path: '/futures/funding-rate/arbitrage', params: { symbol: 'BTC' } },
  { name: 'liq_order', path: '/futures/liquidation/order', params: { symbol: 'BTCUSDT', exchange: 'Binance' } },
  { name: 'fear_greed', path: '/index/fear-greed-history', params: { interval: '4h', limit: 10 } },
  { name: 'cgdi', path: '/index/cgdi', params: {} },
  { name: 'cdri', path: '/index/cdri', params: {} },
];

async function main() {
  for (const p of PROBES) {
    try {
      const r = await cgGet(p.path, p.params);
      const data = (r.data ?? []) as any;
      const isArr = Array.isArray(data);
      const len = isArr ? data.length : (data?.list?.length ?? (typeof data === 'object' ? Object.keys(data).length : 0));
      const sample = isArr ? data[0] : data;
      console.log(`✅ ${p.name.padEnd(22)} ${p.path}  →  ${len} rows`);
      if (sample) console.log(`   sample: ${JSON.stringify(sample).slice(0, 200)}`);
    } catch (e: any) {
      const msg = (e?.message ?? String(e)).slice(0, 100);
      console.log(`❌ ${p.name.padEnd(22)} ${p.path}  ERROR: ${msg}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
