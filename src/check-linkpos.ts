import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';

async function main() {
  const mgr = new AccountManager();
  const client = new BybitClient(mgr);
  const all = await client.getAllPositions('LINKUSDT');
  const price = await client.getPrice('LINKUSDT');
  console.log(`[LINKUSDT] mark=${price.lastPrice}`);
  for (const { sub, positions } of all) {
    if (positions.length === 0) {
      console.log(`[${sub.label}] FLAT`);
    } else {
      for (const p of positions) {
        console.log(`[${sub.label}] ${p.side} size=${p.size} entry=${p.entryPrice} SL=${p.stopLoss} TP=${p.takeProfit} uPnL=${p.unrealisedPnl}`);
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
