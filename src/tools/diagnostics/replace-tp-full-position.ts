// One-time fix: re-place TP to cover full position qty (after DCA fills).
// Use when scaled-in DCA fills happened but TP still covers only initial slot qty.
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry, getInstrumentInfo, roundPriceToTick, roundQtyToStep } from '../../core/bybit';
import { close as closePg } from '../../core/db';
import { tradeRepo } from '../../data/trade-repo';
import { randomUUID } from 'node:crypto';

async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  const dryRun = !process.argv.includes('--execute');
  if (!symbol) { console.error('usage: replace-tp-full-position.ts <SYMBOL> [--execute]'); process.exit(1); }

  const accounts = loadAccounts();
  const dbTrades = await tradeRepo.openTrades();

  console.log(`Replacing TP for ${symbol}${dryRun ? ' [DRY-RUN]' : ' [EXECUTE]'}\n`);

  for (const a of accounts) {
    const c = getRest(a);
    const pr: any = await withRetry(() => c.getPositionInfo({ category: 'linear', symbol }), { label: `pos-${a.keyName}` });
    const positions = (pr.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    if (positions.length === 0) { console.log(`${a.bucket}/${a.keyName}: no position`); continue; }
    const pos = positions[0];
    const posSize = parseFloat(pos.size);
    const posSide = pos.side;
    const closingSide = posSide === 'Sell' ? 'Buy' : 'Sell';

    // Find DB trade for tp1 price
    const dbTrade = dbTrades.find(t =>
      t.account_bucket === a.bucket && t.account_key === a.keyName &&
      t.symbol === symbol && t.side === posSide
    );
    const tpPrice = dbTrade?.tp1;
    if (!dbTrade || tpPrice == null) { console.log(`${a.bucket}/${a.keyName}: no DB trade or no tp1`); continue; }

    // Get current reduce-only TP orders
    const ordersR: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }), { label: `orders-${a.keyName}` });
    const tps = (ordersR.result?.list ?? []).filter((o: any) =>
      o.reduceOnly === true && o.side === closingSide && o.orderType === 'Limit'
    );
    const tpQtyTotal = tps.reduce((s: number, t: any) => s + parseFloat(t.qty), 0);

    console.log(`${a.bucket}/${a.keyName}: position=${posSize} ${posSide}, current TP covers ${tpQtyTotal} (${(tpQtyTotal/posSize*100).toFixed(1)}%)`);
    if (tpQtyTotal >= posSize * 0.99) { console.log(`   TP coverage OK, skipping`); continue; }

    console.log(`   → cancel ${tps.length} old TPs, place new TP @ ${tpPrice} for full ${posSize}`);
    if (dryRun) continue;

    // Cancel old TPs
    for (const tp of tps) {
      const r: any = await withRetry(() => c.cancelOrder({ category: 'linear', symbol, orderId: tp.orderId }), { label: `cancel-${tp.orderLinkId}` });
      console.log(`   ✓ cancelled ${tp.orderLinkId}` + (r.retCode !== 0 ? ` ERR ${r.retMsg}` : ''));
    }

    // Place new TP for full qty
    const info = await getInstrumentInfo(a, symbol);
    const qtyStr = roundQtyToStep(posSize, info);
    const linkId = `rtp-manual-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const r: any = await withRetry(() => c.submitOrder({
      category: 'linear', symbol,
      side: closingSide, orderType: 'Limit', qty: qtyStr,
      price: roundPriceToTick(tpPrice, info),
      timeInForce: 'GTC', reduceOnly: true,
      orderLinkId: linkId,
    }), { label: `place-${a.keyName}` });
    if (r.retCode === 0) console.log(`   ✓ new TP placed qty=${qtyStr} linkId=${linkId}`);
    else console.log(`   ✗ ${r.retMsg}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
