import { query } from './lib/db';
import { loadAccounts } from './lib/accounts';
import { getRest, ping } from './lib/bybit';
import { log } from './lib/logger';

// Risk constants — must match CLAUDE.md § Risk budget v3
export const RISK = {
  riskPctBase: 0.6,
  riskPctCap: 1.0,
  maxParallelPositions: 2,
  totalHeatCapPct: 1.5,
  dailyDrawdownSoftKillPct: -2.5,
  dailyDrawdownHardKillPct: -4.0,
  totalKillPct: -8.0,
  maxSlPerPairPerDay: 2,
  deadZoneStartHourUtc: 22,
  deadZoneEndHourUtc: 24,
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
  inDeadZone: boolean;
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

function isDeadZone(d: Date): boolean {
  const h = d.getUTCHours();
  return h >= RISK.deadZoneStartHourUtc && h < RISK.deadZoneEndHourUtc;
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

async function countSlToday(now: Date, symbol: string): Promise<number> {
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const r = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM trades
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
  const equity = await fetchTotalEquity();
  const sessionEquity = await fetchSessionStartEquity(now);
  const dailyPnl = sessionEquity > 0 ? equity - sessionEquity : 0;
  const dailyPnlPct = sessionEquity > 0 ? (dailyPnl / sessionEquity) * 100 : 0;
  const openPositions = await fetchOpenPositions();
  const totalRisked = openPositions.reduce((s, p) => s + p.riskedUsd, 0);
  const totalHeatPct = equity > 0 ? (totalRisked / equity) * 100 : 0;

  const pairBlocked: Record<string, string> = {};
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    const slCount = await countSlToday(now, symbol);
    if (slCount >= RISK.maxSlPerPairPerDay) {
      pairBlocked[symbol] = `${slCount} SL today (cap ${RISK.maxSlPerPairPerDay})`;
    }
  }

  return {
    ts,
    iso: now.toISOString(),
    totalEquityUsd: equity,
    dailyOpenEquityUsd: sessionEquity,
    dailyPnlUsd: dailyPnl,
    dailyPnlPct,
    openPositionsCount: openPositions.length,
    totalHeatPct,
    pairBlocked,
    inFundingWindow: isFundingWindow(now),
    inDeadZone: isDeadZone(now),
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
  if (state.inDeadZone) {
    return { allowed: false, reason: `dead zone 22-00 UTC` };
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
    `  dead zone:      ${s.inDeadZone}`,
    `  soft kill:      ${s.softKillTriggered}`,
    `  hard kill:      ${s.hardKillTriggered}`,
    `  pair blocks:    ${Object.keys(s.pairBlocked).length === 0 ? 'none' : JSON.stringify(s.pairBlocked)}`,
  ].join('\n');
}
