/**
 * Position event handlers — extracted from position-watcher.ts so the new
 * sub-second WS daemon (src/runtime/position-monitor.ts) and the legacy
 * 5-min cron entry can share the same TP1 / naked-SL / DCA logic.
 *
 * Top half: pure detectors (no IO, fully testable).
 * Bottom half: side-effect handlers (REST + DB + Telegram) that the daemon
 * dispatches from WS events and the cron shim calls in batch.
 *
 * History: Position-watcher.ts originally owned all this logic inline. Splitting
 * it lets WS events trigger reactions in ≤1s while keeping the cron path
 * unchanged during the 24-48h overlap migration (see TASK-006.analysis.md).
 */

import { randomUUID } from 'node:crypto';
import { AccountKey } from '../core/accounts';
import { getRest, getInstrumentInfo, roundPriceToTick, roundQtyToStep, withRetry } from '../core/bybit';
import { closeAndVerify } from '../core/close-verifier';
import { query } from '../core/db';
import { notifyAlert, notifyClose, notifyDcaFill } from '../core/tg-templates';
import { log } from '../core/logger';
import { Position } from '../core/position';

export interface BybitPos {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  initialSize: number;
  entryPrice: number;
  curSL: number;
  curTP: number | null;
  unrealisedPnl: number;
  positionValue: number;
  createdTime: number;
  account: AccountKey;
  dbTradeId: number;
  dbInitialSL: number;
  dbTP1: number | null;
  dbTP2: number | null;
  dbInitialQty: number;
  dbCurrentQty: number;
  tp1AlreadyFilled: boolean;
}

export interface RecoveryAction {
  symbol: string;
  account: string;
  action: string;
  reason: string;
}

export interface Tp1FillAccountFill {
  label: string;
  qty: number;
  pnlUsd: number;
  pnlR: number;
}

export interface Tp1FillGroup {
  symbol: string;
  side: 'Buy' | 'Sell';
  entryPrice: number;
  exitPrice: number;
  fills: Tp1FillAccountFill[];
}

/**
 * Pure: did the position's current size cross the TP1-partial threshold?
 * Same encapsulation as Position.attachBybitSize() — expressed as a predicate
 * the daemon can call on every WS push and the cron shim per-cycle.
 *
 * `prevSize` is informational only (daemon supplies it; cron passes
 * initialSize). The actual decision uses Position.attachBybitSize semantics:
 * size > 0 AND size < initial × 0.6 AND tp1 not yet flagged.
 */
export function isTp1PartialFromPosition(
  _prevSize: number,
  nextSize: number,
  dbInitialQty: number,
  dbCurrentQty: number,
  tp1Already: boolean,
): boolean {
  if (tp1Already) return false;
  if (dbInitialQty <= 0) return false;
  if (nextSize <= dbInitialQty * 0.05) return false;
  const p = Position.fromOpenTrade({
    id: 0,
    account_bucket: '',
    account_key: '',
    symbol: '',
    side: 'Buy',
    qty: dbCurrentQty,
    initial_qty: dbInitialQty,
    entry_price: 0,
    sl: 0,
    tp1: null,
    tp2: null,
    opened_at: new Date().toISOString(),
    tp1_filled: tp1Already,
  });
  p.attachBybitSize(nextSize);
  return p.isTp1Filled();
}

/**
 * Side-effect: fetch Bybit closedPnL records for this symbol since the position
 * opened, sum reduce-side fills, fall back to analytical compute (dbTP1 × delta)
 * when Bybit returns empty (observed 30-90s replication delay on some accounts).
 */
