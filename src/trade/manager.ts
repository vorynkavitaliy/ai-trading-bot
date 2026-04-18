import { BybitClient } from '../core/bybit-client';
import { SubAccount, PositionInfo } from '../core/types';
import { TelegramNotifier } from '../notifications/telegram';
import { TradeRepo, AuditRepo } from '../db/repositories';
import { cache } from '../cache';
import { Indicators, Candle } from '../analysis/indicators';
import { config } from '../config';
import { quantize } from '../risk/sizing';
import { Regime } from '../signal/regime';
import { scoreConfluence } from '../signal/confluence';

export interface ClosedTrade {
  account: string;
  symbol: string;
  direction: 'Long' | 'Short';
  entry: number;
  exit: number;
  qty: number;
  pnlUsd: number;
  pnlPct: number;
  rMultiple?: number;
  reason: string;        // stop_loss / take_profit / trailing / manual_profit / manual_loss
  openedAt: number;      // ms
  closedAt: number;      // ms
}

export interface TrailEvent {
  account: string;
  symbol: string;
  direction: 'Long' | 'Short';
  newSl: number;
  r: number;
  qty: string;
}

/**
 * Position manager: trail SL once 1.5R is reached.
 * Reconciles open Bybit positions with DB trades, closes orphans on exit.
 *
 * **Does NOT send Telegram directly** — returns events so the orchestrator
 * can aggregate across sub-accounts into one message per symbol/event.
 */
/** Context passed to manage() for proactive position health checks (8-factor model) */
export interface ManageContext {
  c1h: Candle[];
  c15m?: Candle[];
  regime?: Regime;
  newsBias?: 'risk-on' | 'risk-off' | 'neutral';
}

export class PositionManager {
  constructor(private bybit: BybitClient) {}

  async manage(
    sub: SubAccount,
    symbol: string,
    c1h: Candle[],
    tickSize: number,
    ctx?: ManageContext,
  ): Promise<{ closed: ClosedTrade[]; trailed: TrailEvent[] }> {
    const closed: ClosedTrade[] = [];
    const trailed: TrailEvent[] = [];

    const positions = await this.bybit.getPositions(sub, symbol);
    if (positions.length === 0) {
      const c = await this.reconcileClosed(sub, symbol);
      if (c) closed.push(c);
      await cache.clearHeat(sub.label, symbol);
      return { closed, trailed };
    }

    const atr = Indicators.atr(c1h, 14);
    if (atr === undefined) return { closed, trailed };

    for (const p of positions) {
      // Force-close positions exceeding max hold time
      const aged = await this.maybeExpire(sub, p);
      if (aged) {
        closed.push(aged);
        continue;
      }

      // Proactive health check — close early if conditions turned against us
      if (ctx) {
        const earlyExit = await this.maybeEarlyExit(sub, p, atr, ctx);
        if (earlyExit) {
          closed.push(earlyExit);
          continue;
        }
      }

      const ev = await this.maybeTrail(sub, p, atr, tickSize);
      if (ev) trailed.push(ev);
    }
    return { closed, trailed };
  }

  private async reconcileClosed(sub: SubAccount, symbol: string): Promise<ClosedTrade | null> {
    const open = await TradeRepo.openForAccountSymbol(sub.label, symbol);
    if (!open) return null;

    try {
      const recent = await this.bybit.getClosedPnl(sub, symbol, 5);
      const match: any = recent.find((r: any) => r.orderId === open.order_id || r.symbol === symbol);
      if (!match) return null;

      const exitPrice = Number(match.avgExitPrice ?? match.exitPrice ?? 0);
      const initial = Number(open.entry_price);
      const qty = Number(open.qty);
      const isLong = open.direction === 'Long';
      // Recompute PnL from (exit-entry)*qty — do NOT trust Bybit's closedPnl sign
      // (Bybit sometimes returns absolute value or inverted sign depending on direction)
      const pnl = isLong ? (exitPrice - initial) * qty : (initial - exitPrice) * qty;
      const stopDist = Math.abs(initial - Number(open.stop_loss ?? initial));
      const rMultiple = stopDist > 0 ? (pnl / (stopDist * qty)) : undefined;
      // pnlPct from notional (entry*qty), not from full account volume
      const notional = initial * qty;
      const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;
      const reason = inferExitReason(open, match, isLong, initial, exitPrice);

      await TradeRepo.close({
        tradeId: open.id,
        exitPrice,
        exitReason: reason,
        pnlUsd: pnl,
        pnlPct,
        rMultiple,
        feesUsd: Number(match.cumExecFee ?? 0),
      });

      await cache.setRecentClose(symbol, open.direction as 'Long' | 'Short');

      return {
        account: sub.label,
        symbol,
        direction: open.direction,
        entry: initial,
        exit: exitPrice,
        qty,
        pnlUsd: pnl,
        pnlPct,
        rMultiple,
        reason,
        openedAt: new Date(open.opened_at).getTime(),
        closedAt: Date.now(),
      };
    } catch (err: any) {
      console.error(`[PositionManager] reconcile failed:`, err.message);
      return null;
    }
  }

