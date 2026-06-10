/**
 * idx-endpoint-probe2 — verified v4 paths for CG proprietary indices.
 *   /futures/cgdi-index/history
 *   /futures/cdri-index/history
 *   /futures/whale-index/history  (needs exchange+symbol+interval)
 * Read-only. Prints shape, history depth, time span, sample.
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 20_000;
const PACE_MS = 500;

interface Probe { name: string; path: string; params: Record<string, string | number>; }

const probes: Probe[] = [
  { name: 'cgdi-history (bare)',         path: '/futures/cgdi-index/history', params: {} },
  { name: 'cgdi-history (1d)',           path: '/futures/cgdi-index/history', params: { interval: '1d', limit: 1000 } },
  { name: 'cdri-history (bare)',         path: '/futures/cdri-index/history', params: {} },
  { name: 'cdri-history (1d)',           path: '/futures/cdri-index/history', params: { interval: '1d', limit: 1000 } },
  { name: 'whale-index (BTC 1d)',        path: '/futures/whale-index/history', params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '1d', limit: 1000 } },
  { name: 'whale-index (BTC 4h)',        path: '/futures/whale-index/history', params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 1000 } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms)),
  ]);
}

function toIso(v: any): string {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString().slice(0, 16);
}

function analyze(data: any) {
  if (Array.isArray(data)) {
    console.log(`     array len=${data.length}`);
    if (data.length) {
      const first = data[0], last = data[data.length - 1];
      const keys = first && typeof first === 'object' ? Object.keys(first) : typeof first;
      console.log(`     rowKeys=${JSON.stringify(keys)}`);
      console.log(`     first=${JSON.stringify(first).slice(0, 260)}`);
      console.log(`     last =${JSON.stringify(last).slice(0, 260)}`);
      // time span if a time key exists
      if (first && typeof first === 'object') {
        const tk = Object.keys(first).find(k => /time|ts|date/i.test(k));
        if (tk) console.log(`     span(${tk}): ${toIso(first[tk])} .. ${toIso(last[tk])}`);
      }
    }
    return;
  }
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    const arrKeys = keys.filter(k => Array.isArray((data as any)[k]));
    console.log(`     object keys=${JSON.stringify(keys)}`);
    if (arrKeys.length) {
      for (const k of arrKeys) console.log(`       ${k}: array len=${(data as any)[k].length}  tail=${JSON.stringify((data as any)[k].slice(-2))}`);
      const tk = arrKeys.find(k => /time|ts|date/i.test(k));
      if (tk) {
        const ta = (data as any)[tk];
        console.log(`     span(${tk}): ${toIso(ta[0])} .. ${toIso(ta[ta.length - 1])}`);
      }
    } else {
      console.log(`     scalarObj=${JSON.stringify(data).slice(0, 260)}`);
    }
    return;
  }
  console.log(`     scalar=${String(data).slice(0, 120)}`);
}

async function main() {
  console.log('\n=== CG index endpoints (verified v4 paths) ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name}  ${p.path}  ${JSON.stringify(p.params)}  code=${(r as any).code}`);
      analyze((r as any).data);
    } catch (e: any) {
      console.log(`FAIL ${p.name}  ${p.path}  ${JSON.stringify(p.params)}`);
      console.log(`     ${(e?.message ?? String(e)).slice(0, 220)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  console.log('\ndone');
  process.exit(0);
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
