import { query } from '../core/db';
import { loadAccounts } from '../core/accounts';
import { getRest, ping } from '../core/bybit';
import { getDayPnl } from '../core/pnl';
import { log } from '../core/logger';
import { tradeRepo } from '../data/trade-repo';
import { Position } from '../core/position';
import { tier1Pairs } from './pair-strategies';

/**
 * Risk constants — must match CLAUDE.md § Risk budget v4.
 *
 * Object.freeze prevents accidental mutation. Was a plain `const RISK = {...}`
 * whose fields were technically writable; anything in the process could have
 * silently changed `RISK.minRrTp2`. Freezing locks the contract.
 */
export const RISK = Object.freeze({
  riskPctBase: 0.375,                       // 3.75% heat cap / 10 parallel = 0.375%
  riskPctCap: 0.6,                          // hard cap if scaled up by vol multiplier
  maxParallelPositions: 6,                  // bt 2026-05-25: cap-6 = optimum (+66.96% / MaxDD 4.51% vs cap-7+ unlimited +64.69%). Operator-set.
  totalHeatCapPct: 3.75,                    // worst-case bt MaxDD 3.96% @ slip 0.40%
  dailyDrawdownSoftKillPct: -2.5,
  dailyDrawdownHardKillPct: -4.0,
  totalKillPct: -8.0,
  maxSlPerPairPerDay: 2,
  cooldownAfterSlHours: 12,                 // post-SL cooldown survives UTC-day boundary
  cooldownAfterAnyCloseHours: 4,            // post-any-close cooldown (TP/manual)
  minRrTp2: 0.3,                            // skip setups with rrTp2 < this (bt-validated)
  fundingWindows: [0, 8, 16] as const,
  fundingWindowMinutes: 10,
  hyrotraderDailyDdPct: -5.0,
  hyrotraderTotalDdPct: -10.0,
  minLeverage: 10,
  slMaxAgeMs: 5 * 60_000,                   // 5 min
});

export type RiskConfig = typeof RISK;

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  sizeMultiplier?: number;                 // 1.0 default; news-medium → 0.5
}

export interface RiskState {
  ts: number;
  iso: string;
  totalEquityUsd: number;
  dailyOpenEquityUsd: number;              // equity at session start (UTC midnight)
  dailyPnlUsd: number;
  dailyPnlPct: number;
  openPositionsCount: number;
  totalHeatPct: number;
  pairBlocked: Record<string, string>;     // 'BTCUSDT' → reason
  inFundingWindow: boolean;
  softKillTriggered: boolean;
  hardKillTriggered: boolean;
  totalKillTriggered: boolean;
}

function isFundingWindow(d: Date): boolean {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  for (const fundingHour of RISK.fundingWindows) {
    if (h === fundingHour && m < RISK.fundingWindowMinutes) return true;
    // Cover the 10 minutes BEFORE funding too — cross hour boundary
    if (h === (fundingHour + 23) % 24 && m >= 60 - RISK.fundingWindowMinutes) return true;
  }
  return false;
}

async function fetchTotalEquity(): Promise<number> {
  const accs = loadAccounts();
  const results = await Promise.all(accs.map(async (a) => {
    const r = await ping(a);
    return r.ok ? (r.equity ?? 0) : 0;
  }));
  return results.reduce((s, e) => s + e, 0);
}

async function fetchSessionStartEquity(now: Date): Promise<number> {
  // Use the latest positions_snapshot at or before the most recent UTC midnight.
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const r = await query<{ eq: string }>(
    `SELECT SUM(equity)::text AS eq FROM positions_snapshot
     WHERE ts = (SELECT MAX(ts) FROM positions_snapshot WHERE ts <= $1)`,
    [sessionStart]
  );
  const v = r.rows[0]?.eq;
  return v ? parseFloat(v) : 0;
}

