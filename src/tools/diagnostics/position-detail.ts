// Print full position details for a symbol (incl. SL/TP set on position)
import { loadAccounts } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { close as closePg } from '../../core/db';

async function main() {
  const symbol = (process.argv[2] ?? 'XRPUSDT').toUpperCase();
  const accounts = loadAccounts();
  for (const a of accounts) {
    const c = getRest(a);
    const pr: any = await withRetry(() => c.getPositionInfo({ category: 'linear', symbol }),
      { label: `getPosition-${a.keyName}` });
    const positions = (pr.result?.list ?? []).filter((p: any) => parseFloat(p.size) > 0);
    console.log(`\n${a.bucket}/${a.keyName}:`);
    if (positions.length === 0) { console.log('  (no position)'); continue; }
    for (const p of positions) {
      console.log(`  side=${p.side} size=${p.size} avgPrice=${p.avgPrice} unrealisedPnl=${p.unrealisedPnl}`);
      console.log(`  stopLoss=${p.stopLoss || '(none)'} takeProfit=${p.takeProfit || '(none)'}`);
      console.log(`  positionIM=${p.positionIM} positionMM=${p.positionMM} leverage=${p.leverage}`);
    }
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
