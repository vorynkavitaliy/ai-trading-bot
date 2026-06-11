/**
 * Entry-TTL canceller — cron, every 5 min via scripts/cycle.sh (Phase 2, 2026-06-11).
 *
 * The validated srcNew engine expires an unfilled limit entry 230 minutes after
 * placement — 10 min before the next 4H decision boundary, so the pair is free to
 * re-signal. Live resting limits had NO lifecycle at all (the 2026-06-04 incident
 * class); this module is layer 1 of the triple guard (layer 2 = risk-guard
 * status-driven pair occupancy, layer 3 = execute's cancel-before-place).
 *
 * Sweep rules:
 *   - normal: cancel entry limits past their per-row TTL (pending_orders.ttl_minutes,
 *     default 230).
 *   - PAUSE.md present: cancel ALL resting entry limits regardless of age — the
 *     operator's pause means "no new exposure", and a resting limit is exposure
 *     waiting to happen. (Exits are never touched: reduce-only TP/SL stay.)
 *
 * Race-safety: a fill can land while the cancel is in flight. The pending row is
 * marked 'cancelled' ONLY when Bybit confirms the order died unfilled; any sign of
 * execution (PartiallyFilled remainder-cancel, Filled in history) leaves the row
 * 'placed' so the promoter (daemon ≤1s / reconcile ≤5min) materializes the trades
 * row for the credited position. 5-min cron granularity means cancels land at
 * TTL+0..5 min — a few extra fill-eligible minutes vs the engine's exact expiry,
 * conservative-small.
 *
 * Charter note: the "do not cancel pending limit orders younger than 15 minutes"
 * rule is satisfied — TTL 230 ≫ 15; the PAUSE sweep is the operator-halt exemption.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAccounts, AccountKey } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { close as closePg } from '../core/db';
import {
  findExpiredEntryPendings, findRestingEntryPendings, findLinkedEntryRemainders,
  markCancelled, RestingEntryPending,
} from '../core/pending-orders';
import { send as sendTelegram } from '../core/telegram';
import { log } from '../core/logger';

const PAUSE_FILE = path.resolve(__dirname, '..', '..', 'vault', 'Watchlist', 'PAUSE.md');

export type CancelOutcome = 'cancelled' | 'filled_awaiting_promotion' | 'partial_remainder_cancelled' | 'error';

export async function cancelRestingEntry(
  account: AccountKey,
  row: RestingEntryPending,
  why: string,
): Promise<CancelOutcome> {
  const label = `${account.bucket}/${account.keyName}`;
  const c = getRest(account);
  try {
    const ao: any = await withRetry(
      () => c.getActiveOrders({ category: 'linear', symbol: row.symbol, orderLinkId: row.orderLinkId }),
      { label: `ttl-active-${row.symbol}-${account.keyName}` },
    );
    const active = (ao.result?.list ?? []).find((o: any) => o.orderLinkId === row.orderLinkId);

    if (active) {
      const r: any = await withRetry(
        () => c.cancelOrder({ category: 'linear', symbol: row.symbol, orderLinkId: row.orderLinkId }),
        { label: `ttl-cancel-${row.symbol}-${account.keyName}` },
      );
      if (r.retCode !== 0 && !/order not exists|too late|110001/i.test(r.retMsg ?? '')) {
        log.error('entry-ttl: cancel rejected — will retry next tick', {
          account: label, symbol: row.symbol, link: row.orderLinkId, retMsg: r.retMsg,
        });
        return 'error';
      }
      // FALL THROUGH to the history check below. A fill can land inside the
      // read→cancel window (both full — cancel then rejected "order not exists" —
      // and partial — cancel succeeds on the remainder only). The pre-cancel
      // snapshot's cumExecQty is STALE; only post-cancel history tells the truth.
      // Marking a filled entry 'cancelled' would orphan the position (the promoter
      // requires status='placed') — the 2026-06-04 incident class inverted.
    }

    // Single source of truth: order history AFTER any cancel attempt.
    const hist: any = await withRetry(
      () => c.getHistoricOrders({ category: 'linear', symbol: row.symbol, orderLinkId: row.orderLinkId, limit: 1 }),
      { label: `ttl-hist-${row.symbol}-${account.keyName}` },
    );
    const ho = (hist.result?.list ?? [])[0];
    const status = ho?.orderStatus ?? 'NotFound';
    const executed = parseFloat(ho?.cumExecQty ?? '0') > 0;

    if (executed) {
      log.info('entry-ttl: order (partially) FILLED — leaving row for promotion', {
        account: label, symbol: row.symbol, link: row.orderLinkId, status,
        cumExecQty: ho?.cumExecQty,
      });
      return status === 'Filled' ? 'filled_awaiting_promotion' : 'partial_remainder_cancelled';
    }
    if (active && status === 'NotFound') {
      // Cancel went through but history hasn't caught up — stay conservative, keep
      // the row 'placed'; the next 5-min sweep re-reads history idempotently.
      log.info('entry-ttl: cancel sent, history not yet visible — will confirm next tick', {
        account: label, symbol: row.symbol, link: row.orderLinkId,
      });
      return 'error';
    }
    await markCancelled(row.id, `${why} (bybit status: ${status})`);
    log.info('entry-ttl: resting entry cancelled unfilled', {
      account: label, symbol: row.symbol, link: row.orderLinkId, ageMin: Math.round(row.ageMin), status, why,
    });
    return 'cancelled';
  } catch (e: any) {
    log.error('entry-ttl: cancel attempt threw — will retry next tick', {
      account: label, symbol: row.symbol, link: row.orderLinkId, err: e?.message ?? String(e),
    });
    return 'error';
  }
}

function accountFor(accounts: AccountKey[], row: RestingEntryPending): AccountKey | undefined {
  return accounts.find((a) => a.bucket === row.accountBucket && a.keyName === row.accountKey);
}

// Bybit-side cancel of a PROMOTED row's entry remainder (partial fill case). No DB
// status change — the row is already linked to its trade; "resolved" here means
// the GTC remainder is out of the book so it cannot grow the position past TTL or
// re-open one after the trade closes.
async function cancelLinkedRemainder(account: AccountKey, row: RestingEntryPending): Promise<boolean> {
  const label = `${account.bucket}/${account.keyName}`;
  const c = getRest(account);
  try {
    const ao: any = await withRetry(
      () => c.getActiveOrders({ category: 'linear', symbol: row.symbol, orderLinkId: row.orderLinkId }),
      { label: `ttl-rem-active-${row.symbol}-${account.keyName}` },
    );
    const active = (ao.result?.list ?? []).find((o: any) => o.orderLinkId === row.orderLinkId);
    if (!active) return false;
    const r: any = await withRetry(
      () => c.cancelOrder({ category: 'linear', symbol: row.symbol, orderLinkId: row.orderLinkId }),
      { label: `ttl-rem-cancel-${row.symbol}-${account.keyName}` },
    );
    if (r.retCode === 0 || /order not exists|too late|110001/i.test(r.retMsg ?? '')) {
      log.info('entry-ttl: partial-fill entry remainder cancelled', {
        account: label, symbol: row.symbol, link: row.orderLinkId, ageMin: Math.round(row.ageMin),
      });
      return true;
    }
    log.error('entry-ttl: remainder cancel rejected — will retry next tick', {
      account: label, symbol: row.symbol, link: row.orderLinkId, retMsg: r.retMsg,
    });
    return false;
  } catch (e: any) {
    log.error('entry-ttl: remainder cancel threw — will retry next tick', {
      account: label, symbol: row.symbol, link: row.orderLinkId, err: e?.message ?? String(e),
    });
    return false;
  }
}

/**
 * Cancel any non-reduce-only entry limits ('e-' links) still resting on a symbol —
 * called by the daemon's full-close path so a partial-fill remainder cannot
 * survive its trade and silently re-open a position later (a closed trade's
 * pending row is already linked, so the promoter could never adopt the re-fill).
 * Reduce-only exits (tp-/rtp- links) are never touched. Never throws.
 */
