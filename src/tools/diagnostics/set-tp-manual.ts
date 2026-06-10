// Manually set a TP at a given price across ALL accounts.
//   - OPEN position  → place reduce-only closing-side LIMIT (full qty) @ TP (cancels old reduce-only TPs first).
//   - RESTING entry  → amendOrder to attach takeProfit (+ optional --sl) so it activates on fill.
// Dry-run by default; --execute to fire. Models replace-tp-full-position.ts placement.
// Usage: npx tsx src/tools/diagnostics/set-tp-manual.ts <SYMBOL> <TP_PRICE> [--sl <SL_PRICE>] [--execute]
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry, getInstrumentInfo, roundPriceToTick, roundQtyToStep } from '../../core/bybit';
import { close as closePg } from '../../core/db';
import { randomUUID } from 'node:crypto';

async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  const tpPrice = parseFloat(process.argv[3] ?? '');
  const slIdx = process.argv.indexOf('--sl');
  const slPrice = slIdx >= 0 ? parseFloat(process.argv[slIdx + 1]) : null;
  const dryRun = !process.argv.includes('--execute');
  if (!symbol || !Number.isFinite(tpPrice)) {
    console.error('usage: set-tp-manual.ts <SYMBOL> <TP_PRICE> [--sl <SL>] [--execute]'); process.exit(1);
  }
  const accounts = loadAccounts();
  console.log(`\nSet TP ${tpPrice}${slPrice ? ` (SL ${slPrice})` : ''} for ${symbol}${dryRun ? '  [DRY-RUN]' : '  [EXECUTE]'}\n`);

  for (const a of accounts) {
    const c = getRest(a);
    const info = await getInstrumentInfo(a, symbol);
    const tpStr = roundPriceToTick(tpPrice, info);
    const pr: any = await withRetry(() => c.getPositionInfo({ category: 'linear', symbol }), { label: `pos-${a.keyName}` });
    const positions = (pr.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);

    if (positions.length > 0) {
      const pos = positions[0];
      const posSize = parseFloat(pos.size);
      const closingSide = pos.side === 'Sell' ? 'Buy' : 'Sell';
      const qtyStr = roundQtyToStep(posSize, info);
      const ordersR: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }), { label: `ord-${a.keyName}` });
      const oldTps = (ordersR.result?.list ?? []).filter((o: any) => o.reduceOnly === true && o.side === closingSide && o.orderType === 'Limit');
      console.log(`${a.bucket}/${a.keyName}: OPEN ${posSize} ${pos.side} → reduce-only ${closingSide} LIMIT @ ${tpStr} qty ${qtyStr} (cancel ${oldTps.length} old TP)`);
      if (dryRun) continue;
      for (const tp of oldTps) await withRetry(() => c.cancelOrder({ category: 'linear', symbol, orderId: tp.orderId }), { label: `cxl-${a.keyName}` });
      const r: any = await withRetry(() => c.submitOrder({
        category: 'linear', symbol, side: closingSide, orderType: 'Limit', qty: qtyStr,
        price: tpStr, timeInForce: 'GTC', reduceOnly: true, orderLinkId: `mtp-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      }), { label: `tp-${a.keyName}` });
      console.log(r.retCode === 0 ? `   ✓ TP placed` : `   ✗ ${r.retCode} ${r.retMsg}`);
    } else {
      const ordersR: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }), { label: `ord-${a.keyName}` });
      const entries = (ordersR.result?.list ?? []).filter((o: any) => o.reduceOnly !== true && o.orderType === 'Limit');
      if (entries.length === 0) { console.log(`${a.bucket}/${a.keyName}: no position, no resting entry — skip`); continue; }
      const o = entries[0];
      const slStr = slPrice ? roundPriceToTick(slPrice, info) : undefined;
      console.log(`${a.bucket}/${a.keyName}: RESTING ${o.side} ${o.qty}@${o.price} → amend TP ${tpStr}${slStr ? ` SL ${slStr}` : ''}`);
      if (dryRun) continue;
      const amendArgs: any = { category: 'linear', symbol, orderId: o.orderId, takeProfit: tpStr };
      if (slStr) amendArgs.stopLoss = slStr;
      const r: any = await withRetry(() => c.amendOrder(amendArgs), { label: `amend-${a.keyName}` });
      console.log(r.retCode === 0 ? `   ✓ amended TP/SL onto resting order` : `   ✗ ${r.retCode} ${r.retMsg}`);
    }
  }
  await closePg();
}
main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
