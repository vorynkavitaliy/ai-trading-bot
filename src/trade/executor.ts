import { BybitClient } from '../core/bybit-client';
import { SubAccount } from '../core/types';
import { TradePlan, fmtPrice, InstrumentSpec } from './types';
import { sizePosition, SizingResult } from '../risk/sizing';
import { RiskEngine } from '../risk/engine';
import { TelegramNotifier } from '../notifications/telegram';
import { TradeRepo, AuditRepo } from '../db/repositories';
import { cache } from '../cache';
import { Signal } from '../signal/types';
import { config } from '../config';
import { randomUUID } from 'crypto';

export interface ExecuteContext {
  bybit: BybitClient;
  risk: RiskEngine;
  telegram?: TelegramNotifier;
  instrument: InstrumentSpec;
  signal: Signal;
  plan: TradePlan;
  regimeLabel: string;
  /** News-based risk multiplier: 1.0 = normal, <1.0 = reduce size */
  newsRiskMultiplier?: number;
  /**
   * Explicit risk percentage chosen by Claude (Claude-driven mode).
   * Overrides automatic `confluence >= 7 → maxRiskPct` heuristic.
   * Still hard-capped at 3% by HyroTrader rules.
   */
  explicitRiskPct?: number;
  /** Short Claude rationale — stored in audit log + signal meta */
  rationale?: string;
}

export interface ExecutionReport {
  account: string;
  success: boolean;
  orderId?: string;
  qty: number;
  /** Formatted qty per instrument precision — use for display, not for math. */
  qtyString?: string;
  riskUsd: number;
  reason?: string;
}

/**
 * Execute the same plan across ALL sub-accounts in parallel.
 * Per-account: risk-gate → size → submit market order with SL/TP.
 *
 * Idempotency: orderLinkId = `<symbol>-<dir>-<ts>` — Bybit will reject duplicates.
 */
