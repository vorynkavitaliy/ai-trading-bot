// Operator-approved targeted close: closes ALL open positions on a SINGLE symbol
// across all accounts via reduce-only market orders. Cancels symbol-specific
// pending orders first. Use when a single setup needs to be unwound without
// touching the rest of the portfolio.

import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const symbol = process.argv[2];
  if (!symbol) {
    console.error('usage: npx tsx src/tools/admin/close-symbol.ts <SYMBOL>');
    process.exit(1);
  }

  const accounts = loadAccounts();
  const results: Array<{ account: string; symbol: string; ok: boolean; detail: string }> = [];

  for (const acc of accounts) {
    const c = getRest(acc);
    const label = `${acc.bucket}/${acc.keyName}`;

    try {
      const cancelR = await withRetry(
        () => c.cancelAllOrders({ category: 'linear', symbol }),
        { label: `cancel-${symbol}-${label}` }
      );
      console.log(`  ${label}: cancelled ${cancelR.result?.list?.length ?? 0} pending ${symbol} orders`);
    } catch (e: any) {
      console.log(`  ${label}: cancel orders failed: ${e.message}`);
    }

    const posR = await withRetry(
      () => c.getPositionInfo({ category: 'linear', symbol }),
      { label: `pos-${symbol}-${label}` }
    );
    if (posR.retCode !== 0) {
      console.log(`  ${label}: positions fetch failed retCode=${posR.retCode}`);
      continue;
    }
    const positions = (posR.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    if (positions.length === 0) {
      console.log(`  ${label}: no open ${symbol} position`);
      continue;
    }

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

  console.log(`\n=== ${symbol} close attempts: ${results.length}, ok: ${results.filter(r => r.ok).length} ===`);
  await closePg();
}

main().catch(async (e) => {
  log.error('close-symbol crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
