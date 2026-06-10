/**
 * cg-catalog-probe3 — final-pass: the `/index/bitcoin-*` cycle-index family confirmed
 * working via sth-sopr & rhodl-ratio in probe2. Sweep the remaining on-chain indices
 * under that prefix to resolve their real paths. Read-only.
 * Run: npx tsx src/tools/diagnostics/cg-catalog-probe3.ts
 */
import { cgGet } from '../../core/coinglass';

const T = 12_000, PACE = 320;
interface P { name: string; path: string; }

const probes: P[] = [
  { name: 'lth-sopr',        path: '/index/bitcoin-lth-sopr' },
  { name: 'nupl',            path: '/index/bitcoin-net-unrealized-profit-loss' },
  { name: 'realized-price',  path: '/index/bitcoin-realized-price-history' },
  { name: 'sth-realized',    path: '/index/bitcoin-sth-realized-price' },
  { name: 'lth-realized',    path: '/index/bitcoin-lth-realized-price' },
  { name: 'reserve-risk',    path: '/index/bitcoin-reserve-risk' },
  { name: 'active-addr',     path: '/index/bitcoin-active-addresses' },
  { name: 'new-addr',        path: '/index/bitcoin-new-addresses' },
  { name: 'profitable-days', path: '/index/bitcoin-profitable-days-history' },
  { name: 'rainbow',         path: '/index/bitcoin-rainbow-chart-history' },
  { name: 'bubble',          path: '/index/bitcoin-bubble-index-history' },
  { name: '2yr-ma',          path: '/index/bitcoin-2-year-ma-multiplier' },
  { name: '200w-ma',         path: '/index/bitcoin-200-week-ma-heatmap' },
  { name: 'correlations',    path: '/index/bitcoin-correlation' },
  { name: 'fut-spot-vol',    path: '/index/bitcoin-futures-spot-volume-ratio' },
  { name: 'realized-cap',    path: '/index/bitcoin-realized-cap' },
  { name: 'circulating',     path: '/index/bitcoin-short-term-holder-supply' },
];

function withTimeout<T2>(p: Promise<T2>, ms: number, l: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${l})`)), ms))]);
}

function shape(data: any): string {
  if (Array.isArray(data)) {
    const f = data[0];
    const k = f && typeof f === 'object' && !Array.isArray(f) ? Object.keys(f).join(',') : typeof f;
    return `array n=${data.length} keys=[${k}]`.slice(0, 200);
  }
  if (data && typeof data === 'object') return `obj keys=[${Object.keys(data).join(',')}]`.slice(0, 200);
  return String(data).slice(0, 100);
}

async function main() {
  console.log('=== cg-catalog-probe3 (bitcoin-* index family) ===\n');
  for (const p of probes) {
    try {
      const r: any = await withTimeout(cgGet<any>(p.path, {}), T, p.name);
      console.log(`OK   ${p.name.padEnd(16)} ${p.path}`);
      console.log(`     ${shape(r.data)}`);
    } catch (e: any) {
      const m = e?.message ?? String(e);
      const code = m.match(/code=([^\s]+)/)?.[1] ?? '?';
      console.log(`${code === '404' ? 'PATH' : code === '401' ? 'LOCK' : 'ERR '} ${p.name.padEnd(16)} ${p.path}  code=${code}`);
    }
    await new Promise(r => setTimeout(r, PACE));
  }
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
