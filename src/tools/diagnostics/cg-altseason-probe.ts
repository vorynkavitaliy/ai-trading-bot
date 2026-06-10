/**
 * cg-altseason-probe — read-only probe of the Altcoin Season Index + BTC
 * correlations (SPY/GLD/QQQ/TLT) + BTC-vs-M2 endpoint families.
 *
 * Tries the doc-hint paths AND the obvious v4 variants, classifies each, and on
 * success prints row count + first-row keys + first/last timestamp so we can
 * judge history depth and granularity before deciding to run IC stats.
 *
 * Run: npx tsx src/tools/diagnostics/cg-altseason-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe {
  name: string;
  path: string;
  params: Record<string, string | number>;
}

// Try a generous set of path variants for each family.
const probes: Probe[] = [
  // Altcoin Season Index
  { name: 'altseason-1', path: '/index/altcoin-season-index', params: {} },
  { name: 'altseason-2', path: '/index/altcoin-season', params: {} },
  { name: 'altseason-3', path: '/index/altcoin-season-history', params: {} },
  { name: 'altseason-4', path: '/index/alt-season-index', params: {} },
  { name: 'altseason-5', path: '/index/altcoin-season-index-history', params: {} },

  // BTC correlations vs traditional assets
  { name: 'btc-corr-1', path: '/index/btc-correlations', params: {} },
  { name: 'btc-corr-2', path: '/index/bitcoin-correlations', params: {} },
  { name: 'btc-corr-3', path: '/index/btc-correlation', params: {} },
  { name: 'btc-corr-4', path: '/index/bitcoin-vs-global-assets', params: {} },
  { name: 'btc-corr-5', path: '/index/bitcoin-correlation-history', params: {} },

  // BTC vs US M2 supply growth
  { name: 'm2-1', path: '/index/bitcoin-vs-us-m2-supply-growth', params: {} },
  { name: 'm2-2', path: '/index/bitcoin-vs-m2-supply', params: {} },
  { name: 'm2-3', path: '/index/bitcoin-vs-global-m2-growth', params: {} },
  { name: 'm2-4', path: '/index/bitcoin-vs-m2', params: {} },
  { name: 'm2-5', path: '/index/bitcoin-macro-oscillator', params: {} },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms),
    ),
  ]);
}

function describe(data: any): string {
  if (data == null) return 'null data';
  if (Array.isArray(data)) {
    const n = data.length;
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : [];
    let span = '';
    if (n > 1 && first && typeof first === 'object') {
      // find a time-ish key
      const tKey = keys.find(k => /time|ts|date/i.test(k));
      if (tKey) {
        const a = data[0][tKey];
        const b = data[n - 1][tKey];
        span = `  span[${tKey}]: ${a} .. ${b}`;
      }
    }
    return `ARRAY n=${n} keys=${JSON.stringify(keys)}${span}\n    sampleRow0=${JSON.stringify(first).slice(0, 300)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    // column-array shape?
    const arrKeys = keys.filter(k => Array.isArray((data as any)[k]));
    let detail = `OBJECT keys=${JSON.stringify(keys).slice(0, 300)}`;
    if (arrKeys.length) {
      const lens = arrKeys.map(k => `${k}[${(data as any)[k].length}]`).join(',');
      detail += `\n    arrayCols: ${lens}`;
      // sample first/last of a time col
      const tKey = arrKeys.find(k => /time|ts|date/i.test(k));
      if (tKey) {
        const arr = (data as any)[tKey];
        detail += `\n    ${tKey}: ${arr[0]} .. ${arr[arr.length - 1]}`;
      }
      // sample first row across cols
      const sample: any = {};
      for (const k of arrKeys.slice(0, 8)) sample[k] = (data as any)[k][0];
      detail += `\n    row0=${JSON.stringify(sample).slice(0, 300)}`;
    }
    return detail;
  }
  return `scalar ${String(data).slice(0, 80)}`;
}

async function main() {
  console.log('\n=== Coinglass altseason/correlation/M2 probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name.padEnd(12)} ${p.path}`);
      console.log(`     code=${(r as any).code}  ${describe((r as any).data)}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.log(`FAIL ${p.name.padEnd(12)} ${p.path}`);
      console.log(`     ${msg.slice(0, 220)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  console.log('\ndone\n');
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
