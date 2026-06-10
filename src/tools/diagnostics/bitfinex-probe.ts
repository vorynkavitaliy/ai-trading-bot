/**
 * bitfinex-probe — read-only probe of Coinglass v4 Bitfinex margin long/short
 * and spot borrow interest-rate endpoints. Tries multiple path + symbol-format
 * variants because the default probe returned 0 rows.
 *
 * Run: npx tsx src/tools/diagnostics/bitfinex-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe {
  name: string;
  path: string;
  params: Record<string, string | number>;
}

// Try a broad set of path + param variants.
const probes: Probe[] = [
  // ---- Bitfinex margin long/short ----
  { name: 'mls v1 BTCUSD 4h',      path: '/bitfinex-margin-long-short',            params: { symbol: 'BTCUSD', interval: '4h', limit: 10 } },
  { name: 'mls v1 tBTCUSD 4h',     path: '/bitfinex-margin-long-short',            params: { symbol: 'tBTCUSD', interval: '4h', limit: 10 } },
  { name: 'mls v1 BTC 4h',         path: '/bitfinex-margin-long-short',            params: { symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'mls v1 pair BTCUSD',    path: '/bitfinex-margin-long-short',            params: { pair: 'BTCUSD', interval: '4h', limit: 10 } },
  { name: 'mls v1 BTCUSD 1d',      path: '/bitfinex-margin-long-short',            params: { symbol: 'BTCUSD', interval: '1d', limit: 10 } },
  { name: 'mls v1 BTCUSD 1h',      path: '/bitfinex-margin-long-short',            params: { symbol: 'BTCUSD', interval: '1h', limit: 10 } },
  { name: 'mls fut path BTCUSD',   path: '/futures/bitfinex-margin-long-short',    params: { symbol: 'BTCUSD', interval: '4h', limit: 10 } },
  { name: 'mls hist path BTCUSD',  path: '/bitfinex-margin-long-short/history',    params: { symbol: 'BTCUSD', interval: '4h', limit: 10 } },
  { name: 'mls no-params',         path: '/bitfinex-margin-long-short',            params: {} },
  { name: 'mls no-interval',       path: '/bitfinex-margin-long-short',            params: { symbol: 'BTCUSD', limit: 10 } },

  // ---- Spot borrow interest rate ----
  { name: 'borrow BTC 4h',         path: '/borrow-interest-rate',                  params: { symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'borrow BTC 1d',         path: '/borrow-interest-rate',                  params: { symbol: 'BTC', interval: '1d', limit: 10 } },
  { name: 'borrow BTC 1h',         path: '/borrow-interest-rate',                  params: { symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow exch BTC',       path: '/borrow-interest-rate',                  params: { exchange: 'Bitfinex', symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow fut path',       path: '/futures/borrow-interest-rate',          params: { symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow hist path',      path: '/borrow-interest-rate/history',          params: { symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow bitfinex path',  path: '/bitfinex/borrow-interest-rate',         params: { symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow no-params',      path: '/borrow-interest-rate',                  params: {} },
  { name: 'borrow USD',            path: '/borrow-interest-rate',                  params: { symbol: 'USD', interval: '1h', limit: 10 } },
  { name: 'borrow exchange-list',  path: '/borrow-interest-rate',                  params: { exchange_list: 'Bitfinex', symbol: 'BTC', interval: '1h', limit: 10 } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);
}

function describe(data: any): string {
  if (data == null) return 'data=null';
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : typeof first;
    return `array len=${data.length} firstKeys=${JSON.stringify(keys)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // column-array shape detection
    const colInfo: string[] = [];
    for (const k of keys) {
      const v = (data as any)[k];
      if (Array.isArray(v)) colInfo.push(`${k}[${v.length}]`);
    }
    if (colInfo.length) return `object cols={${colInfo.join(',')}} keys=${JSON.stringify(keys)}`;
    return `object keys=${JSON.stringify(keys)}`;
  }
  return `scalar ${String(data).slice(0, 60)}`;
}

async function main() {
  console.log('\n=== Bitfinex margin L/S + borrow-rate probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      const d = (r as any).data;
      console.log(`OK    ${p.name.padEnd(22)} ${p.path}`);
      console.log(`      code=${(r as any).code}  ${describe(d)}`);
      // print a sample value row for column-array shapes
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        const sample: any = {};
        for (const k of Object.keys(d)) {
          const v = (d as any)[k];
          if (Array.isArray(v)) sample[k] = v.slice(0, 2);
          else sample[k] = v;
        }
        console.log(`      sample=${JSON.stringify(sample).slice(0, 300)}`);
      } else if (Array.isArray(d) && d.length) {
        console.log(`      row0=${JSON.stringify(d[0]).slice(0, 300)}`);
      }
    } catch (e: any) {
      console.log(`FAIL  ${p.name.padEnd(22)} ${p.path}`);
      console.log(`      ${String(e?.message ?? e).slice(0, 220)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  console.log('\n=== done ===\n');
}

main().catch(e => { console.error('crashed', e?.message ?? e); process.exit(1); });
