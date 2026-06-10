/**
 * Trade repository — single owner of all `trades` table queries.
 *
 * Before this, ~8 modules each wrote their own `SELECT ... FROM trades WHERE
 * status='open'`, drifting on which columns they pulled (qty vs initial_qty,
 * etc.). The `t.qty` vs `t.initial_qty` discrepancy is exactly how the
 * reconcile.ts:188 R-inflation bug was born — a class of bugs the repo
 * eliminates by funnelling all access through typed methods.
 *
 * SRP: this module knows how to read/write the trades table. Nothing else does.
 */

import { query } from '../core/db';

export interface OpenTrade {
  id: number;
  account_bucket: string;
  account_key: string;
  symbol: string;
  side: string;
  qty: number;
  /** Original entry qty before any partial fills. Used for risk math. */
  initial_qty: number;
  entry_price: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  opened_at: string;
  /** True if tp1_filled_at IS NOT NULL — partial TP1 fill already processed. */
  tp1_filled: boolean;
  /** Pre-tagged exit reason while still open (max-hold sets 'time_stop' BEFORE the
   *  Bybit close so the daemon's autoCloseTrade preserves it instead of inferring
   *  'manual'). Null for normal trades. */
  exit_reason: string | null;
  /** strategy.name that opened the trade (trades.strategy); null for manual/legacy. */
  strategy: string | null;
}

export interface ClosedTrade {
  id: number;
  symbol: string;
  side: string;
  account_bucket: string;
  account_key: string;
  qty: number;
  initial_qty: number;
  entry_price: number | null;
  exit_price: number | null;
  sl: number | null;
  pnl_usd: number | null;
  realized_r: number | null;
  exit_reason: string | null;
  opened_at: string;
  closed_at: string | null;
}

/**
 * Repository contract — every caller depends on this interface, not on the
 * concrete TradeRepo. Tests pass an InMemoryTradeRepo (not shipped) that
 * satisfies the same interface. Dependency inversion: high-level code
 * (risk-guard, reconcile, position-watcher) doesn't know about Postgres.
 */
export interface ITradeRepository {
  openTrades(): Promise<OpenTrade[]>;
  openTradesForAccount(accountKey: string): Promise<OpenTrade[]>;
  openTradesForPair(symbol: string): Promise<OpenTrade[]>;
  recentClosed(days: number): Promise<ClosedTrade[]>;
  tradeById(id: number): Promise<ClosedTrade | null>;
  lastSlCloseTs(symbol: string): Promise<number | null>;
  lastCloseTs(symbol: string): Promise<number | null>;
  countSlInSession(symbol: string, sessionStartMs: number): Promise<number>;
  countEntriesSince(sinceMs: number): Promise<number>;
}

export class TradeRepo implements ITradeRepository {
  /** All open trades across every account. */
  async openTrades(): Promise<OpenTrade[]> {
    const r = await query<any>(
      `SELECT id, account_bucket, account_key, symbol, side, qty::text,
              COALESCE(initial_qty, qty)::text AS initial_qty,
              entry_price::text, sl::text, tp1::text, tp2::text,
              opened_at::text,
              tp1_filled_at IS NOT NULL AS tp1_filled,
              exit_reason, strategy
       FROM trades WHERE status = 'open'`
    );
    return r.rows.map(toOpenTrade);
  }

  /** Open trades for a single Bybit account key. */
  async openTradesForAccount(accountKey: string): Promise<OpenTrade[]> {
    const r = await query<any>(
      `SELECT id, account_bucket, account_key, symbol, side, qty::text,
              COALESCE(initial_qty, qty)::text AS initial_qty,
              entry_price::text, sl::text, tp1::text, tp2::text,
              opened_at::text,
              tp1_filled_at IS NOT NULL AS tp1_filled,
              exit_reason, strategy
       FROM trades WHERE status = 'open' AND account_key = $1`,
      [accountKey]
    );
    return r.rows.map(toOpenTrade);
  }

  /** Open trades for a single pair across all accounts. */
  async openTradesForPair(symbol: string): Promise<OpenTrade[]> {
    const r = await query<any>(
      `SELECT id, account_bucket, account_key, symbol, side, qty::text,
              COALESCE(initial_qty, qty)::text AS initial_qty,
              entry_price::text, sl::text, tp1::text, tp2::text,
              opened_at::text,
              tp1_filled_at IS NOT NULL AS tp1_filled,
              exit_reason, strategy
       FROM trades WHERE status = 'open' AND symbol = $1`,
      [symbol]
    );
    return r.rows.map(toOpenTrade);
  }

  /** Most recent closed trades within the last `days` days. */
  async recentClosed(days: number): Promise<ClosedTrade[]> {
    const r = await query<any>(
      `SELECT id, symbol, side, account_bucket, account_key,
              qty::text, COALESCE(initial_qty, qty)::text AS initial_qty,
              entry_price::text, exit_price::text, sl::text,
              pnl_usd::text, realized_r::text, exit_reason,
              opened_at::text, closed_at::text
       FROM trades
       WHERE status = 'closed' AND closed_at >= NOW() - ($1 || ' days')::interval
       ORDER BY closed_at DESC`,
      [days]
    );
    return r.rows.map(toClosedTrade);
  }

