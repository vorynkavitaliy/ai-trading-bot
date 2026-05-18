// Check granularity options for ask-bids-history.
import { cgGet } from '../../core/coinglass';

async function tryCall(interval: string) {
  try {
    const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', {
      exchange: 'Binance', symbol: 'BTCUSDT', interval, range: 5, limit: 3,
    });
    const d = r.data ?? [];
    console.log(`  interval=${interval.padEnd(4)}  rows=${d.length}  spans=${d.length > 1 ? new Date(d[0].time).toISOString() + ' → ' + new Date(d[d.length-1].time).toISOString() : 'n/a'}`);
  } catch (e: any) {
    console.log(`  interval=${interval}  ERROR=${e?.message?.slice(0,80)}`);
  }
}

async function main() {
  for (const iv of ['1m', '5m', '15m', '30m', '1h', '4h']) {
    await tryCall(iv);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
