// Day P&L calculator: derives daily realized + unrealized from DB trades table
// + Bybit live positions. Single source of truth for heartbeat / risk-guard / reports.

import { query } from './db';
import { loadAccounts, AccountKey } from './accounts';
import { getRest, withRetry } from './bybit';
import { log } from './logger';

export interface DayPnl {
  utcDay: string;                 // 'YYYY-MM-DD'
  sessionStartTs: number;         // UTC midnight ms
  realizedUsd: number;            // sum of pnl_usd from trades closed today
  realizedR: number;              // sum of realized_r
  unrealizedUsd: number;          // sum of Bybit unrealisedPnl across all open positions
  netUsd: number;                 // realized + unrealized
  totalEquityUsd: number;         // sum across all accounts (current)
  netPct: number;                 // netUsd / (equity at session start) * 100
  closedTradesToday: number;
  winsToday: number;
  lossesToday: number;
  openPositionsCount: number;
}

async function fetchTotalEquityAndUnrealized(): Promise<{ equity: number; unrealized: number; openCount: number }> {
  const accounts = loadAccounts();
  let equity = 0;
  let unrealized = 0;
  let openCount = 0;
  for (const a of accounts) {
    const c = getRest(a);
    try {
      const w = await withRetry(() => c.getWalletBalance({ accountType: 'UNIFIED' }), { label: `wallet-${a.keyName}` });
      if (w.retCode === 0) equity += parseFloat(w.result?.list?.[0]?.totalEquity ?? '0');
    } catch (e: any) {
      log.warn('wallet fetch failed', { account: a.keyName, err: e.message });
    }
    try {
      const p = await withRetry(() => c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' }), { label: `pos-${a.keyName}` });
      if (p.retCode === 0) {
        for (const pos of p.result?.list ?? []) {
          if (parseFloat(pos.size) > 0) {
            openCount++;
            unrealized += parseFloat(pos.unrealisedPnl ?? '0');
          }
        }
      }
    } catch (e: any) {
      log.warn('positions fetch failed', { account: a.keyName, err: e.message });
    }
  }
  return { equity, unrealized, openCount };
}

export async function getDayPnl(now: Date = new Date()): Promise<DayPnl> {
  const utcDay = now.toISOString().slice(0, 10);                                  // YYYY-MM-DD UTC
  const sessionStartTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // Realized P&L from DB: trades closed today (UTC midnight to now).
  const r = await query<any>(
    `SELECT
       COUNT(*)::int AS n,
       COALESCE(SUM(pnl_usd), 0)::text AS sum_usd,
       COALESCE(SUM(realized_r), 0)::text AS sum_r,
       SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END)::int AS wins,
       SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END)::int AS losses
     FROM trades
     WHERE status = 'closed'
       AND closed_at IS NOT NULL
       AND closed_at >= to_timestamp($1 / 1000.0)`,
    [sessionStartTs]
  );
  const realized = r.rows[0];
  const realizedUsd = parseFloat(realized.sum_usd ?? '0');
  const realizedR = parseFloat(realized.sum_r ?? '0');

  // Live equity + unrealized from Bybit
  const { equity, unrealized, openCount } = await fetchTotalEquityAndUnrealized();
  const netUsd = realizedUsd + unrealized;

  // Equity at session start = current - net day P&L (best-effort estimate)
  const sessionStartEquity = equity - netUsd;
  const netPct = sessionStartEquity > 0 ? (netUsd / sessionStartEquity) * 100 : 0;

  return {
    utcDay,
    sessionStartTs,
    realizedUsd,
    realizedR,
    unrealizedUsd: unrealized,
    netUsd,
    totalEquityUsd: equity,
    netPct,
    closedTradesToday: parseInt(realized.n ?? '0', 10),
    winsToday: parseInt(realized.wins ?? '0', 10),
    lossesToday: parseInt(realized.losses ?? '0', 10),
    openPositionsCount: openCount,
  };
}

export function formatDayPnl(p: DayPnl): string {
  const sign = p.netUsd >= 0 ? '+' : '−';
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    `Day P&L (${p.utcDay} UTC):`,
    `  Realized:    ${sign}$${fmt(Math.abs(p.realizedUsd))}  (${p.realizedR.toFixed(2)}R)`,
    `  Unrealized:  ${p.unrealizedUsd >= 0 ? '+' : '−'}$${fmt(Math.abs(p.unrealizedUsd))}`,
    `  NET:         ${sign}$${fmt(Math.abs(p.netUsd))}  (${p.netPct >= 0 ? '+' : ''}${p.netPct.toFixed(2)}%)`,
    `  Trades:      ${p.closedTradesToday} closed (W:${p.winsToday} L:${p.lossesToday}), ${p.openPositionsCount} open`,
    `  Equity:      $${fmt(p.totalEquityUsd)}`,
  ].join('\n');
}
