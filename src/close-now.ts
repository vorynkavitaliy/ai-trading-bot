import { AccountManager } from './core/account-manager.js';
import { BybitClient } from './core/bybit-client.js';
import { cache } from './cache';

async function main() {
  const symbol = process.argv[2] ?? 'LINKUSDT';
  const side = (process.argv[3] ?? 'Buy') as 'Buy' | 'Sell';

  const mgr = new AccountManager();
  const client = new BybitClient(mgr);
  const res = await client.closePositionAllTiers(symbol, side);
  console.log(JSON.stringify(res, null, 2));

  // Record recent-close so scanner won't re-open the same direction for 2h.
  // side='Buy' closes a LONG position; side='Sell' closes a SHORT position.
  const direction = side === 'Buy' ? 'Long' : 'Short';
  await cache.setRecentClose(symbol, direction);
  console.log(`[close-now] recentClose:${symbol}:${direction} set (TTL 120 min)`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
