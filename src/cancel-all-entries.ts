/**
 * One-shot cancel: removes all pending ENTRY orders (Limit/Market awaiting fill)
 * across all sub-accounts. Does NOT touch SL/TP attached to live positions
 * (orderFilter='Order' excludes StopOrder and tpslOrder).
 *
 * Also clears Redis pending-order registry so the orchestrator
 * `hasPendingEntryOrder` gate doesn't stay blocking on stale records.
 */
import { AccountManager } from './core/account-manager';
import { cache } from './cache';

const mgr = new AccountManager();

(async () => {
  console.log('\n═══ Cancel all entry orders (SL/TP preserved) ═══\n');

  for (const sub of mgr.getAllSubAccounts()) {
    try {
      const before = await sub.client.getActiveOrders({ category: 'linear', settleCoin: 'USDT', orderFilter: 'Order' });
      const beforeList = before.result?.list ?? [];
      if (beforeList.length === 0) {
        console.log(`[${sub.label}] no entry orders to cancel`);
        continue;
      }
      console.log(`[${sub.label}] found ${beforeList.length} entry order(s):`);
      for (const o of beforeList) {
        console.log(`  - ${o.symbol} ${o.side} ${o.qty} @ ${o.price} (${o.orderType}, id ${o.orderId})`);
      }

      const res = await sub.client.cancelAllOrders({ category: 'linear', settleCoin: 'USDT', orderFilter: 'Order' });
      if (res.retCode === 0) {
        const cancelled = res.result?.list?.length ?? 0;
        console.log(`  ✅ cancelled ${cancelled}`);
      } else {
        console.log(`  ❌ ${res.retMsg} (code ${res.retCode})`);
      }
    } catch (err: any) {
      console.error(`[${sub.label}] error: ${err.message}`);
    }
  }

  // Clear Redis pending-order registry — orchestrator will rebuild it naturally
  const pending = await cache.getAllPendingOrders();
  if (pending.length > 0) {
    console.log(`\nClearing ${pending.length} Redis pending record(s):`);
    for (const p of pending) {
      console.log(`  - ${p.symbol} ${p.direction} @ ${p.limitPrice}`);
      await cache.removePendingOrder(p.symbol);
    }
  } else {
    console.log('\nRedis pending registry already empty');
  }

  console.log('\n═══ Done — SL/TP on live positions untouched ═══\n');
  process.exit(0);
})().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