  /**
   * Proactive position health check — "would I still enter this trade right now?"
   *
   * Uses the 8-factor confluence model to score the OPPOSITE direction.
   * If the opposite direction scores 4/8+, conditions have flipped — close early.
   *
   * Only triggers if position is NOT already in significant profit (> 1R).
   * If > 1R, trailing stop handles it.
   */
  private async maybeEarlyExit(
    sub: SubAccount,
    p: PositionInfo,
    atr: number,
    ctx: ManageContext,
  ): Promise<ClosedTrade | null> {
    const open = await TradeRepo.openForAccountSymbol(sub.label, p.symbol);
    if (!open) return null;
    if (!ctx.c1h || !ctx.c15m || ctx.c1h.length < 50) return null;

    const isLong = p.side === 'Buy';
    const entry = Number(p.entryPrice);
    const cur = Number(p.markPrice);
    const sl = Number(p.stopLoss);
    const stopDist = Math.abs(entry - (sl || entry));

    // Don't early-exit if already in good profit (> 1R) — let trailing handle it
    if (stopDist > 0) {
      const r = isLong ? (cur - entry) / stopDist : (entry - cur) / stopDist;
      if (r >= 1.0) return null;
    }

    // Score the OPPOSITE direction using 8-factor model
    // If we're Long and the Short score is 4/8+ → market turned against us
    const oppositeDir = isLong ? 'Short' : 'Long';
    const factors = scoreConfluence(oppositeDir, {
      c4h: ctx.c1h, // Use 1H as surrogate if 4H not available in manage context
      c1h: ctx.c1h,
      c15m: ctx.c15m,
      regime: ctx.regime ?? 'Range',
      newsBias: ctx.newsBias,
    });

    const adverseCount = factors.reduce((s, f) => s + f.score, 0);
    const adverseDetails = factors.filter((f) => f.score === 1).map((f) => `${f.name}: ${f.detail}`);

    // Need 4/8 adverse factors to trigger early exit
    if (adverseCount < 4) return null;

    // Execute early exit
    const side = isLong ? 'Sell' : 'Buy';
    try {
      await sub.client.submitOrder({
        category: 'linear', symbol: p.symbol, side, orderType: 'Market',
        qty: p.size, reduceOnly: true, timeInForce: 'GTC',
      });

      const exitPrice = cur;
      const qty = Number(open.qty);
      const pnl = isLong ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
      const notional = entry * qty;
      const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;
      const rMultiple = stopDist > 0 ? pnl / (stopDist * qty) : undefined;

      await TradeRepo.close({
        tradeId: open.id, exitPrice, exitReason: 'early_exit',
        pnlUsd: pnl, pnlPct, rMultiple, feesUsd: 0,
      });

      await AuditRepo.log({
        level: 'warn', source: 'position-manager', event: 'early_exit',
        accountLabel: sub.label, symbol: p.symbol,
        message: `Proactive close: ${adverseDetails.join('; ')} (${adverseCount}/8 adverse)`,
      });

      await cache.clearHeat(sub.label, p.symbol);
      await cache.setRecentClose(p.symbol, open.direction as 'Long' | 'Short');

      return {
        account: sub.label, symbol: p.symbol,
        direction: open.direction, entry, exit: exitPrice, qty,
        pnlUsd: pnl, pnlPct, rMultiple,
        reason: 'early_exit',
        openedAt: new Date(open.opened_at).getTime(),
        closedAt: Date.now(),
      };
    } catch (err: any) {
      console.error(`[PositionManager] early exit failed ${p.symbol}:`, err.message);
      return null;
    }
  }

