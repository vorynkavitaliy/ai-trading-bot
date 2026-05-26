// Emergency full exit: cancel ALL orders on symbol + market-close any open position.
// Use case: scaled-in trade with unfilled DCA slots — operator wants out cleanly.
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry, getInstrumentInfo } from '../../core/bybit';
import { normalizeQty } from '../../core/qty-normalizer';
import { close as closePg } from '../../core/db';

async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  if (!symbol) { console.error('usage: full-exit-symbol.ts <SYMBOL> [--execute]'); process.exit(1); }
  const execute = process.argv.includes('--execute');
  const accounts = loadAccounts();

  console.log(`Full exit ${symbol}${execute ? ' [LIVE EXECUTE]' : ' [DRY-RUN — pass --execute to actually do it]'}\n`);

  for (const a of accounts) {
    const c = getRest(a);
    console.log(`\n${a.bucket}/${a.keyName}:`);

    // Step 1: cancel all orders on symbol
    const ao: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }),
      { label: `getActiveOrders-${a.keyName}` });
    const orders = ao.result?.list ?? [];
    if (orders.length > 0) {
      console.log(`  ${orders.length} active orders to cancel:`);
      for (const o of orders) {
        console.log(`     ${o.orderType} ${o.side} qty=${o.qty} @ ${o.price} reduceOnly=${o.reduceOnly} linkId=${o.orderLinkId}`);
      }
      if (execute) {
        const ca: any = await withRetry(() => c.cancelAllOrders({ category: 'linear', symbol }),
          { label: `cancelAll-${a.keyName}` });
        if (ca.retCode === 0) console.log(`  ✓ cancelAllOrders ok (${ca.result?.list?.length ?? 0} cancelled)`);
        else console.log(`  ✗ cancelAllOrders retCode=${ca.retCode} ${ca.retMsg}`);
      }
    } else {
      console.log('  no active orders');
    }

    // Step 2: close any open position
    const pr: any = await withRetry(() => c.getPositionInfo({ category: 'linear', symbol }),
      { label: `getPos-${a.keyName}` });
    const positions = (pr.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    if (positions.length === 0) {
      console.log('  no open position');
      continue;
    }
    for (const p of positions) {
      const closeSide = p.side === 'Buy' ? 'Sell' : 'Buy';
      console.log(`  position: ${p.side} size=${p.size} avg=${p.avgPrice} unrealized=${p.unrealisedPnl}`);
      console.log(`  → market ${closeSide} qty=${p.size} (reduce-only)`);
      if (execute) {
        const info = await getInstrumentInfo(a, symbol);
        const { qtyStr, valid } = normalizeQty(parseFloat(p.size), info);
        if (!valid) { console.log(`  ✗ qty ${p.size} not normalizable`); continue; }
        const co: any = await withRetry(() => c.submitOrder({
          category: 'linear',
          symbol,
          side: closeSide,
          orderType: 'Market',
          qty: qtyStr,
          reduceOnly: true,
          timeInForce: 'IOC',
        }), { label: `closeMkt-${a.keyName}` });
        if (co.retCode === 0) console.log(`  ✓ market close submitted orderId=${co.result?.orderId}`);
        else console.log(`  ✗ retCode=${co.retCode} ${co.retMsg}`);
      }
    }
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
