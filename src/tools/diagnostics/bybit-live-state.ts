/**
 * bybit-live-state — DIRECT Bybit truth (not DB): per account, the real positions,
 * open orders, and wallet balance. Uses the exact daemon REST call
 * (getPositionInfo category:linear settleCoin:USDT). Disambiguates "DB says open" vs
 * "Bybit actually has it".
 * Run: npx tsx src/tools/diagnostics/bybit-live-state.ts
 */
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';

async function main() {
  const accounts = loadAccounts();
  for (const acc of accounts) {
    const label = `${acc.bucket}/${acc.keyName}`;
    console.log(`\n=== ${label}  (testnet=${acc.testnet} demo=${acc.demoTrading}) ===`);
    try {
      const c = getRest(acc);
      const pos: any = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), { label: `pos-${acc.keyName}` });
      const plist = (pos?.result?.list ?? []).filter((p: any) => parseFloat(p.size ?? '0') > 0);
      console.log(`  positions retCode=${pos?.retCode} → ${plist.length} open:`);
      for (const p of plist) console.log(`    ${p.symbol} ${p.side} size=${p.size} entry=${p.avgPrice} SL=${p.stopLoss} TP=${p.takeProfit} uPnL=${p.unrealisedPnl}`);

      const ord: any = await withRetry(() => c.getActiveOrders({ category: 'linear', settleCoin: 'USDT' }), { label: `ord-${acc.keyName}` });
      const olist = ord?.result?.list ?? [];
      console.log(`  open orders retCode=${ord?.retCode} → ${olist.length}:`);
      for (const o of olist) console.log(`    ${o.symbol} ${o.side} ${o.orderType} qty=${o.qty} price=${o.price} status=${o.orderStatus} reduceOnly=${o.reduceOnly}`);

      const wal: any = await withRetry(() => c.getWalletBalance({ accountType: 'UNIFIED' }), { label: `wal-${acc.keyName}` });
      const w = wal?.result?.list?.[0];
      console.log(`  wallet retCode=${wal?.retCode} totalEquity=${w?.totalEquity} totalWalletBalance=${w?.totalWalletBalance} totalAvailable=${w?.totalAvailableBalance}`);
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message ?? e}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
