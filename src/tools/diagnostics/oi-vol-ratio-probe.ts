/**
 * oi-vol-ratio-probe (round 2) — hunt the futures-vs-spot volume ratio path.
 * Read-only, BTC. The options-vs-futures-oi-ratio path is already confirmed
 * (/index/option-vs-futures-oi-ratio). Now brute the obvious vol-ratio variants.
 */
import { cgGet } from '../../core/coinglass';

interface Cand { name: string; path: string; params: Record<string, string | number>; }

const candidates: Cand[] = [
  { name: 'v1', path: '/index/spot-vs-futures-volume-ratio', params: {} },
  { name: 'v2', path: '/index/volume-ratio', params: {} },
  { name: 'v3', path: '/futures/volume-ratio', params: { symbol: 'BTC' } },
  { name: 'v4', path: '/spot/spot-vs-futures-volume-ratio', params: {} },
  { name: 'v5', path: '/index/futures-spot-trading-volume-ratio', params: {} },
  { name: 'v6', path: '/futures/volume/spot-vs-futures-ratio', params: { symbol: 'BTC' } },
  { name: 'v7', path: '/index/option-vs-futures-volume-ratio', params: {} },
  { name: 'v8', path: '/index/volume-vs-open-interest-ratio', params: {} },
  // spot/futures volume series we could form a ratio from ourselves:
  { name: 's-spot-vol',  path: '/spot/aggregated-taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: 'BTCUSDT', interval: '1d', limit: 5 } },
  { name: 's-fut-vol',   path: '/futures/aggregated-taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: 'BTC', interval: '1d', limit: 5 } },
];

function describe(data: any): string {
  if (data == null) return 'null';
  if (Array.isArray(data)) {
    const first = data[0], last = data[data.length - 1];
    const keys = first && typeof first === 'object' ? Object.keys(first) : null;
    return `ARRAY len=${data.length} keys=${JSON.stringify(keys)} first=${JSON.stringify(first)?.slice(0,160)} last=${JSON.stringify(last)?.slice(0,160)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    let extra = '';
    if (Array.isArray((data as any).time_list)) {
      const tl = (data as any).time_list;
      extra = ` time_list len=${tl.length} first=${tl[0]} last=${tl[tl.length-1]}`;
    }
    return `OBJECT keys=${JSON.stringify(keys)}${extra}`;
  }
  return `scalar ${String(data)}`;
}

async function main() {
  for (const c of candidates) {
    try {
      const r = await cgGet<any>(c.path, c.params);
      console.log(`OK    ${c.name}  ${c.path}`);
      console.log(`      ${describe((r as any).data)}`);
    } catch (e: any) {
      console.log(`FAIL  ${c.name}  ${c.path}  ${(e?.message ?? String(e)).slice(0, 120)}`);
    }
    await new Promise((res) => setTimeout(res, 350));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? String(e)); process.exit(1); });
