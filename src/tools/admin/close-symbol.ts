// Operator-approved targeted close: closes ALL open positions on a SINGLE symbol
// across all accounts via reduce-only market orders + position-size verification.
// Cancels symbol-specific pending orders first. Use when a single setup needs to
// be unwound without touching the rest of the portfolio.

import { loadAccounts } from '../../core/accounts';
import { closeAcrossAccounts } from '../../core/close-verifier';
import { close as closePg, query } from '../../core/db';
import { log } from '../../core/logger';

function statusTag(status: string): string {
  if (status === 'ok') return '✅';
  if (status === 'no_position') return '∅';
  if (status === 'dust_below_min') return '⚠ dust';
  return '❌';
}

async function main() {
  const symbol = process.argv[2];
  if (!symbol) {
    console.error('usage: npx tsx src/tools/admin/close-symbol.ts <SYMBOL>');
    process.exit(1);
  }

  const accounts = loadAccounts();

  // Pre-tag the open rows as 'manual' BEFORE the Bybit close so the finalizer
  // (daemon/reconcile via autoCloseTrade) preserves the true reason instead of
  // price-proximity-inferring 'sl' (wrong journal + wrong 12h cooldown).
  await query(
    `UPDATE trades SET exit_reason = 'manual' WHERE symbol = $1 AND status = 'open'`,
    [symbol],
  );

  const result = await closeAcrossAccounts(accounts, symbol, {
    reason: 'admin close-symbol',
    cancelOrders: true,
  });

  for (const a of result.attempts) {
    const tag = statusTag(a.status);
    const detail = a.detail ? ` ${a.detail}` : '';
    console.log(
      `  ${a.account}: ${tag} ${a.symbol} initial=${a.initialSize} final=${a.finalSize} attempts=${a.attempts} status=${a.status}${detail}`,
    );
  }

  const okCount = result.attempts.filter(
    (a) => a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min',
  ).length;
  console.log(
    `\n=== ${symbol} verified-closed: ${okCount}/${result.attempts.length}, stuck: ${result.stuck.length} ===`,
  );

  if (!result.allClosed) {
    log.error('close-symbol: some accounts stuck', {
      symbol,
      stuck: result.stuck.map((s) => ({ account: s.account, finalSize: s.finalSize, status: s.status })),
    });
    await closePg();
    process.exit(2);
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('close-symbol crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
