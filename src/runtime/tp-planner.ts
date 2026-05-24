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

import { withRetry, roundPriceToTick, roundQtyToStep, InstrumentInfo } from '../core/bybit';
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
      // Dual-TP split. Try 50/50.
      const halfRaw = args.qtyNum / 2;
      const halfStr = roundQtyToStep(halfRaw, args.instrumentInfo);
      const halfNum = parseFloat(halfStr);
      const remNum = args.qtyNum - halfNum;
      const remStr = roundQtyToStep(remNum, args.instrumentInfo);

      if (halfNum >= args.instrumentInfo.minOrderQty && parseFloat(remStr) >= args.instrumentInfo.minOrderQty) {
        const tp1Ok = await this.placeLimitLeg(args, halfStr, tp1, args.tp1LinkId, 'tp1');
        const tp2Ok = await this.placeLimitLeg(args, remStr, tp2, args.tp2LinkId, 'tp2');
        if (!tp1Ok || !tp2Ok) {
          log.error('NAKED TP — execute.ts placed entry but TP leg(s) missing; watcher will recover', {
            symbol: args.symbol, account: args.account,
            qty: args.qtyNum, tp1Failed: !tp1Ok, tp2Failed: !tp2Ok,
          });
        }
        return { mode: 'DualLimit', ok: tp1Ok || tp2Ok, legs: { tp1Ok, tp2Ok } };
      }
      // Too small to split — fall through to SingleLimit on tp1.
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
