// Check ask-bids-history coverage depth across our universe.
import { cgGet } from '../../core/coinglass';

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'LTC', 'ATOM', 'DOGE', 'TON', 'APT', 'ARB', 'INJ', 'TAO', 'HYPE'];

async function main() {
  console.log('=== ask-bids-history coverage per pair (Binance, 4h interval) ===');
  console.log('symbol   rows   span_days   first_ts                last_ts');
  console.log('-------------------------------------------------------------');

  for (const coin of COINS) {
    try {
      const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', {
        exchange: 'Binance', symbol: `${coin}USDT`, interval: '4h', limit: 4500,
      });
      const data = r.data ?? [];
      if (data.length === 0) {
        console.log(`${coin.padEnd(8)} no data`);
        continue;
      }
      const first = data[0].time;
      const last = data[data.length - 1].time;
      const spanDays = ((last - first) / 86_400_000).toFixed(0);
      console.log(
        `${coin.padEnd(8)} ${String(data.length).padStart(5)}   ${spanDays.padStart(7)}   ${new Date(first).toISOString().slice(0,10)}   ${new Date(last).toISOString().slice(0,10)}`
      );
      await new Promise(s => setTimeout(s, 250));
    } catch (e: any) {
      console.log(`${coin.padEnd(8)} ERROR: ${e?.message?.slice(0, 80)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