export async function inferTp1Fill(
  account: AccountKey,
  symbol: string,
  prevSize: number,
  newSize: number,
  dbTP1: number | null,
  dbEntry: number,
  dbSide: 'Buy' | 'Sell',
  openedTs: number,
): Promise<{ filledQty: number; realizedPnl: number; exitPrice: number }> {
  const c = getRest(account);
  const closedPnlR = await withRetry(
    () => c.getClosedPnL({ category: 'linear', symbol, limit: 50 }),
    { label: `closed-pnl-tp1-${symbol}-${account.keyName}` },
  );
  const closingSide = dbSide === 'Sell' ? 'Buy' : 'Sell';
  const fills = (closedPnlR.result?.list ?? [])
    .filter((x: any) => x.side === closingSide && parseInt(x.updatedTime, 10) >= openedTs);

  let filledQty = fills.reduce((s: number, f: any) => s + parseFloat(f.closedSize), 0);
  let realizedPnl = fills.reduce((s: number, f: any) => s + parseFloat(f.closedPnl), 0);
  let exitPrice = fills.length > 0 ? parseFloat(fills[0].avgExitPrice) : dbTP1 ?? dbEntry;

  if (filledQty === 0 || realizedPnl === 0) {
    const inferredFillQty = prevSize - newSize;
    if (inferredFillQty > 0 && dbTP1 != null) {
      filledQty = inferredFillQty;
      const direction = dbSide === 'Sell' ? -1 : 1;
      realizedPnl = (dbTP1 - dbEntry) * inferredFillQty * direction;
      exitPrice = dbTP1;
      log.warn('TP1 fill: closedPnL empty, computed analytically', {
        symbol, account: account.keyName,
        inferredQty: filledQty, computedPnl: realizedPnl,
      });
    }
  }

  return { filledQty, realizedPnl, exitPrice };
}

/**
 * Side-effect: persist TP1 fill to DB and accumulate into a per-(symbol,side)
 * group so notifyClose fires once across multiple accounts.
 *
 * DB UPDATE re-reads tp1_filled_at = NULL via WHERE clause — multiple paths
 * (WS daemon, cron shim) racing on the same fill produce one DB write.
 */
export async function handleTp1Fill(
  pos: BybitPos,
  fill: { filledQty: number; realizedPnl: number; exitPrice: number },
  tp1Groups: Map<string, Tp1FillGroup>,
): Promise<RecoveryAction> {
  const accountLabel = `${pos.account.bucket}/${pos.account.keyName}`;

  await query(
    `UPDATE trades SET qty = $1, tp1_filled_at = NOW(), tp1_filled_qty = $2, tp1_realized_pnl_usd = $3
     WHERE id = $4 AND tp1_filled_at IS NULL`,
    [pos.size, fill.filledQty, fill.realizedPnl, pos.dbTradeId],
  );

  const key = `${pos.symbol}-${pos.side}`;
  const grp = tp1Groups.get(key) ?? {
    symbol: pos.symbol,
    side: pos.side,
    entryPrice: pos.entryPrice,
    exitPrice: fill.exitPrice,
    fills: [],
  };
  grp.fills.push({
    label: accountLabel,
    qty: fill.filledQty,
    pnlUsd: fill.realizedPnl,
    pnlR: Position.riskUnitsFromRaw({
      entryPrice: pos.entryPrice,
      sl: pos.dbInitialSL,
      initialQty: pos.dbInitialQty,
      pnlUsd: fill.realizedPnl,
    }),
  });
  tp1Groups.set(key, grp);

  log.info('TP1 fill processed', {
    symbol: pos.symbol,
    account: pos.account.keyName,
    filledQty: fill.filledQty,
    realizedPnl: fill.realizedPnl,
    remainingSize: pos.size,
  });

  return {
    symbol: pos.symbol,
    account: accountLabel,
    action: 'TP1-FILL',
    reason: `qty=${fill.filledQty.toFixed(4)} pnl=$${fill.realizedPnl.toFixed(2)} → SL@BE`,
  };
}

/**
 * Send ONE consolidated Telegram message per group, drop the map. Caller
 * accumulates with handleTp1Fill, calls this at the end of a cycle / WS batch.
 */
export async function flushTp1Groups(tp1Groups: Map<string, Tp1FillGroup>): Promise<void> {
  for (const grp of tp1Groups.values()) {
    try {
      const totalPnl = grp.fills.reduce((s, f) => s + f.pnlUsd, 0);
      const totalR = grp.fills.reduce((s, f) => s + f.pnlR, 0) / Math.max(grp.fills.length, 1);
      await notifyClose({
        symbol: grp.symbol,
        side: grp.side === 'Buy' ? 'buy' : 'sell',
        exitReason: 'tp1',
        entryPrice: grp.entryPrice,
        exitPrice: grp.exitPrice,
        pnlUsd: totalPnl,
        pnlR: totalR,
        accountFills: grp.fills,
        comment: 'TP1 отработал. SL переведён в безубыток (BE). Остаток позиции 50% едет к TP2 без риска.',
      });
      log.info('TP1 fill TG sent', { symbol: grp.symbol, accounts: grp.fills.length, totalPnl });
    } catch (e: any) {
      log.error('TP1 fill TG send failed', { symbol: grp.symbol, err: e.message });
    }
  }
  tp1Groups.clear();
}