  /** Force-close position if it exceeds maxHoldHours (prefer intraday, hard cap 48h). */
  private async maybeExpire(sub: SubAccount, p: PositionInfo): Promise<ClosedTrade | null> {
    const open = await TradeRepo.openForAccountSymbol(sub.label, p.symbol);
    if (!open) return null;

    const openedAt = new Date(open.opened_at).getTime();
    const ageHours = (Date.now() - openedAt) / 3_600_000;
    if (ageHours < config.trade.maxHoldHours) return null;

    const isLong = p.side === 'Buy';
    const side = isLong ? 'Sell' : 'Buy';

    try {
      await sub.client.submitOrder({
        category: 'linear',
        symbol: p.symbol,
        side,
        orderType: 'Market',
        qty: p.size,
        reduceOnly: true,
        timeInForce: 'GTC',
      });

      const exitPrice = Number(p.markPrice);
      const entry = Number(open.entry_price);
      const qty = Number(open.qty);
      const pnl = isLong ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
      const notional = entry * qty;
      const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;
      const stopDist = Math.abs(entry - Number(open.stop_loss ?? entry));
      const rMultiple = stopDist > 0 ? pnl / (stopDist * qty) : undefined;

      await TradeRepo.close({
        tradeId: open.id,
        exitPrice,
        exitReason: 'expired',
        pnlUsd: pnl,
        pnlPct,
        rMultiple,
        feesUsd: 0,
      });

      await AuditRepo.log({
        level: 'warn', source: 'position-manager', event: 'position_expired',
        accountLabel: sub.label, symbol: p.symbol,
        message: `Closed after ${ageHours.toFixed(1)}h (max ${config.trade.maxHoldHours}h)`,
      });

      await cache.clearHeat(sub.label, p.symbol);
      await cache.setRecentClose(p.symbol, open.direction as 'Long' | 'Short');

      return {
        account: sub.label,
        symbol: p.symbol,
        direction: open.direction,
        entry,
        exit: exitPrice,
        qty,
        pnlUsd: pnl,
        pnlPct,
        rMultiple,
        reason: 'expired',
        openedAt,
        closedAt: Date.now(),
      };
    } catch (err: any) {
      console.error(`[PositionManager] expire close failed for ${p.symbol}:`, err.message);
      return null;
    }
  }

  /** Move SL towards profit when 1.5R is reached. Edit-never-cancel. */
  private async maybeTrail(
    sub: SubAccount,
    p: PositionInfo,
    atr: number,
    tickSize: number,
  ): Promise<TrailEvent | null> {
    const entry = Number(p.entryPrice);
    const cur = Number(p.markPrice);
    const sl = Number(p.stopLoss);
    if (!sl || !entry) return null;

    const isLong = p.side === 'Buy';
    const stopDist = Math.abs(entry - sl);
    if (stopDist === 0) return null;

    const r = isLong ? (cur - entry) / stopDist : (entry - cur) / stopDist;
    if (r < config.trade.trailActivateR) return null;

    const trailDist = atr;
    const newSl = isLong
      ? Math.max(sl, quantize(cur - trailDist, tickSize))
      : Math.min(sl, quantize(cur + trailDist, tickSize));

    const breakeven = quantize(entry, tickSize);
    const candidateSl = isLong ? Math.max(newSl, breakeven) : Math.min(newSl, breakeven);

    if ((isLong && candidateSl <= sl) || (!isLong && candidateSl >= sl)) return null;

    try {
      await sub.client.setTradingStop({
        category: 'linear',
        symbol: p.symbol,
        positionIdx: 0,
        stopLoss: String(candidateSl),
        tpslMode: 'Full',
      });
      await AuditRepo.log({
        level: 'info', source: 'position-manager', event: 'sl_trailed',
        accountLabel: sub.label, symbol: p.symbol,
        message: `SL ${sl} → ${candidateSl} (R=${r.toFixed(2)})`,
      });
      return {
        account: sub.label,
        symbol: p.symbol,
        direction: isLong ? 'Long' : 'Short',
        newSl: candidateSl,
        r,
        qty: p.size,
      };
    } catch (err: any) {
      console.error(`[PositionManager] setTradingStop failed:`, err.message);
      return null;
    }
  }
}

