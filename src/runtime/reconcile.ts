import { loadAccounts, AccountKey } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { closeAndVerify } from '../core/close-verifier';
import { log } from '../core/logger';
import { findStaleOrphans, findUnpromotedPending, markPendingOrphanedByLink, StalePending } from '../core/pending-orders';
import { tradeRepo, OpenTrade } from '../data/trade-repo';
import { promotePendingToTrade } from './pending-promoter';
import { EntryConfirmedArgs, notifyEntryConfirmedGroup } from '../core/tg-templates';
import { divergenceDetector } from './divergence-detector';
import {
  ClosedFill,
  CloseEvent,
  fetchRecentClosedPnL,
  autoCloseTrade,
  notifyConsolidatedCloses,
} from './trade-closer';

type Divergence =
  | { type: 'bybit_without_db'; account: string; symbol: string; size: number }
  | { type: 'db_without_bybit'; account: string; symbol: string; trade_id: number; qty: number }
  | { type: 'size_mismatch'; account: string; symbol: string; trade_id: number; db_qty: number; bybit_size: number };

interface ReconcileResult {
  aligned: boolean;
  ts: string;
  bybitPositionsCount: number;
  dbOpenTradesCount: number;
  divergences: Divergence[];
  staleOrphans: StalePending[];   // pending_orders rows without trade_id older than threshold
}

interface BybitPos {
  account: string;
  symbol: string;
  side: string;
  size: number;
  entry: number;
}

// Cancel pending non-reduce-only limit orders on (symbol, account). Called after
// auto-closing a trade so unfilled scaled-in DCA slots don't trigger a reverse
// position when price revisits their levels. Reduce-only orders self-cancel
// on Bybit when position size hits 0 — we only touch entry-side orphans.
async function cancelScaledInOrphans(a: AccountKey, symbol: string): Promise<number> {
  const c = getRest(a);
  try {
    const ao: any = await withRetry(() => c.getActiveOrders({ category: 'linear', symbol }),
      { label: `getActiveOrders-orphan-${a.keyName}` });
    if (ao.retCode !== 0) {
      log.warn('orphan sweep getActiveOrders failed', { symbol, account: a.keyName, msg: ao.retMsg });
      return 0;
    }
    const orders = ao.result?.list ?? [];
    const orphans = orders.filter((o: any) =>
      o.orderType === 'Limit' && o.reduceOnly === false && o.orderStatus === 'New'
    );
    if (orphans.length === 0) return 0;
    let cancelled = 0;
    for (const o of orphans) {
      try {
        const r: any = await withRetry(() => c.cancelOrder({
          category: 'linear', symbol, orderId: o.orderId,
        }), { label: `cancelOrphan-${a.keyName}-${o.orderLinkId}` });
        if (r.retCode === 0) {
          cancelled++;
          if (o.orderLinkId) {
            await markPendingOrphanedByLink(o.orderLinkId).catch((e: any) =>
              log.warn('mark pending orphaned failed', { linkId: o.orderLinkId, err: e?.message }));
          }
        } else {
          log.warn('orphan cancel failed', { symbol, linkId: o.orderLinkId, msg: r.retMsg });
        }
      } catch (e: any) {
        log.warn('orphan cancel threw', { symbol, linkId: o.orderLinkId, err: e?.message });
      }
    }
    if (cancelled > 0) {
      log.info('cancelled scaled-in orphans after close', {
        symbol, account: `${a.bucket}/${a.keyName}`, count: cancelled,
      });
    }
    return cancelled;
  } catch (e: any) {
    log.warn('orphan sweep failed', { symbol, account: a.keyName, err: e?.message });
    return 0;
  }
}

async function fetchAccountPositions(a: AccountKey): Promise<BybitPos[]> {
  const c = getRest(a);
  const r = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), {
    label: `positions-${a.bucket}/${a.keyName}`,
  });
  if (r.retCode !== 0) throw new Error(`positions retCode=${r.retCode} ${r.retMsg}`);
  const list = r.result?.list ?? [];
  return list
    .filter((p: any) => parseFloat(p.size) > 0)
    .map((p: any) => ({
      account: `${a.bucket}/${a.keyName}`,
      symbol: p.symbol,
      side: p.side,
      size: parseFloat(p.size),
      entry: parseFloat(p.avgPrice ?? '0'),
    }));
}

async function fetchDbOpenTrades(): Promise<OpenTrade[]> {
  return tradeRepo.openTrades();
}

