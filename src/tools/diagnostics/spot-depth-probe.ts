/**
 * spot-depth-probe — confirm the deep history depth of the working spot endpoints
 * and the futures aggregated-cvd analog (for spot-vs-perp divergence), across a few
 * coins. Read-only. Run: npx tsx src/tools/diagnostics/spot-depth-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PACE_MS = 350;
const COINS = ['BTC', 'ETH', 'SOL'];

interface P { name: string; path: string; params: Record<string, string | number>; }

function build(): P[] {
  const out: P[] = [];
  for (const c of COINS) {
    out.push({ name: `spot-cvd ${c}`, path: '/spot/aggregated-cvd/history', params: { exchange_list: 'Binance', symbol: c, interval: '4h', limit: 3000 } });
    out.push({ name: `spot-taker ${c}`, path: '/spot/aggregated-taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: c, interval: '4h', limit: 3000 } });
    out.push({ name: `fut-cvd ${c}`, path: '/futures/aggregated-cvd/history', params: { exchange_list: 'Binance', symbol: c, interval: '4h', limit: 3000 } });
  }
  return out;
}

async function main() {
  console.log('=== spot-depth-probe ===\n');
  for (const p of build()) {
    try {
      const r = await cgGet<any>(p.path, p.params);
      const arr = (r as any).data;
      if (Array.isArray(arr) && arr.length) {
        const f = arr[0], l = arr[arr.length - 1];
        const days = (l.time - f.time) / 86400000;
        console.log(`OK  ${p.name}  rows=${arr.length}  span=${days.toFixed(0)}d  first=${new Date(f.time).toISOString().slice(0,10)} last=${new Date(l.time).toISOString().slice(0,10)}`);
        console.log(`    keys=${JSON.stringify(Object.keys(f))}`);
      } else {
        console.log(`OK  ${p.name}  rows=0 (empty)`);
      }
    } catch (e: any) {
      console.log(`ERR ${p.name}  ${(e?.message ?? String(e)).slice(0, 160)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}
main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