export function msToDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
  return `${h}h ${m}m ${ss}s`;
}

function inferExitReason(
  open: any,
  closed: any,
  isLong?: boolean,
  entryPrice?: number,
  exitPrice?: number,
): string {
  const exitType = (closed.execType ?? closed.exitType ?? '').toString();
  if (/StopLoss/i.test(exitType)) return 'stop_loss';
  if (/TakeProfit/i.test(exitType)) return 'take_profit';
  if (/Trailing/i.test(exitType)) return 'trailing';
  // Compute profit/loss from entry vs exit by direction (do NOT trust closedPnl sign)
  if (isLong !== undefined && entryPrice !== undefined && exitPrice !== undefined && entryPrice > 0) {
    const delta = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
    return delta >= 0 ? 'manual_profit' : 'manual_loss';
  }
  return 'manual_loss';
}

/**
 * Aggregate closed trades by (symbol, direction, reason) and emit ONE Telegram message per group.
 * Expected usage: collect events from per-account `manage()` calls, then call this once.
 */
export async function announceClosedAggregated(
  telegram: TelegramNotifier,
  closed: ClosedTrade[],
): Promise<void> {
  if (closed.length === 0) return;

  const groups = new Map<string, ClosedTrade[]>();
  for (const c of closed) {
    const key = `${c.symbol}|${c.direction}|${c.reason}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const totalPnl = group.reduce((s, t) => s + t.pnlUsd, 0);
    const avgPnlPct = group.reduce((s, t) => s + t.pnlPct, 0) / group.length;
    const rValues = group.map((t) => t.rMultiple).filter((v): v is number => v !== undefined);
    const avgR = rValues.length ? rValues.reduce((s, v) => s + v, 0) / rValues.length : undefined;
    const duration = msToDuration(Date.now() - Math.min(...group.map((t) => t.openedAt)));

    const reasonKey = first.reason === 'stop_loss' ? 'SL'
      : first.reason === 'take_profit' ? 'TP1'
      : first.reason === 'trailing' ? 'trailing'
      : first.reason === 'expired' ? 'expired'
      : first.reason === 'early_exit' ? 'early_exit'
      : 'manual';

    await telegram.tradeClosed({
      pair: first.symbol,
      direction: first.direction === 'Long' ? 'LONG' : 'SHORT',
      reason: reasonKey as any,
      entry: String(first.entry),
      exit: String(first.exit),
      pnlUsd: totalPnl.toFixed(2),
      pnlPct: avgPnlPct.toFixed(2),
      rMultiple: avgR !== undefined ? avgR.toFixed(2) : '—',
      duration,
      accounts: group.length,
    });
  }
}

/** Aggregate trail events similarly — one message per (symbol, direction) */
export async function announceTrailedAggregated(
  telegram: TelegramNotifier,
  trailed: TrailEvent[],
): Promise<void> {
  if (trailed.length === 0) return;
  const groups = new Map<string, TrailEvent[]>();
  for (const t of trailed) {
    const key = `${t.symbol}|${t.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const group of groups.values()) {
    const first = group[0];
    const avgR = group.reduce((s, t) => s + t.r, 0) / group.length;
    await telegram.orderFilled({
      pair: first.symbol,
      direction: first.direction === 'Long' ? 'LONG' : 'SHORT',
      type: 'sl_move',
      price: String(first.newSl),
      qty: group.map((t) => t.qty).join(' / '),
      detail: `SL подтянут (R=${avgR.toFixed(2)}, ${group.length} акк.)`,
    });
  }
}
