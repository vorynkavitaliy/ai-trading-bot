import { db } from './index';

/** Strongly-typed repos. All methods are no-ops when DB is disabled. */

// ─── Trades ───

export interface InsertTradeInput {
  accountLabel: string;
  accountVolume: number;
  symbol: string;
  direction: 'Long' | 'Short';
  entryPrice: number;
  qty: number;
  stopLoss?: number;
  takeProfit?: number;
  rr?: number;
  riskPct?: number;
  riskUsd?: number;
  confluence?: number;
  regime?: string;
  orderId?: string;
  orderLinkId?: string;
  meta?: Record<string, any>;
}

export interface CloseTradeInput {
  tradeId: number;
  exitPrice: number;
  exitReason: string;
  pnlUsd: number;
  pnlPct: number;
  rMultiple?: number;
  feesUsd?: number;
}

export const TradeRepo = {
  async insert(t: InsertTradeInput): Promise<number | null> {
    const rows = await db.query<{ id: number }>(
      `INSERT INTO trades
       (account_label, account_volume, symbol, direction, entry_price, qty,
        stop_loss, take_profit, rr, risk_pct, risk_usd, confluence, regime,
        order_id, order_link_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        t.accountLabel, t.accountVolume, t.symbol, t.direction, t.entryPrice, t.qty,
        t.stopLoss ?? null, t.takeProfit ?? null, t.rr ?? null,
        t.riskPct ?? null, t.riskUsd ?? null, t.confluence ?? null, t.regime ?? null,
        t.orderId ?? null, t.orderLinkId ?? null, t.meta ? JSON.stringify(t.meta) : null,
      ]
    );
    return rows[0]?.id ?? null;
  },

  async close(c: CloseTradeInput): Promise<void> {
    await db.query(
      `UPDATE trades
         SET closed_at = NOW(),
             exit_price = $2,
             exit_reason = $3,
             pnl_usd = $4,
             pnl_pct = $5,
             r_multiple = $6,
             fees_usd = $7
       WHERE id = $1`,
      [c.tradeId, c.exitPrice, c.exitReason, c.pnlUsd, c.pnlPct, c.rMultiple ?? null, c.feesUsd ?? null]
    );
  },

  async openByOrderId(orderId: string) {
    return db.one(
      `SELECT * FROM trades WHERE order_id = $1 AND closed_at IS NULL`,
      [orderId]
    );
  },

  async openForAccountSymbol(accountLabel: string, symbol: string) {
    return db.one(
      `SELECT * FROM trades
       WHERE account_label = $1 AND symbol = $2 AND closed_at IS NULL
       ORDER BY opened_at DESC LIMIT 1`,
      [accountLabel, symbol]
    );
  },

  async listOpen() {
    return db.query(`SELECT * FROM trades WHERE closed_at IS NULL ORDER BY opened_at DESC`);
  },

  async dailyPnl(accountLabel: string) {
    const r = await db.one<{ total: string }>(
      `SELECT COALESCE(SUM(pnl_usd),0)::text AS total FROM trades
       WHERE account_label = $1
         AND closed_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')`,
      [accountLabel]
    );
    return Number(r?.total ?? 0);
  },
};

// ─── Equity / DD tracking ───

export const EquityRepo = {
  async snapshot(accountLabel: string, accountVolume: number, equity: number, available: number, upnl: number) {
    await db.query(
      `INSERT INTO equity_snapshots (account_label, account_volume, equity, available, unrealised_pnl)
       VALUES ($1,$2,$3,$4,$5)`,
      [accountLabel, accountVolume, equity, available, upnl]
    );
  },

  /** Upsert today's daily peak — used for trailing 5% daily DD calculation */
  async upsertDailyPeak(accountLabel: string, equity: number) {
    await db.query(
      `INSERT INTO daily_peaks (account_label, utc_day, peak_equity, start_equity)
       VALUES ($1, (NOW() AT TIME ZONE 'UTC')::date, $2, $2)
       ON CONFLICT (account_label, utc_day)
       DO UPDATE SET peak_equity = GREATEST(daily_peaks.peak_equity, EXCLUDED.peak_equity)`,
      [accountLabel, equity]
    );
  },

  async getDailyPeak(accountLabel: string): Promise<{ peak: number; start: number } | null> {
    const r = await db.one<{ peak_equity: string; start_equity: string }>(
      `SELECT peak_equity, start_equity FROM daily_peaks
       WHERE account_label = $1 AND utc_day = (NOW() AT TIME ZONE 'UTC')::date`,
      [accountLabel]
    );
    if (!r) return null;
    return { peak: Number(r.peak_equity), start: Number(r.start_equity) };
  },
};

// ─── Audit log ───

export type AuditLevel = 'info' | 'warn' | 'error' | 'critical';

export const AuditRepo = {
  async log(params: {
    level: AuditLevel;
    source: string;
    event: string;
    accountLabel?: string;
    symbol?: string;
    message?: string;
    payload?: Record<string, any>;
  }) {
    await db.query(
      `INSERT INTO audit_log (level, source, event, account_label, symbol, message, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        params.level, params.source, params.event,
        params.accountLabel ?? null, params.symbol ?? null,
        params.message ?? null,
        params.payload ? JSON.stringify(params.payload) : null,
      ]
    );
  },
};

// ─── Signals ───

export interface SignalRecord {
  symbol: string;
  direction: 'Long' | 'Short' | 'None';
  confluence: number;
  regime?: string;
  scores?: Record<string, any>;
  executed: boolean;
  rejectReason?: string;
}

// SignalRepo removed 2026-04-22 — audit rolled into AuditRepo.log.
// The `signals` DB table is kept for historical v1 records; no new writes.
