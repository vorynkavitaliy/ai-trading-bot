import { AccountManager } from './core/account-manager.js';
import { BybitClient } from './core/bybit-client.js';

async function main() {
  const symbol = process.argv[2] ?? 'LINKUSDT';
  const side = (process.argv[3] ?? 'Buy') as 'Buy' | 'Sell';

  const mgr = new AccountManager();
  const client = new BybitClient(mgr);
  const res = await client.closePositionAllTiers(symbol, side);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
