// Operator-approved emergency close: closes ALL open positions on ALL accounts
// via reduce-only market orders. Cancels any pending TP/SL limit orders first.

import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const accounts = loadAccounts();
  const results: Array<{ account: string; symbol: string; ok: boolean; detail: string }> = [];

  for (const acc of accounts) {
    const c = getRest(acc);
    const label = `${acc.bucket}/${acc.keyName}`;

    // 1) Cancel ALL open orders (TP1/TP2 reduce-only limits, any pending entries)
    try {
      const cancelR = await withRetry(() => c.cancelAllOrders({ category: 'linear', settleCoin: 'USDT' }), { label: `cancel-${label}` });
      console.log(`  ${label}: cancelled ${cancelR.result?.list?.length ?? 0} pending orders`);
    } catch (e: any) {
      console.log(`  ${label}: cancel orders failed: ${e.message}`);
    }

    // 2) Fetch open positions
    const posR = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), { label: `pos-${label}` });
    if (posR.retCode !== 0) {
      console.log(`  ${label}: positions fetch failed retCode=${posR.retCode}`);
      continue;
    }
    const positions = (posR.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    if (positions.length === 0) {
      console.log(`  ${label}: no open positions`);
      continue;
    }

    // 3) Close each via reduce-only market order opposite side
    for (const p of positions) {
      const closeSide = p.side === 'Buy' ? 'Sell' : 'Buy';
      try {
        const r = await withRetry(() => c.submitOrder({
          category: 'linear',
          symbol: p.symbol,
          side: closeSide,
          orderType: 'Market',
          qty: p.size,
          timeInForce: 'IOC',
          reduceOnly: true,
        }), { label: `close-${p.symbol}-${label}` });
        if (r.retCode === 0) {
          console.log(`  ${label}: ✅ closed ${p.symbol} ${p.side} qty=${p.size} → ${closeSide} reduce-only`);
          results.push({ account: label, symbol: p.symbol, ok: true, detail: `qty=${p.size}` });
        } else {
          console.log(`  ${label}: ❌ ${p.symbol} retCode=${r.retCode} ${r.retMsg}`);
          results.push({ account: label, symbol: p.symbol, ok: false, detail: `${r.retCode} ${r.retMsg}` });
        }
      } catch (e: any) {
        console.log(`  ${label}: ❌ ${p.symbol} ${e.message}`);
        results.push({ account: label, symbol: p.symbol, ok: false, detail: e.message });
      }
    }
  }

  console.log(`\n=== Total close attempts: ${results.length}, ok: ${results.filter(r => r.ok).length} ===`);
  await closePg();
}

main().catch(async (e) => {
  log.error('close-all crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
