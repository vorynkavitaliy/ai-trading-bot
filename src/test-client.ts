import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';

async function main() {
  console.log('=== Bybit Client Test ===\n');

  // 1. Load accounts
  const manager = new AccountManager();
  console.log(`Tiers: ${manager.getTiers().length}`);
  console.log(`Total sub-accounts: ${manager.totalAccounts}`);

  for (const tier of manager.getTiers()) {
    console.log(`  ${tier.label}: volume=${tier.volume}, subs=${tier.subAccounts.length}, testnet=${tier.testnet}, demo=${tier.demoTrading}`);
  }

  // 2. Create client
  const client = new BybitClient(manager);

  // 3. Test public endpoints
  console.log('\n--- Public Data ---');

  const price = await client.getPrice('BTCUSDT');
  console.log(`BTC Price: $${price.lastPrice} | Funding: ${price.fundingRate} | OI: ${price.openInterest}`);

  const klines = await client.getKlines('BTCUSDT', '240', 3);
  console.log(`Last 3 4H candles:`);
  for (const k of klines) {
    console.log(`  ${new Date(k.timestamp).toISOString()} O:${k.open} H:${k.high} L:${k.low} C:${k.close} V:${k.volume}`);
  }

  const book = await client.getOrderbook('BTCUSDT', 3);
  console.log(`Orderbook top: bid=${book.bids[0]?.price} ask=${book.asks[0]?.price}`);

  // 4. Test private endpoints (wallet, positions)
  console.log('\n--- Private Data (per account) ---');

  const wallets = await client.getAllWallets();
  for (const { sub, wallet } of wallets) {
    console.log(`[${sub.label}] Equity: $${wallet.equity} | Available: $${wallet.availableBalance} | uPnL: $${wallet.unrealisedPnl}`);
  }

  const allPos = await client.getAllPositions();
  for (const { sub, positions } of allPos) {
    if (positions.length === 0) {
      console.log(`[${sub.label}] No open positions`);
    } else {
      for (const p of positions) {
        console.log(`[${sub.label}] ${p.symbol} ${p.side} size=${p.size} entry=${p.entryPrice} uPnL=${p.unrealisedPnl} SL=${p.stopLoss} TP=${p.takeProfit}`);
      }
    }
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