export async function cancelSymbolEntryRemainders(account: AccountKey, symbol: string): Promise<void> {
  const label = `${account.bucket}/${account.keyName}`;
  try {
    const c = getRest(account);
    const ao: any = await withRetry(
      () => c.getActiveOrders({ category: 'linear', symbol }),
      { label: `close-rem-active-${symbol}-${account.keyName}` },
    );
    const entries = (ao.result?.list ?? []).filter(
      (o: any) => o.reduceOnly === false && o.orderType === 'Limit' && String(o.orderLinkId ?? '').startsWith('e-'),
    );
    for (const o of entries) {
      const r: any = await withRetry(
        () => c.cancelOrder({ category: 'linear', symbol, orderId: o.orderId }),
        { label: `close-rem-cancel-${symbol}-${account.keyName}` },
      );
      if (r.retCode === 0 || /order not exists|too late|110001/i.test(r.retMsg ?? '')) {
        log.info('entry remainder cancelled on trade close', {
          account: label, symbol, link: o.orderLinkId,
        });
      } else {
        log.error('entry remainder cancel rejected on trade close', {
          account: label, symbol, link: o.orderLinkId, retMsg: r.retMsg,
        });
      }
    }
  } catch (e: any) {
    log.warn('cancelSymbolEntryRemainders failed (reconcile orphan sweep is the catch-net)', {
      account: label, symbol, err: e?.message ?? String(e),
    });
  }
}

