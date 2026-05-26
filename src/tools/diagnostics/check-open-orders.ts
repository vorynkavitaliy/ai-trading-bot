// Quick scan of OPEN orders on Bybit per symbol — detects orphan limit entries
// left over from incomplete scaled-in fills.
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { close as closePg } from '../../core/db';

async function main() {
  const symbol = (process.argv[2] ?? 'XRPUSDT').toUpperCase();
  const accounts = loadAccounts();
  console.log(`Open orders on ${symbol}:\n`);
  for (const a of accounts) {
    const c = getRest(a);
    const r: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }), {
      label: `getActiveOrders-${a.keyName}`,
    });
    if (r.retCode !== 0) { console.log(`  ${a.keyName}: ERR ${r.retCode} ${r.retMsg}`); continue; }
    const orders = r.result?.list ?? [];
    if (orders.length === 0) { console.log(`  ${a.bucket}/${a.keyName}: 0 orders`); continue; }
    console.log(`  ${a.bucket}/${a.keyName}: ${orders.length} orders`);
    for (const o of orders) {
      console.log(`     ${o.orderType} ${o.side} qty=${o.qty} @ ${o.price} status=${o.orderStatus} linkId=${o.orderLinkId} reduceOnly=${o.reduceOnly}`);
    }
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
