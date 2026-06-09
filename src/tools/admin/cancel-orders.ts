/**
 * cancel-orders — cancel ALL open orders on every account (category linear, settleCoin
 * USDT). Use to clear stale resting limits. Does NOT touch positions. Prints before/after.
 * Run: npx tsx src/tools/admin/cancel-orders.ts
 */
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';

async function main() {
  for (const acc of loadAccounts()) {
    const label = `${acc.bucket}/${acc.keyName}`;
    try {
      const c = getRest(acc);
      const before: any = await withRetry(() => c.getActiveOrders({ category: 'linear', settleCoin: 'USDT' }), { label: `ord-${acc.keyName}` });
      const blist = before?.result?.list ?? [];
      console.log(`${label}: ${blist.length} open order(s) — ${blist.map((o: any) => `${o.symbol} ${o.side} ${o.orderType}@${o.price}`).join(', ') || '(none)'}`);
      if (blist.length === 0) continue;
      const res: any = await withRetry(() => c.cancelAllOrders({ category: 'linear', settleCoin: 'USDT' }), { label: `cancel-${acc.keyName}` });
      console.log(`  → cancelAllOrders retCode=${res?.retCode} cancelled=${(res?.result?.list ?? []).length}`);
    } catch (e: any) {
      console.log(`${label}: ERROR ${e?.message ?? e}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
