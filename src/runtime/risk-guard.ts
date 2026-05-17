import { query } from '../core/db';
import { loadAccounts } from '../core/accounts';
import { getRest, ping } from '../core/bybit';
import { getDayPnl } from '../core/pnl';
import { log } from '../core/logger';

// Risk constants — must match CLAUDE.md § Risk budget v3
export const RISK = {
  riskPctBase: 0.375,                       // 3.00% heat cap / 8 parallel = 0.375%
  riskPctCap: 0.6,                          // hard cap if scaled up by vol multiplier
  maxParallelPositions: 8,                  // 13-pair universe, cap-8 (raised 2026-05-17 after CG+cooldown reduced MaxDD from 4.64% → 2.71% bt @ slip 0.25%, leaving room to widen parallelism)
  totalHeatCapPct: 3.00,                    // 8×0.375 = 3.00 (still well below HyroTrader 5% daily DD limit)
  dailyDrawdownSoftKillPct: -2.5,
  dailyDrawdownHardKillPct: -4.0,
  totalKillPct: -8.0,
  maxSlPerPairPerDay: 2,
  // Cooldown after a SL hit on a pair: block re-entry on that pair for N hours.
  // Motivated by 2026-05-15→16 live cluster where DOGE LONG SL'd at 13:45 UTC then
  // auto-execute re-entered LONG at 23:00 UTC same day (within UTC-day SL cap),
  // also SL'd. The UTC-day SL cap (2) is too coarse for fast back-to-back losses
  // when intraday regime continuation is active. 12h is a middle ground:
  //   - long enough to let a directional move complete or reverse cleanly
  //   - short enough that genuine VAL/VAH re-touch setups next session aren't lost
  cooldownAfterSlHours: 12,
  fundingWindows: [0, 8, 16] as const,    // UTC hours
  fundingWindowMinutes: 10,
  hyrotraderDailyDdPct: -5.0,
  hyrotraderTotalDdPct: -10.0,
  minLeverage: 10,
  slMaxAgeMs: 5 * 60_000,                 // 5 min
};

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

// Returns a cooldown-block reason string if the pair had a SL within the last
// `RISK.cooldownAfterSlHours` hours; null otherwise. The cooldown is independent
// of the UTC-day SL cap — it survives day boundaries.
async function lastSlCooldown(now: Date, symbol: string): Promise<string | null> {
  const cutoffMs = now.getTime() - RISK.cooldownAfterSlHours * 3_600_000;
  const r = await query<{ ts: string }>(
    `SELECT EXTRACT(EPOCH FROM closed_at) * 1000 AS ts FROM trades
     WHERE symbol = $1 AND status = 'closed' AND realized_r < 0 AND closed_at IS NOT NULL
     ORDER BY closed_at DESC LIMIT 1`,
    [symbol]
  );
  const lastTs = r.rows[0]?.ts ? parseFloat(r.rows[0].ts) : null;
  if (lastTs === null || lastTs < cutoffMs) return null;
  const minsSince = Math.floor((now.getTime() - lastTs) / 60_000);
  const minsRemaining = Math.max(0, RISK.cooldownAfterSlHours * 60 - minsSince);
  return `SL ${minsSince}min ago; cooldown ${minsRemaining}min remaining`;
}

async function countSlToday(now: Date, symbol: string): Promise<number> {
  // Count UNIQUE logical SL events per pair, not per-account-row. One signal placed
  // on N accounts creates N closed-rows when SL hits, all with near-identical opened_at
  // (Promise.all broadcast → ms-level skew). We dedupe by side + opened_at rounded to
  // the second so a multi-account broadcast counts as 1 event toward the daily SL cap.
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const r = await query<{ c: string }>(
    `SELECT COUNT(DISTINCT (side, date_trunc('second', opened_at)))::text AS c
     FROM trades
     WHERE symbol = $1 AND status = 'closed'
       AND closed_at IS NOT NULL AND EXTRACT(EPOCH FROM closed_at) * 1000 >= $2
       AND realized_r < 0`,
    [symbol, sessionStart]
  );
  return parseInt(r.rows[0]?.c ?? '0', 10);
}

async function fetchOpenPositions(): Promise<Array<{ symbol: string; riskedUsd: number }>> {
  const r = await query<{ symbol: string; entry_price: string; sl: string; qty: string }>(
    `SELECT symbol, entry_price::text, sl::text, qty::text FROM trades
     WHERE status = 'open'`
  );
  return r.rows.map((row) => {
    const ep = parseFloat(row.entry_price ?? '0');
    const sl = parseFloat(row.sl ?? '0');
    const qty = parseFloat(row.qty ?? '0');
    const risked = Math.abs(ep - sl) * qty;
    return { symbol: row.symbol, riskedUsd: risked };
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
  const universe = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
    'BNBUSDT', 'LTCUSDT', 'ATOMUSDT',
    'TONUSDT', 'DOGEUSDT',
    'APTUSDT', 'ARBUSDT',
    'TAOUSDT', 'INJUSDT',
  ];
  for (const symbol of universe) {
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

export async function precheckEntry(
  symbol: string,
  riskPct: number,
  now: Date = new Date()
): Promise<RiskCheckResult> {
  const state = await getRiskState(now);

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
