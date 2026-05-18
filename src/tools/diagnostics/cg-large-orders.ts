// Probe Large Orderbook endpoint — fetch live whale limit orders for our universe
// and analyze: distribution of order sizes, distance from market price, side balance.
//
// Hypothesis to test (manual first):
//   Large limit orders within ~2% of price act as price magnets.
//   If our SL is on the far side of a big whale wall, the wall protects us.
//   If our SL is BEYOND the wall (price would have to cross it), risk is higher.
//
// This script gives operator a feel for the data before we build backtest logic.

import { cgGet } from '../../core/coinglass';

const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'LTC', 'ATOM', 'DOGE', 'TON', 'APT', 'ARB', 'INJ', 'TAO', 'HYPE'];
const REF_EX = 'Binance';
const NEAR_PCT = 5.0; // only walls within ±5% from market

async function main() {
  console.log(`=== Large Orderbook — walls within ±${NEAR_PCT}% of market ===\n`);
  console.log('symbol   side   priceΔ%    size$       price        age_h');
  console.log('---------------------------------------------------------');

  for (const coin of COINS) {
    try {
      const [r, tickerR] = await Promise.all([
        cgGet<any[]>('/futures/orderbook/large-limit-order', { exchange: REF_EX, symbol: `${coin}USDT` }),
        cgGet<any[]>('/futures/coins-markets', { symbol: coin }),
      ]);
      const orders = r.data ?? [];
      const price = (tickerR.data?.[0] as any)?.current_price ?? 0;

      const walls = orders
        .map((o: any) => ({
          side: o.order_side === 1 ? 'BUY' : 'SELL',
          orderPrice: Number(o.limit_price),
          sizeUsd: Number(o.current_usd_value),
          createTime: Number(o.start_time),
        }))
        .filter(o => price > 0 && Math.abs((o.orderPrice - price) / price) * 100 <= NEAR_PCT)
        .sort((a, b) => b.sizeUsd - a.sizeUsd)
        .slice(0, 5);

      if (walls.length === 0) {
        console.log(`${coin.padEnd(8)} (no walls within ±${NEAR_PCT}%)  price=$${price}`);
        continue;
      }

      for (const o of walls) {
        const deltaPct = ((o.orderPrice - price) / price) * 100;
        const ageH = ((Date.now() - o.createTime) / 3_600_000).toFixed(1);
        console.log(
          `${coin.padEnd(8)} ${o.side.padEnd(5)}  ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2).padStart(6)}%  $${(o.sizeUsd / 1000).toFixed(0).padStart(7)}k  ${o.orderPrice.toString().padStart(11)}  ${ageH.padStart(6)}h`
        );
      }
      console.log('');

      await new Promise(s => setTimeout(s, 250));
    } catch (e: any) {
      console.log(`${coin.padEnd(8)} ERROR: ${e?.message?.slice(0, 80)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
