/**
 * etf-flow-probe — one-shot read-only probe of the ETF flow endpoints to learn
 * the exact response shape (column-array vs row-object), key names, ts units,
 * and history span before building the IS/OOS IC analysis.
 */
import { cgGet } from '../../core/coinglass';

const PATHS: { name: string; path: string; params: Record<string, string | number> }[] = [
  { name: 'btc-etf-flow', path: '/etf/bitcoin/flow-history', params: {} },
  { name: 'eth-etf-flow', path: '/etf/ethereum/flow-history', params: {} },
  { name: 'sol-etf-flow', path: '/etf/solana/flow-history', params: {} },
  // alternates per prompt text
  { name: 'eth-etf-flow-alt', path: '/ethereum-etf-flows-history', params: {} },
  { name: 'sol-etf-flow-alt', path: '/solana-etf-flows-history', params: {} },
];

async function main() {
  for (const p of PATHS) {
    try {
      const r = await cgGet<any>(p.path, p.params);
      const data = (r as any).data;
      const isArr = Array.isArray(data);
      console.log(`\n=== ${p.name} (${p.path}) code=${(r as any).code} ===`);
      if (isArr) {
        console.log(`rows=${data.length}`);
        if (data.length) {
          console.log(`first keys: ${JSON.stringify(Object.keys(data[0]))}`);
          console.log(`first row : ${JSON.stringify(data[0]).slice(0, 400)}`);
          console.log(`last row  : ${JSON.stringify(data[data.length - 1]).slice(0, 400)}`);
        }
      } else if (data && typeof data === 'object') {
        console.log(`top-level keys: ${JSON.stringify(Object.keys(data))}`);
        for (const k of Object.keys(data)) {
          const v = (data as any)[k];
          if (Array.isArray(v)) console.log(`  ${k}: array len=${v.length} sample=${JSON.stringify(v.slice(0, 2))}`);
          else console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
        }
      } else {
        console.log(`scalar/other: ${JSON.stringify(data).slice(0, 200)}`);
      }
    } catch (e: any) {
      console.log(`\n=== ${p.name} (${p.path}) ERROR ===\n  ${(e?.message ?? String(e)).slice(0, 300)}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
  process.exit(0);
}
main();