  /** Trade by id (open OR closed). Null if not found. */
  async tradeById(id: number): Promise<ClosedTrade | null> {
    const r = await query<any>(
      `SELECT id, symbol, side, account_bucket, account_key,
              qty::text, COALESCE(initial_qty, qty)::text AS initial_qty,
              entry_price::text, exit_price::text, sl::text,
              pnl_usd::text, realized_r::text, exit_reason,
              opened_at::text, closed_at::text
       FROM trades WHERE id = $1`,
      [id]
    );
    return r.rows.length > 0 ? toClosedTrade(r.rows[0]) : null;
  }

  /**
   * Timestamp (epoch ms) of the most recent losing SL close for a pair, or null.
   * Used by risk-guard for post-SL cooldown.
   */
  async lastSlCloseTs(symbol: string): Promise<number | null> {
    const r = await query<{ ts: string }>(
      `SELECT EXTRACT(EPOCH FROM closed_at) * 1000 AS ts FROM trades
       WHERE symbol = $1 AND status = 'closed' AND realized_r < 0
         AND closed_at IS NOT NULL
       ORDER BY closed_at DESC LIMIT 1`,
      [symbol]
    );
    return r.rows[0]?.ts ? parseFloat(r.rows[0].ts) : null;
  }

  /**
   * Timestamp (epoch ms) of the most recent close (any reason) for a pair, or null.
   * Used by risk-guard for post-any-close cooldown.
   */
  async lastCloseTs(symbol: string): Promise<number | null> {
    const r = await query<{ ts: string }>(
      `SELECT EXTRACT(EPOCH FROM closed_at) * 1000 AS ts FROM trades
       WHERE symbol = $1 AND status = 'closed' AND closed_at IS NOT NULL
       ORDER BY closed_at DESC LIMIT 1`,
      [symbol]
    );
    return r.rows[0]?.ts ? parseFloat(r.rows[0].ts) : null;
  }

  /**
   * Count of UNIQUE losing SL events (side + second-rounded opened_at) for a pair
   * since `sessionStartMs`. Multi-account broadcast counts as one event.
   */
  async countSlInSession(symbol: string, sessionStartMs: number): Promise<number> {
    const r = await query<{ c: string }>(
      `SELECT COUNT(DISTINCT (side, date_trunc('second', opened_at)))::text AS c
       FROM trades
       WHERE symbol = $1 AND status = 'closed'
         AND closed_at IS NOT NULL AND EXTRACT(EPOCH FROM closed_at) * 1000 >= $2
         AND realized_r < 0`,
      [symbol, sessionStartMs]
    );
    return parseInt(r.rows[0]?.c ?? '0', 10);
  }

  /**
   * Count of DISTINCT entries opened (any status) since `sinceMs` (epoch ms). A
   * signal broadcast to N accounts at the same second counts as ONE entry. Used by
   * risk-guard for the rolling entry cap (RISK.maxEntriesPerWindow over
   * RISK.entryCapWindowHours).
   */
  async countEntriesSince(sinceMs: number): Promise<number> {
    const r = await query<{ c: string }>(
      `SELECT COUNT(DISTINCT (symbol, side, date_trunc('second', opened_at)))::text AS c
       FROM trades
       WHERE opened_at IS NOT NULL AND EXTRACT(EPOCH FROM opened_at) * 1000 >= $1`,
      [sinceMs]
    );
    return parseInt(r.rows[0]?.c ?? '0', 10);
  }
}

/** Module-default instance, exposed as ITradeRepository so callers cannot
 * accidentally reach concrete Postgres internals. Tests build their own
 * implementations and pass them where needed. */
export const tradeRepo: ITradeRepository = new TradeRepo();

function toOpenTrade(row: any): OpenTrade {
  return {
    id: row.id,
    account_bucket: row.account_bucket,
    account_key: row.account_key,
    symbol: row.symbol,
    side: row.side,
    qty: parseFloat(row.qty),
    initial_qty: parseFloat(row.initial_qty),
    entry_price: row.entry_price ? parseFloat(row.entry_price) : null,
    sl: row.sl ? parseFloat(row.sl) : null,
    tp1: row.tp1 ? parseFloat(row.tp1) : null,
    tp2: row.tp2 ? parseFloat(row.tp2) : null,
    opened_at: row.opened_at,
    tp1_filled: row.tp1_filled === true,
    exit_reason: row.exit_reason ?? null,
    strategy: row.strategy ?? null,
  };
}

function toClosedTrade(row: any): ClosedTrade {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    account_bucket: row.account_bucket,
    account_key: row.account_key,
    qty: parseFloat(row.qty),
    initial_qty: parseFloat(row.initial_qty),
    entry_price: row.entry_price ? parseFloat(row.entry_price) : null,
    exit_price: row.exit_price ? parseFloat(row.exit_price) : null,
    sl: row.sl ? parseFloat(row.sl) : null,
    pnl_usd: row.pnl_usd ? parseFloat(row.pnl_usd) : null,
    realized_r: row.realized_r ? parseFloat(row.realized_r) : null,
    exit_reason: row.exit_reason ?? null,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
  };
}
