/**
 * cg-unlock-probe — probe Coinglass v4 token-unlock / vesting endpoints.
 * Read-only. Tries several candidate paths, classifies outcome, prints shape.
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe { name: string; path: string; params: Record<string, string | number>; }

const probes: Probe[] = [
  { name: 'coin-unlock-list',        path: '/coin-unlock-list',                params: {} },
  { name: 'token-vesting',           path: '/token-vesting',                   params: {} },
  { name: 'futures-unlock',          path: '/futures/unlock',                  params: {} },
  { name: 'unlock-list',             path: '/unlock/list',                     params: {} },
  { name: 'index-unlock',            path: '/index/unlock',                    params: {} },
  { name: 'token-unlock',            path: '/token/unlock',                    params: {} },
  { name: 'coins-unlock',            path: '/coins/unlock',                    params: {} },
  { name: 'token-unlock-list',       path: '/token-unlock-list',               params: {} },
  { name: 'coin-unlock',             path: '/coin/unlock',                     params: {} },
  { name: 'vesting',                 path: '/vesting',                         params: {} },
  { name: 'unlock-coin-list-sym',    path: '/coin-unlock-list',                params: { symbol: 'ARB' } },
  { name: 'unlock-coin-detail-arb',  path: '/coin-unlock',                     params: { symbol: 'ARB' } },
  { name: 'unlock-detail-arb',       path: '/unlock',                          params: { symbol: 'ARB' } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms)),
  ]);
}

function describe(data: any): string {
  if (data == null) return 'null';
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : null;
    return `array len=${data.length} firstKeys=${JSON.stringify(keys)}\n     sample=${JSON.stringify(first).slice(0, 500)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // common nested
    for (const k of ['list', 'data', 'dataList', 'data_list']) {
      if (Array.isArray((data as any)[k])) {
        const arr = (data as any)[k];
        const first = arr[0];
        const fk = first && typeof first === 'object' ? Object.keys(first) : null;
        return `obj keys=${JSON.stringify(keys)} -> ${k}[] len=${arr.length} firstKeys=${JSON.stringify(fk)}\n     sample=${JSON.stringify(first).slice(0, 500)}`;
      }
    }
    return `obj keys=${JSON.stringify(keys)}\n     sample=${JSON.stringify(data).slice(0, 500)}`;
  }
  return `scalar ${String(data)}`;
}

async function main() {
  console.log('=== Coinglass token-unlock / vesting probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name}  [${p.path}]  params=${JSON.stringify(p.params)}`);
      console.log(`     code=${(r as any).code}  ${describe((r as any).data)}`);
    } catch (e: any) {
      console.log(`FAIL ${p.name}  [${p.path}]  params=${JSON.stringify(p.params)}`);
      console.log(`     ${(e?.message ?? String(e)).slice(0, 240)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  console.log('\n=== done ===');
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
