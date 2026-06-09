/**
 * NakedTpRecovery — detects and recovers positions that are open with SL but
 * missing TP1/TP2 reduce-only limit orders.
 *
 * Failure modes covered:
 *   - execute.ts's TpPlanner submitted but Bybit rejected silently (rare).
 *   - Older live history left some positions without TP after a partial bug.
 *   - Operator manually cancelled TP orders (we re-place them).
 *
 * Behaviour: only checks pre-TP1 positions (`!tp1AlreadyFilled`), only acts
 * when ZERO reduce-only Limit orders exist for the position's close side.
 * Splits 50/50 and re-submits both legs from DB.
 *
 * Why a class: this is a self-contained recovery procedure with its own
 * preconditions, side effects, and Telegram notification. Watcher
 * orchestrator just calls `recovery.check(pos, actions)` and moves on.
 */

import { randomUUID } from 'node:crypto';
import { withRetry, getInstrumentInfo, roundPriceToTick } from '../core/bybit';
import { splitQtyHalves } from '../core/qty-normalizer';
import { notifyAlert } from '../core/tg-templates';
import { log } from '../core/logger';
import type { AccountKey } from '../core/accounts';
import type { RestClientV5 } from 'bybit-api';

export interface NakedTpRecoveryPos {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  account: AccountKey;
  dbTP1: number | null;
  dbTP2: number | null;
  tp1AlreadyFilled: boolean;
}

export interface RecoveryAction {
  symbol: string;
  account: string;
  action: string;
  reason: string;
}

export class NakedTpRecovery {
  /**
   * Returns the recovery action taken (or null if no action). Logs and sends
   * Telegram on its own. Never throws — recovery failures are logged.
   */
  async check(
    pos: NakedTpRecoveryPos,
    client: RestClientV5,
    opts: { notify?: boolean } = {},
  ): Promise<RecoveryAction | null> {
    if (pos.tp1AlreadyFilled) return null;
    if (pos.dbTP1 == null || pos.dbTP2 == null) return null;

    // Attached position-level take-profit (set on the slot-1 entry order, see
    // execute.ts) is NOT a reduce-only Limit order — it lives in the position's
    // takeProfit field. If present, the position is protected → not naked. Skip
    // recovery to avoid placing a redundant limit TP on top (double-TP).
    try {
      const pr: any = await client.getPositionInfo({ category: 'linear', symbol: pos.symbol });
      const p = (pr.result?.list ?? []).find((x: any) => x.symbol === pos.symbol && parseFloat(x.size) > 0);
      if (p && p.takeProfit && parseFloat(p.takeProfit) > 0) return null;
    } catch { /* fall through to limit-order check below */ }

    let tpLimitCount: number;
    try {
      const ordersR = await withRetry(
        () => client.getActiveOrders({ category: 'linear', symbol: pos.symbol }),
        { label: `orders-${pos.symbol}-${pos.account.keyName}` }
      );
      const closingSide = pos.side === 'Sell' ? 'Buy' : 'Sell';
      tpLimitCount = (ordersR.result?.list ?? []).filter((o: any) =>
        o.reduceOnly === true && o.side === closingSide && o.orderType === 'Limit'
      ).length;
    } catch (e: any) {
      log.warn('naked-TP check failed', { symbol: pos.symbol, err: e?.message });
      return null;
    }

    if (tpLimitCount > 0) return null;  // TP legs present — nothing to recover

    log.error('NAKED TP DETECTED — re-placing from DB', {
      symbol: pos.symbol, account: pos.account.keyName,
      dbTP1: pos.dbTP1, dbTP2: pos.dbTP2, qty: pos.size,
    });

    const info = await getInstrumentInfo(pos.account, pos.symbol);
    const split = splitQtyHalves(pos.size, info);

    if (!split.valid) {
      log.warn('naked-TP re-place skipped: qty too small to split', {
        symbol: pos.symbol, size: pos.size,
        half: split.first.qtyNum, rem: split.rest.qtyNum,
      });
      return null;
    }

    const closingSide = pos.side === 'Sell' ? 'Buy' : 'Sell';
    const recBase = randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      await withRetry(() => client.submitOrder({
        category: 'linear', symbol: pos.symbol,
        side: closingSide, orderType: 'Limit', qty: split.first.qtyStr,
        price: roundPriceToTick(pos.dbTP1!, info),
        timeInForce: 'GTC', reduceOnly: true,
        orderLinkId: `rtp1-${recBase}`,
      }), { label: `naked-tp1-${pos.symbol}-${pos.account.keyName}`, tries: 2 });
      await withRetry(() => client.submitOrder({
        category: 'linear', symbol: pos.symbol,
        side: closingSide, orderType: 'Limit', qty: split.rest.qtyStr,
        price: roundPriceToTick(pos.dbTP2!, info),
        timeInForce: 'GTC', reduceOnly: true,
        orderLinkId: `rtp2-${recBase}`,
      }), { label: `naked-tp2-${pos.symbol}-${pos.account.keyName}`, tries: 2 });

      if (opts.notify !== false) {
        await notifyAlert({
          kind: 'reconcile_divergence',
          symbol: pos.symbol,
          detail: `${pos.symbol} ${pos.side} был БЕЗ TP1/TP2! Watcher восстановил из DB: TP1=${pos.dbTP1!.toFixed(4)}, TP2=${pos.dbTP2!.toFixed(4)}`,
          action: 'Проверь execute.ts — почему TP не выставились при open',
        });
      }

      return {
        symbol: pos.symbol,
        account: `${pos.account.bucket}/${pos.account.keyName}`,
        action: 'NAKED-TP-RECOVERED',
        reason: `re-placed TP1=${pos.dbTP1} TP2=${pos.dbTP2}`,
      };
    } catch (e: any) {
      log.error('naked-TP re-place failed', { symbol: pos.symbol, err: e?.message });
      return null;
    }
  }
}

export const nakedTpRecovery = new NakedTpRecovery();