// Returns a cooldown-block reason string if the pair is in cooldown; null otherwise.
// Combines two cooldown windows: (a) long post-SL (default 12h, losing closes only),
// (b) short post-any-close (default 4h, any TP/manual close). The 12h survives the
// UTC-day boundary so back-to-back SL clusters can't re-enter.
async function lastSlCooldown(now: Date, symbol: string): Promise<string | null> {
  const slCutoff = now.getTime() - RISK.cooldownAfterSlHours * 3_600_000;
  const slTs = await tradeRepo.lastSlCloseTs(symbol);
  if (slTs !== null && slTs >= slCutoff) {
    const minsSince = Math.floor((now.getTime() - slTs) / 60_000);
    return `SL cooldown: ${minsSince}min since SL, need ${RISK.cooldownAfterSlHours * 60}min`;
  }

  const anyCutoff = now.getTime() - RISK.cooldownAfterAnyCloseHours * 3_600_000;
  const lastTs = await tradeRepo.lastCloseTs(symbol);
  if (lastTs === null || lastTs < anyCutoff) return null;
  const minsSince = Math.floor((now.getTime() - lastTs) / 60_000);
  const minsRemaining = Math.max(0, RISK.cooldownAfterAnyCloseHours * 60 - minsSince);
  return `closed ${minsSince}min ago; any-close cooldown ${minsRemaining}min remaining`;
}

async function countSlToday(now: Date, symbol: string): Promise<number> {
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return tradeRepo.countSlInSession(symbol, sessionStart);
}

async function fetchOpenPositions(): Promise<Array<{ symbol: string; riskedUsd: number }>> {
  const trades = await tradeRepo.openTrades();
  return trades.map((t) => {
    const p = Position.fromOpenTrade(t);
    return { symbol: p.symbol, riskedUsd: p.riskedUsd() };
  });
}

export async function getRiskState(now: Date = new Date()): Promise<RiskState> {
  const ts = now.getTime();
  // Use DB-derived day P&L (realized closed today + unrealized from Bybit) instead
  // of legacy positions_snapshot diff which was never populated.
  const dayPnl = await getDayPnl(now);
  const equity = dayPnl.totalEquityUsd;
  const sessionEquity = equity - dayPnl.netUsd;
  const dailyPnl = dayPnl.netUsd;
  const dailyPnlPct = dayPnl.netPct;
  const openPositions = await fetchOpenPositions();
  // Cap-4 should count UNIQUE pairs, not raw trade rows. One signal placed on N
  // accounts creates N rows in the DB but it's still ONE pair-position. Strategy
  // is symmetric across accounts (Promise.all broadcast), so they live and die together.
  const uniquePairs = new Set(openPositions.map((p) => p.symbol));
  const uniquePositionsCount = uniquePairs.size;
  const totalRisked = openPositions.reduce((s, p) => s + p.riskedUsd, 0);
  const totalHeatPct = equity > 0 ? (totalRisked / equity) * 100 : 0;

  const pairBlocked: Record<string, string> = {};
  for (const symbol of tier1Pairs()) {
    const slCount = await countSlToday(now, symbol);
    if (slCount >= RISK.maxSlPerPairPerDay) {
      pairBlocked[symbol] = `${slCount} SL today (cap ${RISK.maxSlPerPairPerDay})`;
    }
    // Cooldown after a recent SL — finer-grained than the UTC-day cap.
    // Only set if not already blocked by the daily cap above (avoid stomping the reason).
    if (!pairBlocked[symbol]) {
      const cool = await lastSlCooldown(now, symbol);
      if (cool) pairBlocked[symbol] = cool;
    }
  }

  return {
    ts,
    iso: now.toISOString(),
    totalEquityUsd: equity,
    dailyOpenEquityUsd: sessionEquity,
    dailyPnlUsd: dailyPnl,
    dailyPnlPct,
    openPositionsCount: uniquePositionsCount,
    totalHeatPct,
    pairBlocked,
    inFundingWindow: isFundingWindow(now),
    softKillTriggered: dailyPnlPct <= RISK.dailyDrawdownSoftKillPct,
    hardKillTriggered: dailyPnlPct <= RISK.dailyDrawdownHardKillPct,
    totalKillTriggered: false,                     // requires baseline equity tracking — TODO
  };
}

/**
 * RiskManager — caches a single RiskState snapshot per "scan tick" so
 * precheckEntry() doesn't re-query the DB 13× per cycle (once per candidate
 * pair). Each scan-decide cycle creates a fresh manager via createForTick().
 *
 * The legacy free `precheckEntry(symbol, risk, now)` still works (back-compat);
 * internally it constructs a one-shot RiskManager.
 */
export class RiskManager {
  private snapshot: RiskState | null = null;

  constructor(private readonly now: Date) {}

  static async createForTick(now: Date = new Date()): Promise<RiskManager> {
    const m = new RiskManager(now);
    m.snapshot = await getRiskState(now);
    return m;
  }

  state(): RiskState {
    if (!this.snapshot) throw new Error('RiskManager: state() before createForTick()');
    return this.snapshot;
  }

