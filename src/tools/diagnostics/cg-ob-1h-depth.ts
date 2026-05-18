// Check 1h ask-bids-history coverage depth across pairs.
import { cgGet } from '../../core/coinglass';

const COINS = ['BTC', 'ETH', 'HYPE', 'INJ', 'TAO', 'ARB'];

async function main() {
  console.log('=== 1h ask-bids-history coverage ===\n');
  console.log('symbol   rows   span_days   first             last');
  for (const c of COINS) {
    try {
      const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', {
        exchange: 'Binance', symbol: `${c}USDT`, interval: '1h', range: 5, limit: 4500,
      });
      const d = r.data ?? [];
      if (d.length === 0) { console.log(`${c.padEnd(8)} no data`); continue; }
      const spanDays = ((d[d.length-1].time - d[0].time) / 86_400_000).toFixed(0);
      console.log(`${c.padEnd(8)} ${String(d.length).padStart(5)}  ${spanDays.padStart(7)}    ${new Date(d[0].time).toISOString().slice(0,10)}  ${new Date(d[d.length-1].time).toISOString().slice(0,10)}`);
      await new Promise(s => setTimeout(s, 250));
    } catch (e: any) {
      console.log(`${c.padEnd(8)} ERROR: ${e?.message?.slice(0,80)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
