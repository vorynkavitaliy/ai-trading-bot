/**
 * Probe supply/liquidity-tide CG v4 endpoints: exchange BTC reserves (balance chart),
 * exchange on-chain transfers (whale-to-exchange flow), stablecoin marketcap history.
 * Read-only. Tries several path variants per family, prints HTTP/CG outcome,
 * row count, first+last timestamp, and first-row keys/shape.
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe { name: string; path: string; params: Record<string, string | number>; }

const probes: Probe[] = [
  // Exchange BTC reserves — balance over time (chart/history variants)
  { name: 'ex-balance-chart',        path: '/exchange/balance/chart',           params: { symbol: 'BTC' } },
  { name: 'ex-balance-chart-int',    path: '/exchange/balance/chart',           params: { symbol: 'BTC', interval: '1d' } },
  { name: 'ex-balance-list',         path: '/exchange/balance/list',            params: { symbol: 'BTC' } },
  { name: 'ex-balance-history',      path: '/exchange/balance/history',         params: { symbol: 'BTC' } },
  { name: 'ex-assets-history',       path: '/exchange/assets/history',          params: { symbol: 'BTC' } },
  { name: 'ex-reserve-history',      path: '/exchange/reserve/history',         params: { symbol: 'BTC' } },
  // On-chain / whale transfers to-from exchanges
  { name: 'ex-chain-tx-list',        path: '/exchange/chain/tx/list',           params: { symbol: 'BTC' } },
  { name: 'ex-onchain-transfers',    path: '/exchange/onchain/transfers',       params: { symbol: 'BTC' } },
  { name: 'whale-transfer',          path: '/whale-transfer',                   params: { symbol: 'BTC' } },
  { name: 'whale-alert',             path: '/whale/alert',                      params: {} },
  // Stablecoin marketcap (supply tide) — coin total + chart variants
  { name: 'stablecoin-mcap',         path: '/index/stableCoin-marketCap-history', params: {} },
  { name: 'stablecoin-mcap-2',       path: '/index/stablecoin-marketcap-history', params: {} },
  { name: 'stablecoin-mcap-3',       path: '/stablecoin/marketcap/history',     params: {} },
  { name: 'stablecoin-mcap-4',       path: '/index/usdt-marketcap-history',     params: {} },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms ${label}`)), ms))]);
}

function summarize(data: any): string {
  if (data == null) return 'data=null';
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : typeof first;
    // try to find time field
    let tmin: any = null, tmax: any = null;
    if (first && typeof first === 'object') {
      const tk = Object.keys(first).find(k => /time|ts|date/i.test(k));
      if (tk) { tmin = data[0][tk]; tmax = data[data.length-1][tk]; }
    }
    return `array len=${data.length} keys=${JSON.stringify(keys)} tmin=${tmin} tmax=${tmax} sample0=${JSON.stringify(first).slice(0,200)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // column-array shapes
    const detail: string[] = [];
    for (const k of keys) {
      const v = (data as any)[k];
      if (Array.isArray(v)) detail.push(`${k}[${v.length}] s=${JSON.stringify(v.slice(0,2))}`);
      else detail.push(`${k}=${JSON.stringify(v).slice(0,60)}`);
    }
    return `object keys=${JSON.stringify(keys)} :: ${detail.join(' | ').slice(0,400)}`;
  }
  return `scalar ${JSON.stringify(data).slice(0,120)}`;
}

async function main() {
  console.log('=== supply/liquidity-tide probe ===\n');
  for (const p of probes) {
    try {
      const r: any = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name.padEnd(22)} ${p.path}`);
      console.log(`     code=${r.code} ${summarize(r.data)}`);
    } catch (e: any) {
      console.log(`ERR  ${p.name.padEnd(22)} ${p.path}`);
      console.log(`     ${(e?.message ?? String(e)).slice(0, 220)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  process.exit(0);
}
main().catch(e => { console.error('crash', e?.message ?? String(e)); process.exit(1); });