  async precheck(symbol: string, riskPct: number): Promise<RiskCheckResult> {
    if (!this.snapshot) this.snapshot = await getRiskState(this.now);
    return runPrecheck(symbol, riskPct, this.snapshot);
  }
}

async function runPrecheck(symbol: string, riskPct: number, state: RiskState): Promise<RiskCheckResult> {
  if (state.inFundingWindow) {
    return { allowed: false, reason: `funding window (UTC ${state.iso})` };
  }
  if (state.hardKillTriggered) {
    return { allowed: false, reason: `daily P&L ${state.dailyPnlPct.toFixed(2)}% breached hard kill ${RISK.dailyDrawdownHardKillPct}%` };
  }
  if (state.softKillTriggered) {
    return { allowed: false, reason: `daily P&L ${state.dailyPnlPct.toFixed(2)}% breached soft kill ${RISK.dailyDrawdownSoftKillPct}%` };
  }
  if (state.openPositionsCount >= RISK.maxParallelPositions) {
    return { allowed: false, reason: `${state.openPositionsCount} open positions (cap ${RISK.maxParallelPositions})` };
  }
  if (state.pairBlocked[symbol]) {
    return { allowed: false, reason: `pair disabled: ${state.pairBlocked[symbol]}` };
  }
  // Per-pair uniqueness: only ONE position per symbol across all accounts.
  // Without this, cron firing on the same actionable signal across 5-min cycles
  // would re-execute the same trade. The strategy's cooldown is in-process and
  // doesn't survive across `npx tsx` invocations.
  const pairOpenR = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM trades WHERE status = 'open' AND symbol = $1`,
    [symbol]
  );
  const pairOpenCount = parseInt(pairOpenR.rows[0]?.c ?? '0', 10);
  if (pairOpenCount > 0) {
    return { allowed: false, reason: `${symbol} already has ${pairOpenCount} open position(s) — duplicate signal` };
  }
  // A still-pending limit intent (placed on Bybit, not yet credited, no trades row)
  // also occupies the pair: re-signalling would stack a second ladder against the
  // live limit. status in ('pending','placed') AND trade_id IS NULL means active and
  // unresolved; cancelled/orphaned/failed intents are excluded.
  const pairPendingR = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM pending_orders
      WHERE symbol = $1 AND trade_id IS NULL AND status IN ('pending', 'placed')`,
    [symbol]
  );
  const pairPendingCount = parseInt(pairPendingR.rows[0]?.c ?? '0', 10);
  if (pairPendingCount > 0) {
    return { allowed: false, reason: `${symbol} has ${pairPendingCount} pending limit order(s) — duplicate signal` };
  }
  if (riskPct > RISK.riskPctCap) {
    return { allowed: false, reason: `risk ${riskPct}% exceeds cap ${RISK.riskPctCap}%` };
  }
  // Heat check: would adding this trade exceed total heat cap?
  const projectedHeatPct = state.totalHeatPct + riskPct;
  if (projectedHeatPct > RISK.totalHeatCapPct) {
    return { allowed: false, reason: `heat would be ${projectedHeatPct.toFixed(2)}% (cap ${RISK.totalHeatCapPct}%)` };
  }

  return { allowed: true, sizeMultiplier: 1.0 };
}

/** Back-compat wrapper — constructs a one-shot RiskManager per call. */
export async function precheckEntry(
  symbol: string,
  riskPct: number,
  now: Date = new Date()
): Promise<RiskCheckResult> {
  const m = await RiskManager.createForTick(now);
  return m.precheck(symbol, riskPct);
}

export function formatRiskState(s: RiskState): string {
  return [
    `risk state @ ${s.iso}`,
    `  equity:        $${s.totalEquityUsd.toFixed(0)}`,
    `  session start: $${s.dailyOpenEquityUsd.toFixed(0)}`,
    `  daily P&L:     $${s.dailyPnlUsd.toFixed(0)} (${s.dailyPnlPct.toFixed(2)}%)`,
    `  open positions: ${s.openPositionsCount} / ${RISK.maxParallelPositions}`,
    `  total heat:    ${s.totalHeatPct.toFixed(2)}% / ${RISK.totalHeatCapPct}%`,
    `  funding window: ${s.inFundingWindow}`,
    `  soft kill:      ${s.softKillTriggered}`,
    `  hard kill:      ${s.hardKillTriggered}`,
    `  pair blocks:    ${Object.keys(s.pairBlocked).length === 0 ? 'none' : JSON.stringify(s.pairBlocked)}`,
  ].join('\n');
}
