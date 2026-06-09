import { loadAccounts, AccountKey } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { closeAcrossAccounts, CloseAttempt } from '../core/close-verifier';
import { log } from '../core/logger';

export interface AccountSymbol {
  account: AccountKey;
  symbol: string;
}

export interface CloseAllOptions {
  cancelPending: boolean;
  outerRetries: number;
  reason: string;
  onProgress?: (line: string) => Promise<void> | void;
}

export interface CloseAllResult {
  accounts: number;
  symbols: string[];
  totalAttempts: number;
  totalOk: number;
  totalStuck: number;
  perSymbol: { symbol: string; attempts: CloseAttempt[] }[];
  retriesUsed: number;
  allClosed: boolean;
}

async function cancelAccountOrders(acc: AccountKey, emit: (s: string) => Promise<void>): Promise<void> {
  const label = `${acc.bucket}/${acc.keyName}`;
  const c = getRest(acc);
  try {
    const r = await withRetry(
      () => c.cancelAllOrders({ category: 'linear', settleCoin: 'USDT' }),
      { label: `cancel-${label}` },
    );
    await emit(`  ${label}: cancelled ${r.result?.list?.length ?? 0} pending`);
  } catch (e: any) {
    await emit(`  ${label}: cancel failed: ${e.message}`);
  }
}

async function fetchOpenSymbols(acc: AccountKey): Promise<AccountSymbol[]> {
  const c = getRest(acc);
  const r = await withRetry(
    () => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }),
    { label: `pos-${acc.bucket}/${acc.keyName}` },
  );
  if (r.retCode !== 0) return [];
  return (r.result?.list ?? [])
    .filter((p: any) => parseFloat(p.size) > 0)
    .map((p: any) => ({ account: acc, symbol: p.symbol }));
}

export async function listOpenSymbolsAcrossAccounts(): Promise<{ symbols: string[]; openCount: number }> {
  const accounts = loadAccounts();
  const perAccount = await Promise.all(accounts.map(fetchOpenSymbols));
  const set = new Set<string>();
  let openCount = 0;
  for (const list of perAccount) {
    for (const item of list) {
      set.add(item.symbol);
      openCount++;
    }
  }
  return { symbols: Array.from(set).sort(), openCount };
}

export async function closeAllAcrossAccounts(opts: CloseAllOptions): Promise<CloseAllResult> {
  const accounts = loadAccounts();
  const emit = async (s: string) => {
    log.info('close-runner', { line: s });
    if (opts.onProgress) await opts.onProgress(s);
  };

  if (opts.cancelPending) {
    await emit('Cancelling pending orders…');
    for (const acc of accounts) {
      await cancelAccountOrders(acc, emit);
    }
  }

  let perSymbol: { symbol: string; attempts: CloseAttempt[] }[] = [];
  let stuckSymbols = new Set<string>();
  let retriesUsed = 0;

  for (let round = 0; round <= opts.outerRetries; round++) {
    const symbolsThisRound = round === 0
      ? (await listOpenSymbolsAcrossAccounts()).symbols
      : Array.from(stuckSymbols);

    if (symbolsThisRound.length === 0) {
      if (round === 0) {
        await emit('No open positions across accounts.');
      } else {
        await emit(`Round ${round}: all clear ✅`);
      }
      break;
    }

    if (round > 0) {
      retriesUsed = round;
      await emit(`Retry round ${round}: ${symbolsThisRound.length} stuck symbol(s)…`);
    } else {
      await emit(`Closing ${symbolsThisRound.length} symbol(s): ${symbolsThisRound.join(', ')}`);
    }

    stuckSymbols = new Set<string>();

    for (const symbol of symbolsThisRound) {
      const result = await closeAcrossAccounts(accounts, symbol, {
        reason: opts.reason,
        cancelOrders: false,
      });
      if (round === 0) {
        perSymbol.push({ symbol, attempts: result.attempts });
      } else {
        const existing = perSymbol.find((p) => p.symbol === symbol);
        if (existing) existing.attempts = result.attempts;
      }
      for (const a of result.attempts) {
        const tag = a.status === 'ok' ? '✅'
          : a.status === 'no_position' ? '∅'
            : a.status === 'dust_below_min' ? '⚠'
              : '❌';
        await emit(`  ${tag} ${a.account} ${symbol} ${a.status} (final=${a.finalSize})`);
      }
      if (!result.allClosed) stuckSymbols.add(symbol);
    }

    if (stuckSymbols.size === 0) break;
  }

  let totalAttempts = 0, totalOk = 0, totalStuck = 0;
  for (const ps of perSymbol) {
    totalAttempts += ps.attempts.length;
    for (const a of ps.attempts) {
      if (a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min') totalOk++;
      else totalStuck++;
    }
  }

  return {
    accounts: accounts.length,
    symbols: perSymbol.map((p) => p.symbol),
    totalAttempts,
    totalOk,
    totalStuck,
    perSymbol,
    retriesUsed,
    allClosed: stuckSymbols.size === 0,
  };
}