export async function runEntryTtlSweep(): Promise<{ swept: number; cancelled: number }> {
  const paused = fs.existsSync(PAUSE_FILE);
  const rows = paused ? await findRestingEntryPendings() : await findExpiredEntryPendings();
  const remainders = await findLinkedEntryRemainders();
  if (rows.length === 0 && remainders.length === 0) return { swept: 0, cancelled: 0 };

  const accounts = loadAccounts();
  const why = paused ? 'PAUSE.md sweep (no new exposure while paused)' : 'TTL expired';
  let cancelled = 0;
  const cancelledSymbols = new Set<string>();

  for (const row of rows) {
    const account = accountFor(accounts, row);
    if (!account) {
      log.error('entry-ttl: no matching account in accounts.json — manual cleanup needed', {
        bucket: row.accountBucket, key: row.accountKey, symbol: row.symbol, id: row.id,
      });
      continue;
    }
    const outcome = await cancelRestingEntry(account, row, why);
    if (outcome === 'cancelled') {
      cancelled++;
      cancelledSymbols.add(row.symbol);
    }
  }

  // Partial-fill remainders of already-promoted entries: Bybit-side cancel only
  // (DB row stays linked to its trade). Engine parity — the whole pending dies at TTL.
  for (const row of remainders) {
    const account = accountFor(accounts, row);
    if (account) await cancelLinkedRemainder(account, row);
  }

  if (cancelledSymbols.size > 0) {
    const reason = paused ? 'пауза оператора' : 'истёк срок ожидания';
    try {
      await sendTelegram(
        `⏳ <b>Вход не исполнился</b>\nЛимитные заявки сняты: ${[...cancelledSymbols].join(', ')}.\nПричина: ${reason}. Позиции не открыты, риска нет. Следующее решение — на ближайшей 4H-границе.`,
      );
    } catch (e: any) {
      log.warn('entry-ttl: telegram notify failed', { err: e?.message ?? String(e) });
    }
  }

  return { swept: rows.length, cancelled };
}

async function main() {
  const res = await runEntryTtlSweep();
  console.log(res.swept === 0 ? 'entry-ttl: nothing to sweep' : `entry-ttl: swept=${res.swept} cancelled=${res.cancelled}`);
  await closePg();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (e) => {
      log.error('entry-ttl failed', { err: e?.message ?? String(e), stack: e?.stack });
      try { await closePg(); } catch {}
      process.exit(1);
    });
}
