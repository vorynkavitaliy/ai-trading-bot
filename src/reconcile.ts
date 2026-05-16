import { randomUUID } from 'node:crypto';
import { loadAccounts, AccountKey } from './lib/accounts';
import { getRest, withRetry } from './lib/bybit';
import { query } from './lib/db';
import { notifyClose } from './lib/tg-templates';
import { log } from './lib/logger';
import { findStaleOrphans, StalePending } from './lib/pending-orders';

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

interface DbOpenTrade {
  id: number;
  account_key: string;
  account_bucket: string;
  symbol: string;
  side: string;
  qty: number;
  initial_qty: number;        // original qty at open (before TP1 partial fill)
  entry_price: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  opened_at: string;
  tp1_filled: boolean;        // tp1_filled_at IS NOT NULL → partial fill already processed
}

async function fetchDbOpenTrades(): Promise<DbOpenTrade[]> {
  const r = await query<any>(
    `SELECT id, account_bucket, account_key, symbol, side, qty::text,
            COALESCE(initial_qty, qty)::text AS initial_qty,
            entry_price::text, sl::text, tp1::text, tp2::text,
            opened_at::text,
            tp1_filled_at IS NOT NULL AS tp1_filled
     FROM trades WHERE status = 'open'`
  );
  return r.rows.map((row) => ({
    id: row.id,
    account_bucket: row.account_bucket,
    account_key: row.account_key,
    symbol: row.symbol,
    side: row.side,
    qty: parseFloat(row.qty),
    initial_qty: parseFloat(row.initial_qty),
    entry_price: row.entry_price ? parseFloat(row.entry_price) : null,
    sl: row.sl ? parseFloat(row.sl) : null,
    tp1: row.tp1 ? parseFloat(row.tp1) : null,
    tp2: row.tp2 ? parseFloat(row.tp2) : null,
    opened_at: row.opened_at,
    tp1_filled: row.tp1_filled === true,
  }));
}

interface ClosedFill {
  symbol: string;
  side: string;
  closedSize: number;
  avgEntryPrice: number;
  avgExitPrice: number;
  closedPnl: number;
  closedTime: number;
}

async function fetchRecentClosedPnL(a: AccountKey, symbol: string): Promise<ClosedFill[]> {
  const c = getRest(a);
  const r = await withRetry(() => c.getClosedPnL({
    category: 'linear', symbol, limit: 20,
  }), { label: `closed-pnl-${a.bucket}/${a.keyName}` });
  if (r.retCode !== 0) {
    log.warn('getClosedPnL failed', { account: a.keyName, symbol, retCode: r.retCode, msg: r.retMsg });
    return [];
  }
  return (r.result?.list ?? []).map((p: any) => ({
    symbol: p.symbol,
    side: p.side,
    closedSize: parseFloat(p.closedSize ?? p.qty ?? '0'),
    avgEntryPrice: parseFloat(p.avgEntryPrice ?? '0'),
    avgExitPrice: parseFloat(p.avgExitPrice ?? '0'),
    closedPnl: parseFloat(p.closedPnl ?? '0'),
    closedTime: parseInt(p.updatedTime ?? p.createdTime ?? '0', 10),
  }));
}

function inferExitReason(t: DbOpenTrade, exitPrice: number): 'sl' | 'tp1' | 'tp2' | 'manual' {
  // Exit price closest to which level?
  const isLong = t.side.toLowerCase() === 'buy' || t.side.toLowerCase() === 'long';
  const candidates: Array<{ name: 'sl' | 'tp1' | 'tp2'; price: number }> = [];
  if (t.sl != null) candidates.push({ name: 'sl', price: t.sl });
  if (t.tp1 != null) candidates.push({ name: 'tp1', price: t.tp1 });
  if (t.tp2 != null) candidates.push({ name: 'tp2', price: t.tp2 });
  if (candidates.length === 0) return 'manual';
  // For each level, distance in fractional terms; pick min if within 1% of exit
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(exitPrice - c.price) / Math.max(c.price, 1);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  if (bestDist > 0.01) return 'manual';   // > 1% away from any level → manual exit
  // Sanity: SL must be on the loss side of entry; TP on profit side
  if (best.name === 'sl') {
    if (isLong && exitPrice >= (t.entry_price ?? 0)) return 'manual';
    if (!isLong && exitPrice <= (t.entry_price ?? Infinity)) return 'manual';
  }
  return best.name;
}

