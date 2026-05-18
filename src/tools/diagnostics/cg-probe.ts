// Probe Coinglass API tier: test which endpoints work for new symbols (HYPE, ARB, INJ, TAO)
// and verify symbol coverage / rate limits after plan upgrade.
import { cgGet } from '../../core/coinglass';

const TEST_COINS = ['HYPE', 'ARB', 'INJ', 'TAO', 'BTC'];
const REF_EX = 'Binance';

// Endpoints we already use vs new ones to probe.
// Format: { name, path, params (templated with {{coin}}/{{pair}}) }
const ENDPOINTS: Array<{ name: string; path: string; params: (coin: string) => Record<string, string | number> }> = [
  { name: 'oi_aggregated_history',  path: '/futures/open-interest/aggregated-history',          params: c => ({ symbol: c, interval: '4h', limit: 10 }) },
  { name: 'fr_oi_weighted_history', path: '/futures/funding-rate/oi-weight-history',            params: c => ({ symbol: c, interval: '4h', limit: 10 }) },
  { name: 'fr_vol_weighted_history',path: '/futures/funding-rate/vol-weight-history',           params: c => ({ symbol: c, interval: '4h', limit: 10 }) },
  { name: 'ls_top_position',        path: '/futures/top-long-short-position-ratio/history',     params: c => ({ exchange: REF_EX, symbol: `${c}USDT`, interval: '4h', limit: 10 }) },
  { name: 'liquidation_pair',       path: '/futures/liquidation/aggregated-history',            params: c => ({ symbol: c, interval: '4h', limit: 10 }) },
  { name: 'taker_volume',           path: '/futures/aggregated-taker-buy-sell-volume/history',  params: c => ({ symbol: c, interval: '4h', limit: 10 }) },
  // New endpoints to probe — see if they're available on Standard
  { name: 'liq_heatmap',            path: '/futures/liquidation/heatmap/model2',                params: c => ({ exchange: REF_EX, symbol: `${c}USDT`, range: '1d' }) },
  { name: 'liq_map',                path: '/futures/liquidation/map',                           params: c => ({ exchange: REF_EX, symbol: `${c}USDT`, range: '1d' }) },
  { name: 'orderbook_history',      path: '/futures/orderbook/ask-bids-history',                params: c => ({ exchange: REF_EX, symbol: `${c}USDT`, interval: '4h', limit: 10 }) },
  { name: 'large_orderbook',        path: '/futures/orderbook/large-limit-order',               params: c => ({ exchange: REF_EX, symbol: `${c}USDT` }) },
  { name: 'hyperliquid_pos',        path: '/hyperliquid/whale-position',                        params: _ => ({}) },
  { name: 'whale_alert',            path: '/hyperliquid/whale-alert',                           params: _ => ({}) },
];

async function probe(endpoint: typeof ENDPOINTS[number], coin: string): Promise<{ ok: boolean; note: string; sample?: any }> {
  try {
    const params = endpoint.params(coin);
    const r = await cgGet(endpoint.path, params);
    const data = r.data as any;
    const isArr = Array.isArray(data);
    const len = isArr ? data.length : (data?.list?.length ?? data?.data?.length ?? 0);
    return {
      ok: true,
      note: `${len} rows`,
      sample: isArr && data.length > 0 ? data[0] : (data?.list?.[0] ?? data?.data?.[0] ?? data),
    };
  } catch (e: any) {
    return { ok: false, note: (e?.message ?? String(e)).slice(0, 120) };
  }
}

async function main() {
  console.log('=== Coinglass API Probe — Standard tier check ===\n');

  for (const ep of ENDPOINTS) {
    console.log(`-- ${ep.name} (${ep.path})`);
    for (const coin of TEST_COINS) {
      const r = await probe(ep, coin);
      const status = r.ok ? '✅' : '❌';
      console.log(`   ${status} ${coin.padEnd(5)}  ${r.note}`);
      await new Promise(s => setTimeout(s, 250)); // 4 req/sec — well within 300/min
    }
    console.log('');
  }

  console.log('=== Probe done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
