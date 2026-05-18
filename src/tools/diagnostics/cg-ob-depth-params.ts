// Probe ask-bids-history with different range/depth params to understand
// what depth slice we're getting.
import { cgGet } from '../../core/coinglass';

async function tryCall(params: Record<string, any>) {
  try {
    const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', params);
    const d = r.data ?? [];
    console.log(`  params=${JSON.stringify(params)}`);
    console.log(`     rows=${d.length}  first=${JSON.stringify(d[0])}`);
  } catch (e: any) {
    console.log(`  params=${JSON.stringify(params)}  ERROR=${e?.message?.slice(0,80)}`);
  }
}

async function main() {
  const base = { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 1 };
  console.log('=== ask-bids-history param probe ===\n');

  await tryCall(base);
  await tryCall({ ...base, range: 0.5 });   // ±0.5%
  await tryCall({ ...base, range: 1 });     // ±1%
  await tryCall({ ...base, range: 5 });     // ±5%
  await tryCall({ ...base, depth: 1 });
  await tryCall({ ...base, depth: 5 });
  await tryCall({ ...base, level: 1 });
  await tryCall({ ...base, level: 5 });
}

main().catch(e => { console.error(e); process.exit(1); });
