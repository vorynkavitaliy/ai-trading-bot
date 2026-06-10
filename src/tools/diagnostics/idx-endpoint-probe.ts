/**
 * idx-endpoint-probe — read-only probe of CG proprietary index endpoints
 * (Whale Index, CGDI, CDRI). Tries hinted path + obvious variants, classifies
 * 200 / tier-locked / 404, and on 200 prints shape + history depth + first/last
 * timestamp + sample row. Pure HTTP, no DB.
 *
 * Run: npx tsx src/tools/diagnostics/idx-endpoint-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe { name: string; path: string; params: Record<string, string | number>; }

// For each index family, try several plausible v4 paths. CG v4 index family lives
// under /api/index/...; whale-index sometimes under /futures or with symbol param.
const probes: Probe[] = [
  // Whale Index
  { name: 'whale-index (index)',        path: '/index/whale-index',            params: {} },
  { name: 'whale-index (index+sym)',    path: '/index/whale-index',            params: { symbol: 'BTC' } },
  { name: 'whale-index (index+range)',  path: '/index/whale-index',            params: { range: '1d' } },
  { name: 'whale-index (bull-bear)',    path: '/index/bull-market-peak-indicator', params: {} },
  { name: 'whale-index (futures)',      path: '/futures/whale-index',          params: { symbol: 'BTC' } },
  { name: 'whale-index-history',        path: '/index/whale-index-history',    params: {} },
  // CGDI — Coinglass Derivatives Index
  { name: 'cgdi (index)',               path: '/index/cgdi-index',             params: {} },
  { name: 'cgdi (index+sym)',           path: '/index/cgdi-index',             params: { symbol: 'BTC' } },
  { name: 'cgdi-history',               path: '/index/cgdi-index-history',     params: {} },
  { name: 'cgdi (alt)',                 path: '/index/cgdi',                   params: {} },
  // CDRI — Coinglass Derivatives Risk Index
  { name: 'cdri (index)',               path: '/index/cdri-index',             params: {} },
  { name: 'cdri (index+sym)',           path: '/index/cdri-index',             params: { symbol: 'BTC' } },
  { name: 'cdri-history',               path: '/index/cdri-index-history',     params: {} },
  { name: 'cdri (alt)',                 path: '/index/cdri',                   params: {} },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms)),
  ]);
}

function describe(data: any): string {
  if (data == null) return 'null';
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : typeof first;
    return `array len=${data.length} firstKeys=${JSON.stringify(keys)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // column-array shape
    const arrKeys = keys.filter(k => Array.isArray((data as any)[k]));
    if (arrKeys.length) {
      const lens = arrKeys.map(k => `${k}[${(data as any)[k].length}]`).join(',');
      return `object cols={${lens}} allKeys=${JSON.stringify(keys)}`;
    }
    return `object keys=${JSON.stringify(keys)}`;
  }
  return `scalar ${String(data).slice(0, 60)}`;
}

function depthInfo(data: any): string {
  // try to find a time array
  if (!data || typeof data !== 'object') return '';
  const d: any = data;
  const timeArr = d.time_list || d.time || d.ts || d.timestamp_list || d.dateList;
  if (Array.isArray(timeArr) && timeArr.length) {
    const toIso = (v: any) => {
      const n = typeof v === 'string' ? parseInt(v, 10) : v;
      const ms = n < 1e12 ? n * 1000 : n;
      return new Date(ms).toISOString().slice(0, 16);
    };
    return `  TIME ${timeArr.length} pts  ${toIso(timeArr[0])} .. ${toIso(timeArr[timeArr.length - 1])}`;
  }
  if (Array.isArray(d) && d.length && d[0] && typeof d[0] === 'object') {
    const k = Object.keys(d[0]).find(x => /time|ts|date/i.test(x));
    if (k) {
      const toIso = (v: any) => {
        const n = typeof v === 'string' ? parseInt(v, 10) : v;
        const ms = n < 1e12 ? n * 1000 : n;
        return new Date(ms).toISOString().slice(0, 16);
      };
      return `  TIME(${k}) ${d.length} pts  ${toIso(d[0][k])} .. ${toIso(d[d.length - 1][k])}`;
    }
  }
  return '';
}

async function main() {
  console.log('\n=== CG proprietary index endpoint probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      const data = (r as any).data;
      console.log(`OK   ${p.name}  ${p.path}  ${JSON.stringify(p.params)}`);
      console.log(`     code=${(r as any).code}  ${describe(data)}`);
      const di = depthInfo(Array.isArray(data) ? data : data);
      if (di) console.log(di);
      // sample one row/value
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const sample: any = {};
        for (const k of Object.keys(data)) {
          const v = (data as any)[k];
          sample[k] = Array.isArray(v) ? v.slice(-2) : v;
        }
        console.log(`     tail-sample=${JSON.stringify(sample).slice(0, 300)}`);
      } else if (Array.isArray(data) && data.length) {
        console.log(`     last=${JSON.stringify(data[data.length - 1]).slice(0, 300)}`);
      }
    } catch (e: any) {
      const msg = (e?.message ?? String(e));
      console.log(`FAIL ${p.name}  ${p.path}  ${JSON.stringify(p.params)}`);
      console.log(`     ${msg.slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  console.log('\ndone');
  process.exit(0);
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