export async function executeAcrossAccounts(ctx: ExecuteContext): Promise<ExecutionReport[]> {
  const subs = ctx.bybit.getAllSubAccounts();
  const ts = Date.now();
  const baseLink = `${ctx.plan.symbol}-${ctx.plan.direction[0]}-${ts}-${randomUUID().slice(0, 6)}`;

  const reports = await Promise.all(subs.map(async (sub): Promise<ExecutionReport> => {
    try {
      // 1. Risk gate (uses initial balance for risk_usd calc)
      // Hard cap: per HyroTrader no single trade may risk more than 3% of balance.
      const HARD_CAP = 3.0;
      const newsAdj = ctx.newsRiskMultiplier ?? 1.0;
      // Claude-driven path: explicit risk_pct from Claude (12-factor rubric).
      // Legacy path: confluence >= 7 → maxRiskPct (A+).
      const baseRisk = ctx.explicitRiskPct !== undefined
        ? ctx.explicitRiskPct
        : (ctx.signal.confluence >= 7 ? config.trade.maxRiskPct : config.trade.defaultRiskPct);
      const isAplus = baseRisk >= config.trade.maxRiskPct;
      const riskPct = Math.min(baseRisk * newsAdj, HARD_CAP);
      const riskUsd = sub.volume * (riskPct / 100);
      const gate = await ctx.risk.canEnter(sub, riskUsd, { isAplus });
      if (!gate.ok) {
        return { account: sub.label, success: false, qty: 0, riskUsd: 0, reason: gate.reason };
      }

      // 2. Size
      let sizing: SizingResult;
      try {
        sizing = sizePosition({
          initialBalance: sub.volume,
          riskPct,
          hardRiskCapPct: HARD_CAP,
          entry: ctx.plan.entry,
          stopLoss: ctx.plan.stopLoss,
          qtyStep: ctx.instrument.qtyStep,
          minQty: ctx.instrument.minQty,
          maxQty: ctx.instrument.maxQty,
        });
      } catch (e: any) {
        return { account: sub.label, success: false, qty: 0, riskUsd: 0, reason: `sizing: ${e.message}` };
      }
      if (sizing.qty <= 0) {
        return { account: sub.label, success: false, qty: 0, riskUsd: 0, reason: 'qty below min' };
      }

      // 3. Enforce leverage (clamped to instrument maximum). Idempotent — Bybit returns
      //    retCode 110043 if leverage already matches; we swallow that.
      const targetLev = String(Math.min(config.trade.leverage, ctx.instrument.maxLeverage));
      try {
        await sub.client.setLeverage({
          category: 'linear',
          symbol: ctx.plan.symbol,
          buyLeverage: targetLev,
          sellLeverage: targetLev,
        });
      } catch (err: any) {
        if (!String(err?.message ?? '').includes('110043')) {
          console.warn(`[Executor] setLeverage ${sub.label} ${ctx.plan.symbol}: ${err.message}`);
        }
      }

      // 4. Submit — limit at OB level when available, otherwise market
      const orderLinkId = `${baseLink}-${sub.index}`;
      const side = ctx.plan.direction === 'Long' ? 'Buy' : 'Sell';
      const useLimit = !!ctx.plan.limitEntry;
      const tick = ctx.instrument.tickSize;

      const orderParams: any = {
        category: 'linear',
        symbol: ctx.plan.symbol,
        side,
        orderType: useLimit ? 'Limit' : 'Market',
        qty: sizing.qtyString,
        stopLoss: fmtPrice(ctx.plan.stopLoss, tick),
        takeProfit: fmtPrice(ctx.plan.takeProfit, tick),
        tpslMode: 'Full',
        timeInForce: useLimit ? 'GTC' : 'IOC',
        orderLinkId,
      };
      if (useLimit) {
        orderParams.price = fmtPrice(ctx.plan.limitEntry!, tick);
      }

      const res = await sub.client.submitOrder(orderParams);

      if (res.retCode !== 0) {
        await AuditRepo.log({
          level: 'error', source: 'executor', event: 'order_failed',
          accountLabel: sub.label, symbol: ctx.plan.symbol,
          message: res.retMsg, payload: { plan: ctx.plan, sizing, retCode: res.retCode },
        });
        return { account: sub.label, success: false, qty: sizing.qty, riskUsd: sizing.riskUsd, reason: res.retMsg };
      }

      // 4. Persist trade + heat
      const tradeId = await TradeRepo.insert({
        accountLabel: sub.label,
        accountVolume: sub.volume,
        symbol: ctx.plan.symbol,
        direction: ctx.plan.direction,
        entryPrice: ctx.plan.entry,
        qty: sizing.qty,
        stopLoss: ctx.plan.stopLoss,
        takeProfit: ctx.plan.takeProfit,
        rr: ctx.plan.rr,
        riskPct,
        riskUsd: sizing.riskUsd,
        confluence: ctx.signal.confluence,
        regime: ctx.regimeLabel,
        orderId: res.result?.orderId,
        orderLinkId,
        meta: { plan: ctx.plan, scores: { long: ctx.signal.long, short: ctx.signal.short } },
      });
      await cache.setHeat(sub.label, ctx.plan.symbol, sizing.riskUsd);

      await AuditRepo.log({
        level: 'info', source: 'executor', event: 'order_placed',
        accountLabel: sub.label, symbol: ctx.plan.symbol,
        message: `${ctx.plan.direction} ${sizing.qtyString} @ ${ctx.plan.entry}`,
        payload: { tradeId, orderId: res.result?.orderId },
      });

      return { account: sub.label, success: true, orderId: res.result?.orderId, qty: sizing.qty, qtyString: sizing.qtyString, riskUsd: sizing.riskUsd };
    } catch (err: any) {
      await AuditRepo.log({
        level: 'error', source: 'executor', event: 'order_exception',
        accountLabel: sub.label, symbol: ctx.plan.symbol,
        message: err.message ?? String(err),
      });
      return { account: sub.label, success: false, qty: 0, riskUsd: 0, reason: err.message ?? String(err) };
    }
  }));

  // Telegram + audit log (single message regardless of account count).
  // v2: signal audit rolled into AuditRepo.log calls above; SignalRepo dropped.
  const succeeded = reports.filter((r) => r.success);

  // Register pending limit orders for monitoring (cancel if stale)
  if (ctx.plan.limitEntry && succeeded.length > 0) {
    await cache.registerPendingOrder(ctx.plan.symbol, {
      symbol: ctx.plan.symbol,
      direction: ctx.plan.direction,
      limitPrice: ctx.plan.limitEntry,
      stopLoss: ctx.plan.stopLoss,
      takeProfit: ctx.plan.takeProfit,
      confluence: ctx.signal.confluence,
      regime: ctx.regimeLabel,
      placedAt: Date.now(),
      maxAge: 45 * 60_000, // 45 min — if not filled, structure likely invalidated
      orderIds: succeeded.map((r) => r.orderId).filter(Boolean) as string[],
    });
  }

  if (ctx.telegram && succeeded.length > 0) {
    const totalRisk = succeeded.reduce((s, r) => s + r.riskUsd, 0);
    if (ctx.plan.limitEntry) {
      // Limit placed by Claude — Claude sends its own human-language TG via send-tg.ts.
      // No boilerplate here (would be a duplicate). Real "tradeOpened" still fires on fill.
    } else {
      // Market order — fill is immediate, position is real.
      await ctx.telegram.tradeOpened({
        pair: ctx.plan.symbol,
        direction: ctx.plan.direction === 'Long' ? 'LONG' : 'SHORT',
        entry: fmtPrice(ctx.plan.entry, ctx.instrument.tickSize),
        sl: fmtPrice(ctx.plan.stopLoss, ctx.instrument.tickSize),
        tp: fmtPrice(ctx.plan.takeProfit, ctx.instrument.tickSize),
        rr: ctx.plan.rr.toFixed(2),
        riskPct: (ctx.signal.confluence >= 7 ? config.trade.maxRiskPct : config.trade.defaultRiskPct).toFixed(2),
        riskUsd: totalRisk.toFixed(2),
        qty: succeeded.map((r) => r.qtyString ?? r.qty.toFixed(4)).join(' / '),
        confluence: `${ctx.signal.confluence}/8`,
        regime: ctx.regimeLabel,
        accounts: succeeded.length,
      });
    }
  }

  return reports;
}
