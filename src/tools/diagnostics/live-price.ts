// Quick linear (perpetual) ticker fetch for one or more symbols.
import { loadAccounts } from '../../core/accounts';
import { getLiveTickers } from '../../core/bybit';

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error('usage: npx tsx src/tools/diagnostics/live-price.ts <SYMBOL> [SYMBOL ...]');
    process.exit(1);
  }
  const accounts = loadAccounts();
  const m = await getLiveTickers(accounts[0], symbols);
  for (const s of symbols) {
    console.log(`${s}  ${m.get(s) ?? 'n/a'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
