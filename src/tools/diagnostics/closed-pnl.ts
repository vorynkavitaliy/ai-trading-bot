/**
 * Query Bybit closed PnL for a symbol across all configured accounts.
 *
 * Usage:
 *   npx tsx src/scripts/closed-pnl.ts <SYMBOL> [hoursBack=4]
 *
 * Prints per-account closed PnL records: side, qty, entry/exit price, realized PnL.
 */
import { getRest } from '../../core/bybit';
import { loadAccounts } from '../../core/accounts';

async function main() {
  const symbol = process.argv[2];
  const hoursBack = Number(process.argv[3] ?? 4);
  if (!symbol) {
    console.error('usage: npx tsx src/scripts/closed-pnl.ts <SYMBOL> [hoursBack]');
    process.exit(1);
  }
  const startTime = Date.now() - hoursBack * 3600_000;
  const accs = loadAccounts();
  for (const acc of accs) {
    const rest = getRest(acc);
    const r = await rest.getClosedPnL({ category: 'linear', symbol, startTime, limit: 50 });
    console.log(`\n=== ${acc.bucket}/${acc.keyName} ===`);
    if (r.retCode !== 0) {
      console.log('error', r.retMsg);
      continue;
    }
    const list = r.result?.list ?? [];
    if (list.length === 0) {
      console.log('(no closed pnl rows)');
      continue;
    }
    for (const row of list) {
      console.log({
        symbol: row.symbol,
        side: row.side,
        qty: row.qty,
        avgEntry: row.avgEntryPrice,
        avgExit: row.avgExitPrice,
        realizedPnl: row.closedPnl,
        execType: row.execType,
        createdAt: new Date(Number(row.createdTime)).toISOString(),
        updatedAt: new Date(Number(row.updatedTime)).toISOString(),
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
