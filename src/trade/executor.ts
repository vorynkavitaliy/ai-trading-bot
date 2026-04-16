import { BybitClient } from '../core/bybit-client';
import { SubAccount } from '../core/types';
import { TradePlan, fmtPrice } from './planner';
import { sizePosition, SizingResult } from '../risk/sizing';
import { RiskEngine } from '../risk/engine';
import { TelegramNotifier } from '../notifications/telegram';
import { TradeRepo, AuditRepo, SignalRepo } from '../db/repositories';
import { cache } from '../cache';
import { Signal } from '../signal/generator';
import { config } from '../config';
import { InstrumentSpec } from './planner';
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
}

export interface ExecutionReport {
  account: string;
  success: boolean;
  orderId?: string;
  qty: number;
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
      const isAplus = ctx.signal.confluence >= 4;
      const baseRisk = isAplus ? config.trade.maxRiskPct : config.trade.defaultRiskPct;
      const newsAdj = ctx.newsRiskMultiplier ?? 1.0;
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

      // 4. Submit
      const orderLinkId = `${baseLink}-${sub.index}`;
      const side = ctx.plan.direction === 'Long' ? 'Buy' : 'Sell';

      const res = await sub.client.submitOrder({
        category: 'linear',
        symbol: ctx.plan.symbol,
        side,
        orderType: 'Market',
        qty: sizing.qtyString,
        stopLoss: fmtPrice(ctx.plan.stopLoss, ctx.instrument.tickSize),
        takeProfit: fmtPrice(ctx.plan.takeProfit, ctx.instrument.tickSize),
        tpslMode: 'Full',
        timeInForce: 'IOC',
        orderLinkId,
      });

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

      return { account: sub.label, success: true, orderId: res.result?.orderId, qty: sizing.qty, riskUsd: sizing.riskUsd };
    } catch (err: any) {
      await AuditRepo.log({
        level: 'error', source: 'executor', event: 'order_exception',
        accountLabel: sub.label, symbol: ctx.plan.symbol,
        message: err.message ?? String(err),
      });
      return { account: sub.label, success: false, qty: 0, riskUsd: 0, reason: err.message ?? String(err) };
    }
  }));

  // Telegram + signal log (single message regardless of account count)
  const succeeded = reports.filter((r) => r.success);
  await SignalRepo.insert({
    symbol: ctx.plan.symbol,
    direction: ctx.plan.direction,
    confluence: ctx.signal.confluence,
    regime: ctx.regimeLabel,
    scores: { long: ctx.signal.long, short: ctx.signal.short },
    executed: succeeded.length > 0,
    rejectReason: succeeded.length === 0 ? reports.map((r) => r.reason).filter(Boolean).join('; ') : undefined,
  });

  if (ctx.telegram && succeeded.length > 0) {
    const totalRisk = succeeded.reduce((s, r) => s + r.riskUsd, 0);
    await ctx.telegram.tradeOpened({
      pair: ctx.plan.symbol,
      direction: ctx.plan.direction === 'Long' ? 'LONG' : 'SHORT',
      entry: fmtPrice(ctx.plan.entry, ctx.instrument.tickSize),
      sl: fmtPrice(ctx.plan.stopLoss, ctx.instrument.tickSize),
      tp: fmtPrice(ctx.plan.takeProfit, ctx.instrument.tickSize),
      rr: ctx.plan.rr.toFixed(2),
      riskPct: (ctx.signal.confluence >= 4 ? config.trade.maxRiskPct : config.trade.defaultRiskPct).toFixed(2),
      riskUsd: totalRisk.toFixed(2),
      qty: succeeded.map((r) => r.qty).join(' / '),
      confluence: `${ctx.signal.confluence}/4`,
      regime: ctx.regimeLabel,
      accounts: succeeded.length,
    });
  }

  return reports;
}