async function moveStopLoss(pos: BybitPos, newSL: number, reason: string): Promise<void> {
  const c = getRest(pos.account);
  const info = await getInstrumentInfo(pos.account, pos.symbol);
  const slStr = roundPriceToTick(newSL, info);
  const r = await withRetry(
    () => c.setTradingStop({
      category: 'linear',
      symbol: pos.symbol,
      stopLoss: slStr,
      slTriggerBy: 'LastPrice',
      positionIdx: 0,
    }),
    { label: `move-sl-${pos.symbol}-${pos.account.keyName}` },
  );
  if (r.retCode !== 0) throw new Error(`setTradingStop retCode=${r.retCode} ${r.retMsg}`);
  log.info('SL moved', {
    symbol: pos.symbol, account: pos.account.keyName,
    from: pos.curSL, to: parseFloat(slStr), reason,
  });
}

/**
 * Side-effect: position has size > 0 but Bybit-side stopLoss == 0. Try to amend
 * SL from the DB-recorded original; if amend fails, force-close via
 * closeAndVerify (TASK-005 helper).
 *
 * Returns the action taken so the caller can log/append to a cycle summary.
 */
export async function handleNakedSl(pos: BybitPos): Promise<RecoveryAction[]> {
  const accountLabel = `${pos.account.bucket}/${pos.account.keyName}`;
  const actions: RecoveryAction[] = [];

  log.error('NAKED POSITION DETECTED — emergency SL set', {
    symbol: pos.symbol, account: pos.account.keyName,
    size: pos.size, dbSL: pos.dbInitialSL,
  });

  try {
    await moveStopLoss(pos, pos.dbInitialSL, 'EMERGENCY: position had no SL');
    actions.push({
      symbol: pos.symbol,
      account: accountLabel,
      action: 'EMERGENCY-SL-SET',
      reason: 'naked position detected',
    });
    await notifyAlert({
      kind: 'reconcile_divergence',
      symbol: pos.symbol,
      detail: `${pos.symbol} ${pos.side} был БЕЗ стоп-лосса! Установлен SL=${pos.dbInitialSL.toFixed(4)} (из DB).`,
      action: 'Проверь Bybit — почему SL не сохранился при open. Возможен баг в execute.ts',
    });
    return actions;
  } catch (slErr: any) {
    log.error('EMERGENCY SL set FAILED — falling back to force close', { err: slErr?.message });
    try {
      const closeResult = await closeAndVerify(pos.account, pos.symbol, {
        reason: 'naked-no-SL-fallback',
        cancelOrders: false,
      });
      if (closeResult.status === 'ok') {
        actions.push({
          symbol: pos.symbol,
          account: accountLabel,
          action: 'EMERGENCY-CLOSE',
          reason: 'naked + SL set rejected → force-closed',
        });
        await notifyAlert({
          kind: 'reconcile_divergence',
          symbol: pos.symbol,
          detail: `${pos.symbol} ${pos.side} был БЕЗ SL и SL не удалось установить — экстренно закрыта по рынку. finalSize=${closeResult.finalSize}.`,
          action: 'Проверь execute.ts и Bybit лог — почему SL не привязался при open.',
        });
      } else if (closeResult.status === 'dust_below_min') {
        await notifyAlert({
          kind: 'reconcile_divergence',
          symbol: pos.symbol,
          detail: `${pos.symbol} ${pos.side} БЕЗ SL, остаток < min notional (size=${closeResult.finalSize}). Bybit не принимает reduce-only Market. Риск < $5, мониторим.`,
          action: 'Ручное закрытие через UI, либо подожди дрейф до SL/ликвидации.',
        });
      } else {
        throw new Error(`closeAndVerify status=${closeResult.status} finalSize=${closeResult.finalSize}`);
      }
    } catch (closeErr: any) {
      log.error('EMERGENCY close ALSO FAILED', { err: closeErr?.message });
      await notifyAlert({
        kind: 'reconcile_divergence',
        symbol: pos.symbol,
        detail: `🆘 КРИТИЧНО: ${pos.symbol} БЕЗ SL и не получилось ни установить SL, ни закрыть по рынку. Закрой вручную.`,
        action: 'Закрой позицию через Bybit UI немедленно. SL fail: ' + (slErr?.message ?? '') + ' | Close fail: ' + (closeErr?.message ?? ''),
      });
    }
    return actions;
  }
}

