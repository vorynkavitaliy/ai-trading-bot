// Cancel non-reduce-only limit entry orders for a symbol when position is closed
// (= 0). Targets orphan scaled-in slot orders left over after TP/SL closed the
// position. Reduce-only orders are LEFT alone (they self-cancel when position=0).
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { close as closePg } from '../../core/db';

async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  if (!symbol) { console.error('usage: cancel-orphan-entries.ts <SYMBOL>'); process.exit(1); }
  const dryRun = process.argv.includes('--dry-run');

  const accounts = loadAccounts();
  for (const a of accounts) {
    const c = getRest(a);
    // Check position first — if non-zero, BAIL (don't touch active trade)
    const pr: any = await withRetry(() => c.getPositionInfo({ category: 'linear', symbol }),
      { label: `getPosition-${a.keyName}` });
    const positions = (pr.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    if (positions.length > 0) {
      console.log(`  ${a.bucket}/${a.keyName}: HAS OPEN POSITION (size=${positions[0].size}) — SKIPPING`);
      continue;
    }
    // Get active orders
    const r: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }),
      { label: `getActiveOrders-${a.keyName}` });
    if (r.retCode !== 0) { console.log(`  ${a.keyName}: getActiveOrders ERR ${r.retMsg}`); continue; }
    const orders = r.result?.list ?? [];
    // Filter: non-reduce-only limit orders are the orphan entry slots
    const orphans = orders.filter((o: any) =>
      o.orderType === 'Limit' && o.reduceOnly === false && o.orderStatus === 'New'
    );
    if (orphans.length === 0) {
      console.log(`  ${a.bucket}/${a.keyName}: 0 orphan entries (clean)`);
      continue;
    }
    console.log(`  ${a.bucket}/${a.keyName}: ${orphans.length} orphan entries to cancel`);
    for (const o of orphans) {
      console.log(`     ${o.side} qty=${o.qty} @ ${o.price} linkId=${o.orderLinkId}${dryRun ? ' [DRY-RUN]' : ''}`);
      if (dryRun) continue;
      const cancel: any = await withRetry(() => c.cancelOrder({
        category: 'linear', symbol, orderId: o.orderId,
      }), { label: `cancelOrder-${a.keyName}-${o.orderLinkId}` });
      if (cancel.retCode === 0) console.log(`       ✓ cancelled`);
      else console.log(`       ✗ retCode=${cancel.retCode} ${cancel.retMsg}`);
    }
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