interface CloseEvent {
  trade: DbOpenTrade;
  exitReason: 'sl' | 'tp1' | 'tp2' | 'manual';
  exitPrice: number;
  entryPrice: number;
  pnlUsd: number;
  pnlR: number;
  qty: number;
  closedTs: number;
}

async function autoCloseTrade(t: DbOpenTrade, fills: ClosedFill[]): Promise<CloseEvent | null> {
  // Aggregate ALL closedPnL records since the trade was opened. Strategy uses partial
  // TP1 + TP2 close logic, so a single position produces 2-3 closedPnL records.
  // Bybit V5 reports `side` of the CLOSING trade (Sell closes Long, Buy closes Short),
  // not the side that opened the position. So invert the filter:
  const closingSide = t.side.toLowerCase() === 'buy' ? 'Sell' : 'Buy';
  const openedTs = new Date(t.opened_at).getTime();

  const matched = fills
    .filter((f) => f.symbol === t.symbol && f.side === closingSide)
    .filter((f) => f.closedTime >= openedTs - 60_000)
    .sort((a, b) => a.closedTime - b.closedTime);

  if (matched.length === 0) return null;

  const totalClosedSize = matched.reduce((s, f) => s + f.closedSize, 0);
  const closeRatio = t.qty > 0 ? totalClosedSize / t.qty : 0;
  if (closeRatio < 0.9) {
    log.info('partial close detected, waiting for full close', {
      id: t.id, symbol: t.symbol, closedSoFar: totalClosedSize, ofTotal: t.qty,
    });
    return null;
  }

  // Aggregate exit price (volume-weighted avg) and total PnL.
  const totalPnl = matched.reduce((s, f) => s + f.closedPnl, 0);
  const wAvgExit = matched.reduce((s, f) => s + f.avgExitPrice * f.closedSize, 0) / totalClosedSize;
  const wAvgEntry = matched.reduce((s, f) => s + f.avgEntryPrice * f.closedSize, 0) / totalClosedSize;
  const lastTs = matched[matched.length - 1].closedTime;

  const exitReason = inferExitReason(t, wAvgExit);
  const stopDist = t.sl != null && t.entry_price != null ? Math.abs(t.entry_price - t.sl) : 0;
  const riskedUsd = stopDist * t.qty;
  const pnlR = riskedUsd > 0 ? totalPnl / riskedUsd : 0;

  await query(
    `UPDATE trades SET status = 'closed',
       exit_price = $1, closed_at = to_timestamp($2 / 1000.0),
       realized_r = $3, pnl_usd = $4, exit_reason = $5
     WHERE id = $6`,
    [wAvgExit, lastTs, pnlR, totalPnl, exitReason, t.id]
  );

  log.info('auto-closed trade', {
    id: t.id, symbol: t.symbol, account: `${t.account_bucket}/${t.account_key}`,
    fillCount: matched.length, exitPrice: wAvgExit, exitReason,
    pnlUsd: totalPnl.toFixed(2), pnlR: pnlR.toFixed(2),
  });

  return {
    trade: t,
    exitReason,
    exitPrice: wAvgExit,
    entryPrice: t.entry_price ?? wAvgEntry,
    pnlUsd: totalPnl,
    pnlR,
    qty: totalClosedSize,
    closedTs: lastTs,
  };
}