export async function runReconcile(): Promise<ReconcileResult> {
  const accounts = loadAccounts();
  const [allBybit, dbOpen] = await Promise.all([
    Promise.all(accounts.map(a => fetchAccountPositions(a))).then(arr => arr.flat()),
    fetchDbOpenTrades(),
  ]);

  const divergences: Divergence[] = [];
  const accountByLabel = new Map(accounts.map((a) => [`${a.bucket}/${a.keyName}`, a]));
  const confirmedEntries: EntryConfirmedArgs[] = [];

  for (const pos of allBybit) {
    const match = dbOpen.find(t =>
      `${t.account_bucket}/${t.account_key}` === pos.account &&
      t.symbol === pos.symbol &&
      t.side.toLowerCase() === pos.side.toLowerCase()
    );
    if (!match) {
      const acc = accountByLabel.get(pos.account);
      if (acc && (pos.side === 'Buy' || pos.side === 'Sell')) {
        try {
          const pending = await findUnpromotedPending(acc.bucket, acc.keyName, pos.symbol, pos.side);
          if (pending) {
            const r = await promotePendingToTrade(pending, { size: pos.size, avgPrice: pos.entry });
            if (r?.created) {
              confirmedEntries.push({
                symbol: pos.symbol, side: pos.side, size: pos.size, avgPrice: pos.entry,
                sl: pending.sl, tp: pending.tp1, account: pos.account,
              });
            }
            continue;
          }
        } catch (e: any) {
          log.warn('pending promotion failed during reconcile; falling through to bybit_without_db', {
            account: pos.account, symbol: pos.symbol, side: pos.side, err: e?.message,
          });
        }
      }
      divergences.push({ type: 'bybit_without_db', account: pos.account, symbol: pos.symbol, size: pos.size });
      continue;
    }

    const verdict = divergenceDetector.classify(pos, match);
    if (verdict === 'aligned') continue;

    if (verdict === 'tp1_partial') {
      log.info('reconcile: expected partial-fill (TP1) — watcher will sync', {
        symbol: pos.symbol, account: pos.account,
        initial_qty: match.initial_qty, db_qty: match.qty, bybit_size: pos.size,
      });
      continue;
    }

    if (verdict === 'dust') {
      const ratioVsInitial = pos.size / Math.max(match.initial_qty, 1);
      log.info('reconcile: dust detected — closing via closeAndVerify', {
        symbol: pos.symbol, account: pos.account,
        initial_qty: match.initial_qty, bybit_size: pos.size,
        ratio: ratioVsInitial.toFixed(4),
      });
      const accForDust = accounts.find((a) => `${a.bucket}/${a.keyName}` === pos.account);
      if (accForDust) {
        try {
          const r = await closeAndVerify(accForDust, pos.symbol, {
            reason: `reconcile-dust trade=${match.id}`,
            cancelOrders: false,
          });
          if (r.status === 'ok' || r.status === 'dust_below_min') {
            pos.size = 0;
          } else {
            log.warn('reconcile dust close stuck', {
              symbol: pos.symbol, status: r.status, finalSize: r.finalSize,
            });
          }
        } catch (e: any) {
          log.warn('reconcile dust close threw', { symbol: pos.symbol, err: e?.message });
        }
      }
      continue;
    }

    // verdict === 'mismatch'
    divergences.push({
      type: 'size_mismatch', account: pos.account, symbol: pos.symbol,
      trade_id: match.id, db_qty: match.qty, bybit_size: pos.size,
    });
  }
  // ─── Phase B: gap-fill closures that happened while the bot was offline ─────────
  // For every DB trade still marked 'open' but with no matching Bybit position:
  // the broker closed it (SL/TP/manual/liquidation) at some point between cycles.
  // We call getClosedPnL, aggregate ALL closing fills for the position cycle
  // (partial TP1 + remaining TP2 + any other reduceOnly hits), volume-weight the
  // exit price, sum realized PnL, classify exitReason by distance to recorded
  // SL/TP1/TP2 levels, then UPDATE trades SET status='closed', exit_price,
  // closed_at, realized_r, pnl_usd, exit_reason. Finally we send ONE consolidated
  // Telegram close message per (symbol+side+exitReason) so a 5-account broadcast
  // doesn't produce 5 separate messages.
  //
  // This is the equivalent of the "fetch trades since last_seen_ts" gap-fill in
  // brokers that expose a /trades feed. Bybit's getClosedPnL does the same job
  // because every Bybit fill that reduces a position becomes a closedPnL record.
  // Without this loop, a SL hit during a cron downtime would never be journaled
  // and daily-DD would be computed off a stale equity baseline.
  // ────────────────────────────────────────────────────────────────────────────────
  const closedFillsCache = new Map<string, ClosedFill[]>();
  const closeEvents: CloseEvent[] = [];

  for (const t of dbOpen) {
    const label = `${t.account_bucket}/${t.account_key}`;
    // Skip if active Bybit pos still exists (with non-zero size — dust set to 0 above
    // should fall through to auto-close).
    const has = allBybit.find(p =>
      label === p.account &&
      t.symbol === p.symbol &&
      t.side.toLowerCase() === p.side.toLowerCase() &&
      p.size > 0
    );
    if (has) continue;

    const acc = accountByLabel.get(label);
    if (acc) {
      const cacheKey = `${label}|${t.symbol}`;
      let fills = closedFillsCache.get(cacheKey);
      if (!fills) {
        fills = await fetchRecentClosedPnL(acc, t.symbol);
        closedFillsCache.set(cacheKey, fills);
      }
      const evt = await autoCloseTrade(t, fills);
      if (evt) {
        closeEvents.push(evt);
        // Cancel any orphan scaled-in entry limits (slots 1/2 that never filled).
        // Position is closed → these would otherwise open a reverse position if
        // price revisits their levels. Reduce-only orders self-cancel; entries don't.
        await cancelScaledInOrphans(acc, t.symbol).catch((e) => {
          log.warn('orphan sweep error (non-fatal)', { symbol: t.symbol, err: e?.message });
        });
        continue;
      }
    }

    divergences.push({
      type: 'db_without_bybit',
      account: label,
      symbol: t.symbol, trade_id: t.id, qty: t.qty,
    });
  }

  // Send consolidated Telegram messages: one per (symbol+side+exitReason) group.
  await notifyConsolidatedCloses(closeEvents);

  // Promotion catch-net confirmations: a limit that filled while the daemon was
  // down is journaled here; tell the operator the entry is now live.
  const confirmedGroups = new Map<string, EntryConfirmedArgs[]>();
  for (const e of confirmedEntries) {
    const key = `${e.symbol}-${e.side}`;
    (confirmedGroups.get(key) ?? confirmedGroups.set(key, []).get(key)!).push(e);
  }
  for (const group of confirmedGroups.values()) {
    const first = group[0];
    const tag = first.symbol.replace(/USDT$/, '');
    await notifyEntryConfirmedGroup({
      symbol: first.symbol,
      side: first.side,
      sizeTotal: group.reduce((s, e) => s + e.size, 0),
      avgPrice: first.avgPrice,
      sl: first.sl,
      tp: first.tp,
      accountSummaries: group.map((e) => `${e.account} — ${e.size.toFixed(2)} ${tag}`),
    }).catch((err) =>
      log.warn('reconcile notifyEntryConfirmedGroup failed', { symbol: first.symbol, err: err?.message }));
  }

  // ─── Pending-orders sweep: surface intents that never made it to a trades row ───
  // A 'pending_orders' row with NULL trade_id older than 5 min means either:
  //   - execute.ts crashed between submitOrder.ok and persistTrade's INSERT
  //   - Bybit submitOrder threw and pending stays 'failed' but the position may
  //     still exist on the broker (network race)
  // We don't auto-resolve (querying Bybit /orders/realtime by orderLinkId is a
  // separate piece of work); we just report so the operator can investigate.
  let staleOrphans: StalePending[] = [];
  try {
    staleOrphans = await findStaleOrphans(5);
    if (staleOrphans.length > 0) {
      log.warn('pending_orders stale orphans detected', {
        count: staleOrphans.length,
        items: staleOrphans.map((o) => ({
          orderLinkId: o.orderLinkId, account: o.accountLabel,
          symbol: o.symbol, side: o.side, status: o.status,
          ageMin: Math.round(o.ageMin), bybitOrderId: o.bybitOrderId,
        })),
      });
    }
  } catch (e: any) {
    log.warn('pending_orders sweep failed', { err: e?.message });
  }

  return {
    aligned: divergences.length === 0 && staleOrphans.length === 0,
    ts: new Date().toISOString(),
    bybitPositionsCount: allBybit.length,
    dbOpenTradesCount: dbOpen.length,
    divergences,
    staleOrphans,
  };
}

async function main() {
  const r = await runReconcile();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.aligned ? 0 : 4);
}

if (require.main === module) {
  main().catch(e => {
    log.error('reconcile crashed', { err: e?.message ?? String(e), stack: e?.stack });
    process.exit(1);
  });
}
