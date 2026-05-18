// Diagnostic: dump current Bybit positions + open orders for a symbol across all accounts.
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { log } from '../../core/logger';

async function main() {
  const symbol = process.argv[2];
  if (!symbol) {
    console.error('usage: npx tsx src/tools/diagnostics/position-snapshot.ts <SYMBOL>');
    process.exit(1);
  }
  const accounts = loadAccounts();
  for (const acc of accounts) {
    const c = getRest(acc);
    const label = `${acc.bucket}/${acc.keyName}`;
    const posR = await withRetry(() => c.getPositionInfo({ category: 'linear', symbol }), { label: `pos-${label}` });
    const positions = (posR.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    const ordR = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol, openOnly: 0, limit: 50 } as any), { label: `ord-${label}` });
    const orders = (ordR.result?.list ?? []).filter((o: any) => ['New', 'PartiallyFilled', 'Untriggered'].includes(o.orderStatus));
    console.log(`\n=== ${label} ${symbol} ===`);
    if (positions.length === 0) {
      console.log('  (no open position)');
    } else {
      for (const p of positions) {
        console.log(`  POS  ${p.side} size=${p.size} avgPrice=${p.avgPrice}  unrealised=${p.unrealisedPnl}  liq=${p.liqPrice}`);
        console.log(`       SL=${p.stopLoss || '—'}  TP=${p.takeProfit || '—'}  trailing=${p.trailingStop || '—'}`);
      }
    }
    if (orders.length === 0) {
      console.log('  (no active orders)');
    } else {
      for (const o of orders) {
        console.log(`  ORD  ${o.orderStatus} ${o.side} ${o.orderType} qty=${o.qty} price=${o.price || '—'} trig=${o.triggerPrice || '—'} reduceOnly=${o.reduceOnly} stopOrderType=${o.stopOrderType || '—'}`);
      }
    }
  }
}

main().catch((e) => {
  log.error('position-snapshot failed', { err: e?.message ?? String(e) });
  process.exit(1);
});
