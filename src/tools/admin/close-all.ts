// Operator-approved emergency close: closes ALL open positions on ALL accounts
// via reduce-only market orders + position-size verification. Cancels any pending
// TP/SL limit orders first.

import { loadAccounts, AccountKey } from '../../core/accounts';
import { getRest, withRetry } from '../../core/bybit';
import { closeAcrossAccounts } from '../../core/close-verifier';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

interface AccountSymbol {
  account: AccountKey;
  symbol: string;
}

async function cancelAccountOrders(acc: AccountKey): Promise<void> {
  const label = `${acc.bucket}/${acc.keyName}`;
  const c = getRest(acc);
  try {
    const r = await withRetry(
      () => c.cancelAllOrders({ category: 'linear', settleCoin: 'USDT' }),
      { label: `cancel-${label}` },
    );
    console.log(`  ${label}: cancelled ${r.result?.list?.length ?? 0} pending orders`);
  } catch (e: any) {
    console.log(`  ${label}: cancel orders failed: ${e.message}`);
  }
}

async function fetchOpenSymbols(acc: AccountKey): Promise<AccountSymbol[]> {
  const label = `${acc.bucket}/${acc.keyName}`;
  const c = getRest(acc);
  const r = await withRetry(
    () => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }),
    { label: `pos-${label}` },
  );
  if (r.retCode !== 0) {
    console.log(`  ${label}: positions fetch failed retCode=${r.retCode}`);
    return [];
  }
  return (r.result?.list ?? [])
    .filter((p: any) => parseFloat(p.size) > 0)
    .map((p: any) => ({ account: acc, symbol: p.symbol }));
}

function statusTag(status: string): string {
  if (status === 'ok') return '✅';
  if (status === 'no_position') return '∅';
  if (status === 'dust_below_min') return '⚠ dust';
  return '❌';
}

async function main() {
  const accounts = loadAccounts();

  for (const acc of accounts) {
    await cancelAccountOrders(acc);
  }

  const perAccountSymbols = await Promise.all(accounts.map(fetchOpenSymbols));
  const symbolSet = new Set<string>();
  for (const list of perAccountSymbols) {
    for (const item of list) symbolSet.add(item.symbol);
  }
  const symbols = Array.from(symbolSet).sort();

  if (symbols.length === 0) {
    console.log('\n=== no open positions across all accounts ===');
    await closePg();
    return;
  }

  console.log(`\n=== closing ${symbols.length} symbol(s): ${symbols.join(', ')} ===\n`);

  let totalAttempts = 0;
  let totalOk = 0;
  let totalStuck = 0;
  let anyStuck = false;

  for (const symbol of symbols) {
    const result = await closeAcrossAccounts(accounts, symbol, {
      reason: 'admin close-all',
      cancelOrders: false,
    });
    for (const a of result.attempts) {
      const tag = statusTag(a.status);
      const detail = a.detail ? ` ${a.detail}` : '';
      console.log(
        `  ${a.account}: ${tag} ${a.symbol} initial=${a.initialSize} final=${a.finalSize} attempts=${a.attempts} status=${a.status}${detail}`,
      );
    }
    const ok = result.attempts.filter(
      (a) => a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min',
    ).length;
    totalAttempts += result.attempts.length;
    totalOk += ok;
    totalStuck += result.stuck.length;
    if (!result.allClosed) anyStuck = true;
  }

  console.log(
    `\n=== close-all verified-closed: ${totalOk}/${totalAttempts}, stuck: ${totalStuck} ===`,
  );

  if (anyStuck) {
    log.error('close-all: some (account, symbol) pairs stuck', { totalStuck });
    await closePg();
    process.exit(2);
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('close-all crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
