/**
 * TpPlanner — places take-profit orders for a freshly opened position.
 *
 * Three placement modes, picked deterministically from the args + instrument
 * info. The selection logic lives here so execute.ts:placeOnAccount doesn't
 * carry 100 lines of branching:
 *
 *   - DualLimit: tp1 != tp2 and position big enough to split 50/50 → two
 *     reduce-only LIMIT orders. Each fills independently at maker fee.
 *   - SingleLimit: tp1 == tp2 (CG-fade pattern) OR position too small to
 *     split → one reduce-only LIMIT for the full qty.
 *   - NativeTpFallback: SingleLimit submission failed (Bybit reject) → fall
 *     back to setTradingStop. Worse fill (market on trigger) but guarantees
 *     the position has SOME tp leg, so position-watcher can detect & recover.
 *
 * Why a class: the three modes share order construction, retry semantics,
 * logging, and "what to do on failure". Pulling them into one object makes
 * the choice explicit and the recovery path single.
 */

import { withRetry, roundPriceToTick, InstrumentInfo, getRest, getInstrumentInfo } from '../core/bybit';
import { splitQtyHalves, normalizeQty } from '../core/qty-normalizer';
import { AccountKey } from '../core/accounts';
import { PromotablePending } from '../core/pending-orders';
import { log } from '../core/logger';
import type { RestClientV5 } from 'bybit-api';

export interface TpPlanArgs {
  client: RestClientV5;
  symbol: string;
  account: string;           // for logging: bucket/keyName
  closeSide: 'Buy' | 'Sell';  // opposite of entry side
  qtyStr: string;             // total position qty (already rounded)
  qtyNum: number;
  tp1: number | null;
  tp2: number | null;
  tp1LinkId: string;
  tp2LinkId: string;
  instrumentInfo: InstrumentInfo;
}

export interface TpPlanResult {
  mode: 'DualLimit' | 'SingleLimit' | 'NativeTpFallback' | 'NoTp';
  /** True if at least one TP leg was placed successfully. */
  ok: boolean;
  /** Per-leg breakdown for DualLimit (tp1 + tp2). For Single*, just .tp1. */
  legs: { tp1Ok: boolean; tp2Ok: boolean };
}

export class TpPlanner {
  /** Plan and place TP orders. Idempotent on failure (logs naked-tp warning, never throws). */
  async place(args: TpPlanArgs): Promise<TpPlanResult> {
    const { tp1, tp2 } = args;
    if (tp1 == null) {
      return { mode: 'NoTp', ok: false, legs: { tp1Ok: false, tp2Ok: false } };
    }

    const tpEqual = tp2 != null && Math.abs(tp1 - tp2) < (args.instrumentInfo.tickSize || 0.0001);

    if (tp2 != null && !tpEqual) {
      const split = splitQtyHalves(args.qtyNum, args.instrumentInfo);

      if (split.valid) {
        const tp1Ok = await this.placeLimitLeg(args, split.first.qtyStr, tp1, args.tp1LinkId, 'tp1');
        const tp2Ok = await this.placeLimitLeg(args, split.rest.qtyStr, tp2, args.tp2LinkId, 'tp2');
        if (!tp1Ok || !tp2Ok) {
          log.error('NAKED TP — execute.ts placed entry but TP leg(s) missing; watcher will recover', {
            symbol: args.symbol, account: args.account,
            qty: args.qtyNum, tp1Failed: !tp1Ok, tp2Failed: !tp2Ok,
          });
        }
        return { mode: 'DualLimit', ok: tp1Ok || tp2Ok, legs: { tp1Ok, tp2Ok } };
      }
    }

    // Single full-size limit at tp1 (covers tpEqual case AND tp2-missing case).
    const singleOk = await this.placeLimitLeg(args, args.qtyStr, tp1, args.tp1LinkId, 'single-tp');
    if (singleOk) {
      return { mode: 'SingleLimit', ok: true, legs: { tp1Ok: true, tp2Ok: false } };
    }

    // Fallback: native takeProfit via setTradingStop (market on trigger).
    await this.placeNativeTp(args, tp1);
    return { mode: 'NativeTpFallback', ok: false, legs: { tp1Ok: false, tp2Ok: false } };
  }

