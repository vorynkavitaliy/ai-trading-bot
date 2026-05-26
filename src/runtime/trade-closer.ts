/**
 * Trade closer — DB-update + consolidated Telegram path for full closes.
 *
 * Extracted from reconcile.ts so the sub-10s WS daemon
 * (src/runtime/position-monitor.ts) can call the same `autoCloseTrade` path
 * on a `position.size === 0` push without dragging in the whole reconcile
 * divergence scan. Reconcile imports back from here — zero behaviour change
 * on the cron 5-min path.
 */

import { AccountKey } from '../core/accounts';
import { getRest, withRetry } from '../core/bybit';
import { query } from '../core/db';
import { notifyClose } from '../core/tg-templates';
import { log } from '../core/logger';
import { OpenTrade } from '../data/trade-repo';
import { Position } from '../core/position';

export interface ClosedFill {
  symbol: string;
  side: string;
  closedSize: number;
  avgEntryPrice: number;
  avgExitPrice: number;
  closedPnl: number;
  closedTime: number;
}

export interface CloseEvent {
  trade: OpenTrade;
  exitReason: 'sl' | 'tp1' | 'tp2' | 'manual';
  exitPrice: number;
  entryPrice: number;
  pnlUsd: number;
  pnlR: number;
  qty: number;
  closedTs: number;
}

export async function fetchRecentClosedPnL(a: AccountKey, symbol: string): Promise<ClosedFill[]> {
  const c = getRest(a);
  const r = await withRetry(
    () => c.getClosedPnL({ category: 'linear', symbol, limit: 20 }),
    { label: `closed-pnl-${a.bucket}/${a.keyName}` },
  );
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

export function inferExitReason(t: OpenTrade, exitPrice: number): 'sl' | 'tp1' | 'tp2' | 'manual' {
  const isLong = t.side.toLowerCase() === 'buy' || t.side.toLowerCase() === 'long';
  const candidates: Array<{ name: 'sl' | 'tp1' | 'tp2'; price: number }> = [];
  if (t.sl != null) candidates.push({ name: 'sl', price: t.sl });
  if (t.tp1 != null) candidates.push({ name: 'tp1', price: t.tp1 });
  if (t.tp2 != null) candidates.push({ name: 'tp2', price: t.tp2 });
  if (candidates.length === 0) return 'manual';
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(exitPrice - c.price) / Math.max(c.price, 1);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  if (bestDist > 0.01) return 'manual';
  if (best.name === 'sl') {
    if (isLong && exitPrice >= (t.entry_price ?? 0)) return 'manual';
    if (!isLong && exitPrice <= (t.entry_price ?? Infinity)) return 'manual';
  }
  return best.name;
}

export async function autoCloseTrade(t: OpenTrade, fills: ClosedFill[]): Promise<CloseEvent | null> {
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

  const totalPnl = matched.reduce((s, f) => s + f.closedPnl, 0);
  const wAvgExit = matched.reduce((s, f) => s + f.avgExitPrice * f.closedSize, 0) / totalClosedSize;
  const wAvgEntry = matched.reduce((s, f) => s + f.avgEntryPrice * f.closedSize, 0) / totalClosedSize;
  const lastTs = matched[matched.length - 1].closedTime;

  const exitReason = inferExitReason(t, wAvgExit);
  const pnlR = Position.fromOpenTrade(t).riskUnits(totalPnl);

  const res = await query(
    `UPDATE trades SET status = 'closed',
       exit_price = $1, closed_at = to_timestamp($2 / 1000.0),
       realized_r = $3, pnl_usd = $4, exit_reason = $5
     WHERE id = $6 AND status = 'open'`,
    [wAvgExit, lastTs, pnlR, totalPnl, exitReason, t.id],
  );
  if (res.rowCount === 0) {
    log.info('autoCloseTrade lost race — already closed', { id: t.id, symbol: t.symbol });
    return null;
  }

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

/**
 * Group closes by (symbol, side, exitReason) and send ONE consolidated
 * Telegram per group. Used by both reconcile (batch on each 5-min sweep)
 * and the WS daemon (single close per WS event).
 */
export async function notifyConsolidatedCloses(events: CloseEvent[]): Promise<void> {
  if (events.length === 0) return;
  const groups = new Map<string, CloseEvent[]>();
  for (const e of events) {
    const key = `${e.trade.symbol}|${e.trade.side}|${e.exitReason}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  for (const [, group] of groups) {
    const first = group[0];
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
