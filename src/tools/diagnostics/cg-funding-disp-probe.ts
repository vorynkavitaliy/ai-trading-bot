/**
 * cg-funding-disp-probe — read-only probe of Coinglass v4 funding-rate cross-exchange
 * / arbitrage endpoints. We want the per-exchange funding history (so we can compute
 * cross-exchange DISPERSION), not the OI-weighted mean we already fade.
 *
 * Pure HTTP. Hits each candidate path once, classifies, and on 200 prints a deep shape
 * dump (top-level keys, array lengths, first row, ts sample) so we can model dispersion.
 *
 * Run: npx tsx src/tools/diagnostics/cg-funding-disp-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PACE_MS = 350;
const PER_CALL_TIMEOUT_MS = 15_000;

interface Probe {
  name: string;
  path: string;
  params: Record<string, string | number>;
}

// Candidate v4 paths for cross-exchange funding. We try the doc-hint slugs plus
// the obvious variants before concluding 404.
const probes: Probe[] = [
  // --- arbitrage / spread "now" snapshots ---
  { name: 'fr-arbitrage',            path: '/futures/funding-rate/fr-arbitrage',            params: { symbol: 'BTC' } },
  { name: 'fr-arbitrage-noparam',    path: '/futures/funding-rate/fr-arbitrage',            params: {} },
  { name: 'arbitrage',               path: '/futures/funding-rate/arbitrage',               params: { symbol: 'BTC' } },
  // --- per-exchange funding tables (the gold: lets us compute dispersion ourselves) ---
  { name: 'exchange-list',           path: '/futures/funding-rate/exchange-list',           params: { symbol: 'BTC' } },
  { name: 'exchange-list-noparam',   path: '/futures/funding-rate/exchange-list',           params: {} },
  { name: 'cumulative-exchange-list',path: '/futures/funding-rate/cumulative-exchange-list',params: { symbol: 'BTC' } },
  { name: 'cum-exch-list-range',     path: '/futures/funding-rate/cumulative-exchange-list',params: { symbol: 'BTC', range: '1d' } },
  // --- per-exchange funding HISTORY (best for IS/OOS time series) ---
  { name: 'exchange-history',        path: '/futures/funding-rate/exchange-history',        params: { symbol: 'BTC', interval: '4h', limit: 5 } },
  { name: 'history',                 path: '/futures/funding-rate/history',                 params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5 } },
  { name: 'oi-weight-history',       path: '/futures/funding-rate/oi-weight-history',       params: { symbol: 'BTC', interval: '4h', limit: 5 } },
  { name: 'vol-weight-history',      path: '/futures/funding-rate/vol-weight-history',      params: { symbol: 'BTC', interval: '4h', limit: 5 } },
  { name: 'accumulated-exchange',    path: '/futures/funding-rate/accumulated-exchange-list', params: { symbol: 'BTC', range: '1d' } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);
}

function describe(data: any): string {
  if (data == null) return 'null/undefined';
  if (Array.isArray(data)) {
    const first = data[0];
    return `array len=${data.length}; first=${JSON.stringify(first).slice(0, 600)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    const parts: string[] = [`object keys=[${keys.join(',')}]`];
    for (const k of keys.slice(0, 12)) {
      const v = (data as any)[k];
      if (Array.isArray(v)) parts.push(`  ${k}: array len=${v.length} first=${JSON.stringify(v[0]).slice(0, 200)}`);
      else parts.push(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
    }
    return parts.join('\n');
  }
  return String(data);
}

async function main() {
  console.log('\n=== Coinglass funding-dispersion probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name}  ${p.path}  params=${JSON.stringify(p.params)}`);
      console.log('     ' + describe((r as any).data).split('\n').join('\n     '));
    } catch (e: any) {
      console.log(`ERR  ${p.name}  ${p.path}  params=${JSON.stringify(p.params)}`);
      console.log('     ' + String(e?.message ?? e).slice(0, 260));
    }
    console.log('');
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