  private async placeLimitLeg(
    args: TpPlanArgs,
    qtyStr: string,
    price: number,
    linkId: string,
    label: string,
  ): Promise<boolean> {
    try {
      const r = await withRetry(() => args.client.submitOrder({
        category: 'linear', symbol: args.symbol,
        side: args.closeSide, orderType: 'Limit', qty: qtyStr,
        price: roundPriceToTick(price, args.instrumentInfo),
        timeInForce: 'GTC', reduceOnly: true,
        orderLinkId: linkId,
      }), { label: `${label}-${args.symbol}-${args.account}`, tries: 3 });
      if (r.retCode === 0) return true;
      // Duplicate orderLinkId = THIS exact TP already exists (the daemon's
      // armTpAfterPromotion and execute's inline placement race on fast fills, both
      // deriving the same tp1-/tp2-<linkBase>). The position is protected — treat
      // as success so the loser does NOT stack a native trading-stop on top
      // (double exit + taker economics, found by the 2026-06-11 Phase 2 audit).
      if (r.retCode === 110072 || /duplicate/i.test(r.retMsg ?? '')) {
        log.info(`${label}: orderLinkId already used — TP placed by the racing path, treating as success`, {
          symbol: args.symbol, account: args.account, linkId,
        });
        return true;
      }
      log.error(`${label.toUpperCase()} SUBMIT REJECTED`, {
        symbol: args.symbol, account: args.account,
        retCode: r.retCode, retMsg: r.retMsg, qty: qtyStr, price,
      });
      return false;
    } catch (e: any) {
      log.error(`${label.toUpperCase()} SUBMIT THREW`, {
        symbol: args.symbol, account: args.account,
        err: e?.message ?? String(e), qty: qtyStr, price,
      });
      return false;
    }
  }

  private async placeNativeTp(args: TpPlanArgs, tp1: number): Promise<void> {
    try {
      await args.client.setTradingStop({
        category: 'linear', symbol: args.symbol,
        takeProfit: roundPriceToTick(tp1, args.instrumentInfo),
        tpTriggerBy: 'LastPrice', positionIdx: 0,
      });
    } catch (e: any) {
      log.warn('setTradingStop fallback failed', { err: e?.message });
    }
  }
}

/** Module-default planner instance. */
export const tpPlanner = new TpPlanner();

/**
 * Arm the TP for a position credited from a RESTING limit fill (Phase 2).
 *
 * execute.ts skips TP placement for pendingOnly resting limits (no position yet —
 * a reduce-only order would be rejected). Whichever promotion path materializes the
 * trades row (daemon ≤1s, reconcile ≤5min catch-net) calls this right after
 * `created:true` to place the maker reduce-only TP for the ACTUAL credited size.
 * Reuses the entry's linkBase so tp1-/tp2- legs correlate in reconcile/logs — safe
 * because execute never consumed those linkIds on the deferred path. Never throws;
 * a failure leaves the position TP-less and naked-tp-recovery picks it up (it
 * checks existing reduce-only orders, so no stacking).
 */
export async function armTpAfterPromotion(
  account: AccountKey,
  pending: PromotablePending,
  creditedSize: number,
): Promise<void> {
  try {
    if (pending.tp1 == null || creditedSize <= 0) return;
    const client = getRest(account);
    // Fast-fill race guard: on market entries and marketable-at-placement limits
    // the daemon promotes ~1s after fill while execute's inline tpPlanner.place is
    // still inside its 5s poll. If a reduce-only close-side order already exists,
    // the TP is owned by the other path — skip (duplicate-linkId handling in
    // placeLimitLeg is the second layer of this guard).
    const closeSide = pending.side === 'Buy' ? 'Sell' : 'Buy';
    try {
      const ao: any = await withRetry(
        () => client.getActiveOrders({ category: 'linear', symbol: pending.symbol }),
        { label: `armtp-precheck-${pending.symbol}-${account.keyName}` },
      );
      const existingTp = (ao.result?.list ?? []).some(
        (o: any) => o.reduceOnly === true && o.side === closeSide && o.orderType === 'Limit',
      );
      if (existingTp) {
        log.info('armTpAfterPromotion: reduce-only TP already present — skipping', {
          symbol: pending.symbol, account: account.keyName,
        });
        return;
      }
    } catch {
      // Pre-check is best-effort; the duplicate-linkId success path covers the race.
    }
    const info = await getInstrumentInfo(account, pending.symbol);
    const { qtyStr, qtyNum, valid } = normalizeQty(creditedSize, info);
    if (!valid) {
      log.error('armTpAfterPromotion: credited size below instrument minimum — TP not placed', {
        symbol: pending.symbol, account: account.keyName, creditedSize,
      });
      return;
    }
    const linkBase = pending.orderLinkId.replace(/^e-/, '');
    await tpPlanner.place({
      client,
      symbol: pending.symbol,
      account: `${account.bucket}/${account.keyName}`,
      closeSide: pending.side === 'Buy' ? 'Sell' : 'Buy',
      qtyStr,
      qtyNum,
      tp1: pending.tp1,
      tp2: pending.tp2,
      tp1LinkId: `tp1-${linkBase}`,
      tp2LinkId: `tp2-${linkBase}`,
      instrumentInfo: info,
    });
  } catch (e: any) {
    log.error('armTpAfterPromotion failed — naked-tp-recovery will pick this up', {
      symbol: pending.symbol, account: account.keyName, err: e?.message ?? String(e),
    });
  }
}
