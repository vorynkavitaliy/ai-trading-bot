// Probe orderbook ask-bids history — historical depth snapshots.
// If this gives time-series of bid/ask volume at various distances,
// we can backtest a "thin book" gate (avoid entries when liquidity is sparse).
import { cgGet } from '../../core/coinglass';

async function main() {
  const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', {
    exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5,
  });
  console.log(`got ${r.data?.length ?? 0} rows`);
  console.log('first row:', JSON.stringify(r.data?.[0], null, 2));
  if ((r.data?.length ?? 0) > 0) {
    console.log('keys:', Object.keys(r.data![0]).join(', '));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