/**
 * Side-effect: Bybit size grew vs DB initial_qty — a DCA scaled-in slot
 * filled retroactively. Update DB qty, re-place TP order at full size, notify.
 */
export async function handleDcaFill(pos: BybitPos): Promise<RecoveryAction | null> {
  const accLabel = `${pos.account.bucket}/${pos.account.keyName}`;
  const delta = pos.size - pos.dbInitialQty;

  log.info('DCA fill detected', {
    symbol: pos.symbol,
    account: accLabel,
    prevSize: pos.dbInitialQty,
    newSize: pos.size,
    delta,
  });

  try {
    await query(`UPDATE trades SET qty = $1, initial_qty = $1 WHERE id = $2`, [pos.size, pos.dbTradeId]);
  } catch (e: any) {
    log.warn('DCA fill — DB update failed', { err: e?.message });
  }

  try {
    const cli = getRest(pos.account);
    const closingSide = pos.side === 'Sell' ? 'Buy' : 'Sell';
    const ordersR: any = await withRetry(
      () => cli.getActiveOrders({ category: 'linear', symbol: pos.symbol }),
      { label: `reTP-getOrders-${accLabel}` },
    );
    const oldTps = (ordersR.result?.list ?? []).filter(
      (o: any) => o.reduceOnly === true && o.side === closingSide && o.orderType === 'Limit',
    );
    for (const tp of oldTps) {
      await withRetry(
        () => cli.cancelOrder({ category: 'linear', symbol: pos.symbol, orderId: tp.orderId }),
        { label: `reTP-cancel-${tp.orderLinkId}` },
      );
    }
    const tpPrice = pos.dbTP1;
    if (tpPrice != null) {
      const info = await getInstrumentInfo(pos.account, pos.symbol);
      const qtyStr = roundQtyToStep(pos.size, info);
      const newLink = `rtp-dca-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await withRetry(
        () => cli.submitOrder({
          category: 'linear',
          symbol: pos.symbol,
          side: closingSide,
          orderType: 'Limit',
          qty: qtyStr,
          price: roundPriceToTick(tpPrice, info),
          timeInForce: 'GTC',
          reduceOnly: true,
          orderLinkId: newLink,
        }),
        { label: `reTP-place-${accLabel}` },
      );
      log.info('TP re-placed for full DCA-deployed position', {
        symbol: pos.symbol, account: accLabel, newQty: pos.size, tpPrice,
      });
    }
  } catch (e: any) {
    log.warn('DCA fill — TP re-place failed', { err: e?.message });
  }

  try {
    await notifyDcaFill({
      symbol: pos.symbol,
      side: pos.side.toLowerCase() === 'buy' ? 'buy' : 'sell',
      prevSize: pos.dbInitialQty,
      newSize: pos.size,
      newAvgPrice: pos.entryPrice,
      sl: pos.curSL,
      tp: pos.curTP,
      accountSummaries: [
        `${accLabel} — ${pos.dbInitialQty.toFixed(2)} → ${pos.size.toFixed(2)} ${pos.symbol.replace(/USDT$/, '')}  (+${delta.toFixed(2)})`,
      ],
    });
  } catch (e: any) {
    log.warn('DCA fill — telegram failed', { err: e?.message });
  }

  return {
    symbol: pos.symbol,
    account: accLabel,
    action: 'DCA-FILL-DETECTED',
    reason: `size grew ${pos.dbInitialQty}→${pos.size}; TP re-placed`,
  };
}
