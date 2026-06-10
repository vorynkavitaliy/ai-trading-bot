/**
 * bitfinex-probe2 — round 2. Pin down:
 *  (a) borrow-interest-rate/history correct params (needs `exchange`)
 *  (b) Bitfinex margin L/S max history depth + time unit + intervals supported
 *
 * Run: npx tsx src/tools/diagnostics/bitfinex-probe2.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 20_000;
const PACE_MS = 400;

interface Probe { name: string; path: string; params: Record<string, string | number>; }

const probes: Probe[] = [
  // borrow rate history with exchange variants
  { name: 'borrow hist Bitfinex BTC 1h', path: '/borrow-interest-rate/history', params: { exchange: 'Bitfinex', symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow hist Bitfinex BTC 4h', path: '/borrow-interest-rate/history', params: { exchange: 'Bitfinex', symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'borrow hist Bitfinex BTC 1d', path: '/borrow-interest-rate/history', params: { exchange: 'Bitfinex', symbol: 'BTC', interval: '1d', limit: 10 } },
  { name: 'borrow hist Bitfinex USD 1h', path: '/borrow-interest-rate/history', params: { exchange: 'Bitfinex', symbol: 'USD', interval: '1h', limit: 10 } },
  { name: 'borrow hist Binance BTC 1h',  path: '/borrow-interest-rate/history', params: { exchange: 'Binance', symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow hist OKX BTC 1h',      path: '/borrow-interest-rate/history', params: { exchange: 'OKX', symbol: 'BTC', interval: '1h', limit: 10 } },
  { name: 'borrow hist no-symbol',       path: '/borrow-interest-rate/history', params: { exchange: 'Bitfinex', interval: '1h', limit: 10 } },

  // margin L/S deep history — large limit to gauge depth
  { name: 'mls BTC 4h limit4000',  path: '/bitfinex-margin-long-short', params: { symbol: 'BTC', interval: '4h', limit: 4000 } },
  { name: 'mls BTC 1d limit2000',  path: '/bitfinex-margin-long-short', params: { symbol: 'BTC', interval: '1d', limit: 2000 } },
  { name: 'mls BTC 1h limit500',   path: '/bitfinex-margin-long-short', params: { symbol: 'BTC', interval: '1h', limit: 500 } },
  { name: 'mls BTC 12h limit2000', path: '/bitfinex-margin-long-short', params: { symbol: 'BTC', interval: '12h', limit: 2000 } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms))]);
}

async function main() {
  console.log('\n=== Bitfinex probe round 2 ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      const d: any = (r as any).data;
      if (Array.isArray(d)) {
        const n = d.length;
        const f = d[0]; const l = d[n - 1];
        const ft = f?.time; const lt = l?.time;
        const fDate = ft ? new Date(ft > 1e12 ? ft : ft * 1000).toISOString() : '?';
        const lDate = lt ? new Date(lt > 1e12 ? lt : lt * 1000).toISOString() : '?';
        console.log(`OK    ${p.name.padEnd(28)} len=${n}`);
        console.log(`      keys=${JSON.stringify(f ? Object.keys(f) : [])}`);
        console.log(`      span ${fDate} .. ${lDate}`);
        console.log(`      row0=${JSON.stringify(f).slice(0, 200)}`);
        console.log(`      rowN=${JSON.stringify(l).slice(0, 200)}`);
      } else {
        console.log(`OK    ${p.name.padEnd(28)} non-array: ${JSON.stringify(d).slice(0, 200)}`);
      }
    } catch (e: any) {
      console.log(`FAIL  ${p.name.padEnd(28)} ${String(e?.message ?? e).slice(0, 180)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  console.log('\n=== done ===\n');
}
main().catch(e => { console.error('crashed', e?.message ?? e); process.exit(1); });
