// Diagnostic: dump instrument info + per-account equity to understand qty math.
import { loadAccounts } from '../../core/accounts';
import { getRest, getInstrumentInfo } from '../../core/bybit';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error('usage: check-instrument.ts <SYMBOL> [<SYMBOL>...]');
    process.exit(1);
  }
  const accounts = loadAccounts();
  for (const account of accounts) {
    console.log(`\n=== ${account.bucket}/${account.keyName} (${account.label}) ===`);
    try {
      const c = getRest(account);
      const wallet = await c.getWalletBalance({ accountType: 'UNIFIED' });
      const eq = parseFloat(wallet.result?.list?.[0]?.totalEquity ?? '0');
      const free = parseFloat(wallet.result?.list?.[0]?.totalAvailableBalance ?? '0');
      console.log(`  totalEquity:           $${eq.toFixed(2)}`);
      console.log(`  totalAvailableBalance: $${free.toFixed(2)}`);
    } catch (e: any) {
      console.log(`  wallet error: ${e.message}`);
    }
    for (const symbol of symbols) {
      try {
        const info = await getInstrumentInfo(account, symbol);
        console.log(`  ${symbol}: qtyStep=${info.qtyStep}  minOrderQty=${info.minOrderQty}  tickSize=${info.tickSize}`);
        // Also fetch raw to see maxOrderQty and other limits
        const c = getRest(account);
        const r = await c.getInstrumentsInfo({ category: 'linear', symbol });
        const item = r.result?.list?.[0];
        if (item) {
          console.log(`    raw lotSizeFilter: ${JSON.stringify(item.lotSizeFilter)}`);
          console.log(`    raw priceFilter:   ${JSON.stringify(item.priceFilter)}`);
        }
      } catch (e: any) {
        console.log(`  ${symbol}: error ${e.message}`);
      }
    }
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('check-instrument failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
