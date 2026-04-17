import { config } from '../config';
import { cache } from '../cache';
import { BybitClient } from '../core/bybit-client';
import { SubAccount } from '../core/types';
import { EquityRepo, AuditRepo } from '../db/repositories';

/**
 * RiskEngine — central authority for HyroTrader compliance.
 *
 * Sources of truth:
 *   - Daily peak equity: Redis (fast) + PostgreSQL (durable)
 *   - Initial balance: tier.volume from accounts.json
 *
 * Two-tier limits per CLAUDE.md:
 *   KILL  (4% daily / 8% total) — bot's own safety margin
 *   HARD  (5% daily / 10% total) — HyroTrader hard limit; never reach
 */

export type RiskStatus = 'ok' | 'warn' | 'kill' | 'halt';

export interface RiskAssessment {
  status: RiskStatus;
  reason: string;
  dailyDdPct: number;
  totalDdPct: number;
  equity: number;
  initial: number;
  peak: number;
}

export class RiskEngine {
  constructor(private bybit: BybitClient) {}

  /** Take a fresh snapshot for one sub-account, persist + update peak */
  async snapshot(sub: SubAccount): Promise<RiskAssessment> {
    const wallet = await this.bybit.getWallet(sub);
    const equity = Number(wallet.equity);
    const available = Number(wallet.availableBalance);
    const upnl = Number(wallet.unrealisedPnl);

    await EquityRepo.snapshot(sub.label, sub.volume, equity, available, upnl);
    await EquityRepo.upsertDailyPeak(sub.label, equity);
    await cache.setDailyPeak(sub.label, equity);

    return this.assess(sub, equity);
  }

  /** Pure assessment — given equity, compute DDs and status */
  async assess(sub: SubAccount, equity: number): Promise<RiskAssessment> {
    const initial = sub.volume;
    let peak = await cache.getDailyPeak(sub.label);
    if (peak === null) {
      const stored = await EquityRepo.getDailyPeak(sub.label);
      peak = stored?.peak ?? equity;
    }
    peak = Math.max(peak, equity);

    // DD is always ≥ 0: if equity above peak/initial we're in profit, clamp to 0 so
    // downstream formatting doesn't show confusing negatives.
    const dailyDdPct = peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;
    const totalDdPct = initial > 0 ? Math.max(0, ((initial - equity) / initial) * 100) : 0;

    let status: RiskStatus = 'ok';
    let reason = '';

    if (totalDdPct >= config.risk.totalDdKill) {
      status = 'halt';
      reason = `Total DD ${totalDdPct.toFixed(2)}% ≥ kill ${config.risk.totalDdKill}%`;
    } else if (dailyDdPct >= config.risk.dailyDdKill) {
      status = 'kill';
      reason = `Daily DD ${dailyDdPct.toFixed(2)}% ≥ kill ${config.risk.dailyDdKill}%`;
    } else if (dailyDdPct >= config.risk.dailyDdKill * 0.75 || totalDdPct >= config.risk.totalDdKill * 0.75) {
      status = 'warn';
      reason = `Approaching DD limits (daily ${dailyDdPct.toFixed(2)}%, total ${totalDdPct.toFixed(2)}%)`;
    }

    return { status, reason, dailyDdPct, totalDdPct, equity, initial, peak };
  }

  /**
   * Enforce risk: returns `false` if no new entries permitted.
   * Checks: DD limits, portfolio heat, position count cap (2 base / 4 for A+).
   */
  async canEnter(
    sub: SubAccount,
    riskUsd: number,
    opts: { isAplus?: boolean } = {},
  ): Promise<{ ok: boolean; reason?: string; assessment: RiskAssessment }> {
    const halted = await cache.isHalted(sub.label);
    if (halted) {
      const a = await this.assess(sub, sub.volume);
      return { ok: false, reason: `Account halted: ${halted}`, assessment: a };
    }

    const a = await this.snapshot(sub);
    if (a.status === 'kill' || a.status === 'halt') {
      return { ok: false, reason: a.reason, assessment: a };
    }

    // Position count cap — 3 base, 5 for A+ (7-8/8 confluence)
    const positions = await this.bybit.getPositions(sub);
    const maxAllowed = opts.isAplus ? config.trade.maxPositions : 3;
    if (positions.length >= maxAllowed) {
      return {
        ok: false,
        reason: `Position cap: ${positions.length}/${maxAllowed} ${opts.isAplus ? '(A+)' : '(base)'}`,
        assessment: a,
      };
    }

    const totalHeat = await cache.getTotalHeat(sub.label);
    const heatPctAfter = ((totalHeat + riskUsd) / sub.volume) * 100;
    if (heatPctAfter > config.trade.maxHeatPct) {
      return {
        ok: false,
        reason: `Portfolio heat would be ${heatPctAfter.toFixed(2)}% (max ${config.trade.maxHeatPct}%)`,
        assessment: a,
      };
    }

    return { ok: true, assessment: a };
  }

  /** Trigger kill switch for ONE account: close all positions + halt + broadcast */
  async triggerKill(sub: SubAccount, reason: string, level: 'kill' | 'halt'): Promise<void> {
    await AuditRepo.log({
      level: 'critical', source: 'risk-engine', event: 'kill_switch',
      accountLabel: sub.label, message: reason, payload: { level },
    });

    await cache.setHalted(sub.label, reason, 86400);
    await cache.publishKill({ account: sub.label, reason, level });

    // Close every open position on this sub-account
    try {
      const positions = await this.bybit.getPositions(sub);
      await Promise.all(positions.map(async (p) => {
        try {
          await sub.client.submitOrder({
            category: 'linear',
            symbol: p.symbol,
            side: p.side === 'Buy' ? 'Sell' : 'Buy',
            orderType: 'Market',
            qty: p.size,
            reduceOnly: true,
          });
          await cache.clearHeat(sub.label, p.symbol);
        } catch (err: any) {
          console.error(`[Kill] Failed to close ${p.symbol} on ${sub.label}:`, err.message);
        }
      }));
    } catch (err: any) {
      console.error(`[Kill] Failed to fetch positions for ${sub.label}:`, err.message);
    }
  }
}