// Group closes by (symbol, side, exitReason) and send ONE consolidated Telegram per group.
async function notifyConsolidatedCloses(events: CloseEvent[]): Promise<void> {
  if (events.length === 0) return;
  // Bucket by symbol|side|exitReason
  const groups = new Map<string, CloseEvent[]>();
  for (const e of events) {
    const key = `${e.trade.symbol}|${e.trade.side}|${e.exitReason}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  for (const [, group] of groups) {
    const first = group[0];
    // Aggregate stats: sum pnl, weighted-avg entry/exit/R
    const totalQty = group.reduce((s, e) => s + e.qty, 0);
    const totalPnl = group.reduce((s, e) => s + e.pnlUsd, 0);
    const wAvgEntry = group.reduce((s, e) => s + e.entryPrice * e.qty, 0) / totalQty;
    const wAvgExit = group.reduce((s, e) => s + e.exitPrice * e.qty, 0) / totalQty;
    const wAvgR = group.reduce((s, e) => s + e.pnlR * e.qty, 0) / totalQty;
    try {
      await notifyClose({
        symbol: first.trade.symbol,
        side: first.trade.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
        exitReason: first.exitReason,
        entryPrice: wAvgEntry,
        exitPrice: wAvgExit,
        pnlUsd: totalPnl,
        pnlR: wAvgR,
        accountFills: group.map((e) => ({
          label: `${e.trade.account_bucket}/${e.trade.account_key}`,
          qty: e.qty,
          pnlUsd: e.pnlUsd,
          pnlR: e.pnlR,
        })),
      });
    } catch (e: any) {
      log.warn('consolidated close telegram failed', { err: e?.message ?? String(e) });
    }
  }
}

export async function runReconcile(): Promise<ReconcileResult> {
  const accounts = loadAccounts();
  const [allBybit, dbOpen] = await Promise.all([
    Promise.all(accounts.map(a => fetchAccountPositions(a))).then(arr => arr.flat()),
    fetchDbOpenTrades(),
  ]);

  const divergences: Divergence[] = [];

  // Build account lookup
  for (const pos of allBybit) {
    const match = dbOpen.find(t =>
      `${t.account_bucket}/${t.account_key}` === pos.account &&
      t.symbol === pos.symbol &&
      t.side.toLowerCase() === pos.side.toLowerCase()
    );
    if (!match) {
      divergences.push({ type: 'bybit_without_db', account: pos.account, symbol: pos.symbol, size: pos.size });
    } else {
      const diff = Math.abs(match.qty - pos.size);
      const tolerance = match.qty * 0.01;
      if (diff > tolerance) {
        const ratioVsInitial = pos.size / Math.max(match.initial_qty, 1);

        // 1. TP1 partial fill: ~50% remaining — watcher will sync. Not divergence.
        const isTp1PartialFill =
          !match.tp1_filled &&
          ratioVsInitial > 0.40 && ratioVsInitial < 0.60;

        // 2. DUST: <1% of initial qty — TP1+TP2 limit fills left rounding residue.
        // Position is de-facto closed; close it on Bybit + DB via auto-close path below.
        // We trigger auto-close by REMOVING this pos from allBybit so dbOpen loop
        // treats trade as "db_without_bybit" and pulls closedPnL.
        const isDust = ratioVsInitial < 0.01 && match.tp1_filled === true;

        if (isTp1PartialFill) {
          log.info('reconcile: expected partial-fill (TP1) — watcher will sync', {
            symbol: pos.symbol, account: pos.account,
            initial_qty: match.initial_qty, db_qty: match.qty, bybit_size: pos.size,
          });
        } else if (isDust) {
          log.info('reconcile: dust detected — closing on Bybit + auto-close DB', {
            symbol: pos.symbol, account: pos.account,
            initial_qty: match.initial_qty, bybit_size: pos.size,
            ratio: ratioVsInitial.toFixed(4),
          });
          // Close the dust on Bybit so position becomes truly 0
          try {
            const accForDust = accounts.find((a) => `${a.bucket}/${a.keyName}` === pos.account);
            if (accForDust) {
              const c = getRest(accForDust);
              const closingSide = pos.side === 'Buy' ? 'Sell' : 'Buy';
              await withRetry(() => c.submitOrder({
                category: 'linear', symbol: pos.symbol,
                side: closingSide, orderType: 'Market', qty: String(pos.size),
                timeInForce: 'IOC', reduceOnly: true,
                orderLinkId: `dust-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
              }), { label: `dust-close-${pos.symbol}-${pos.account}`, tries: 2 });
              // Mark pos as zero — db_without_bybit loop will then auto-close trade
              pos.size = 0;
            }
          } catch (e: any) {
            log.warn('dust close failed', { symbol: pos.symbol, err: e?.message });
          }
        } else {
          divergences.push({
            type: 'size_mismatch', account: pos.account, symbol: pos.symbol,
            trade_id: match.id, db_qty: match.qty, bybit_size: pos.size,
          });
        }
      }
    }
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
  const accountByLabel = new Map(accounts.map((a) => [`${a.bucket}/${a.keyName}`, a]));
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
