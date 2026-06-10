/**
 * spot-flow-probe — read-only probe of Coinglass v4 SPOT order-flow endpoints
 * (spot aggregated CVD / spot taker buy-sell volume / spot netflow) to confirm
 * which paths return 200 + how deep the history is, plus the response shape.
 *
 * Pure HTTP. No DB. Run: npx tsx src/tools/diagnostics/spot-flow-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 350;

interface Probe {
  name: string;
  path: string;
  params: Record<string, string | number>;
}

// Candidate spot order-flow paths. We try several plausible v4 variants for each
// archetype because the doc-slug is only a hint.
const probes: Probe[] = [
  // ---- Spot aggregated taker buy/sell volume (the CVD building block) ----
  { name: 'spot-agg-taker(BTCUSDT,4h)', path: '/spot/aggregated-taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  { name: 'spot-agg-taker(BTC,4h)', path: '/spot/aggregated-taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'spot-agg-taker(multiEx,BTCUSDT,4h)', path: '/spot/aggregated-taker-buy-sell-volume/history', params: { exchange_list: 'Binance,OKX,Coinbase', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  // ---- Spot per-pair taker buy/sell volume ----
  { name: 'spot-pair-taker(BTCUSDT,4h)', path: '/spot/taker-buy-sell-volume/history', params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  { name: 'spot-pair-taker(BTCUSDT,4h,exchange_list)', path: '/spot/taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  // ---- Spot aggregated CVD ----
  { name: 'spot-agg-cvd(BTC,4h)', path: '/spot/aggregated-cvd-history', params: { exchange_list: 'Binance', symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'spot-agg-cvd(BTCUSDT,4h)', path: '/spot/aggregated-cvd-history', params: { exchange_list: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  { name: 'spot-agg-cvd-alt(BTC,4h)', path: '/spot/aggregated-cvd/history', params: { exchange_list: 'Binance', symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'futures-agg-cvd(BTC,4h)', path: '/futures/aggregated-cvd-history', params: { exchange_list: 'Binance', symbol: 'BTC', interval: '4h', limit: 10 } },
  // ---- Spot netflow / exchange flow ----
  { name: 'spot-netflow(BTC,4h)', path: '/spot/netflow', params: { symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'spot-netflow-hist(BTC,4h)', path: '/spot/netflow-history', params: { symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'exchange-netflow(BTC)', path: '/spot/exchange-netflow', params: { symbol: 'BTC', interval: '4h', limit: 10 } },
  // ---- Spot OHLC sanity (does /spot data class exist at all?) ----
  { name: 'spot-pairs-markets', path: '/spot/pairs-markets', params: { symbol: 'BTC' } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);
}

function shapeOf(data: any): { rows: number; keys: string[]; sample: any } {
  if (Array.isArray(data)) {
    const first = data[0];
    return { rows: data.length, keys: first && typeof first === 'object' ? Object.keys(first) : [], sample: first };
  }
  if (data && typeof data === 'object') {
    for (const k of ['list', 'data_list', 'time_list', 'data']) {
      if (Array.isArray((data as any)[k])) {
        const arr = (data as any)[k];
        const first = arr[0];
        return { rows: arr.length, keys: first && typeof first === 'object' ? Object.keys(first) : [`[${k} array]`], sample: first };
      }
    }
    return { rows: 1, keys: Object.keys(data), sample: data };
  }
  return { rows: data == null ? 0 : 1, keys: [], sample: data };
}

async function main() {
  console.log('=== spot-flow-probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      const { rows, keys, sample } = shapeOf((r as any).data);
      console.log(`OK   ${rows} rows  ${p.name}  ${p.path}`);
      console.log(`     keys: ${JSON.stringify(keys).slice(0, 300)}`);
      console.log(`     sample: ${JSON.stringify(sample).slice(0, 300)}`);
    } catch (e: any) {
      console.log(`ERR  ${p.name}  ${p.path}`);
      console.log(`     ${(e?.message ?? String(e)).slice(0, 240)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
