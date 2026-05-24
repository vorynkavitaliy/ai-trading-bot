/**
 * Unified bar loader used by runtime, backtest and diagnostics.
 *
 * Replaces 7 near-identical loadBars() copies (scan-decide, structure-watch,
 * backtest/engine, strategy-signal-trace, cg-tier1-portfolio,
 * cg-pair-strategy-sweep, loss-cluster, trade-postmortem-yesterday). Each had
 * subtle differences in ordering, return shape, and time-range handling that
 * caused historical-vs-live divergence on edge cases.
 */

import { query } from '../core/db';
import { Bar } from '../backtest/types';

export interface LoadBarsOpts {
  /** Max bar count to return. Required unless `fromTs`+`toTs` provided. */
  limit?: number;
  /** Inclusive start of range (epoch ms). Used with `toTs` for window load. */
  fromTs?: number;
  /** Inclusive end of range (epoch ms). Used with `fromTs` for window load. */
  toTs?: number;
  /** Return only bars with ts ≤ this. Used with `limit` for "last N before T" load. */
  beforeTs?: number;
}

/**
 * Loads OHLCV bars from the `candles` table in chronological order (oldest first).
 *
 * Three call patterns:
 *   loadBars(symbol, tf, { limit: 300 })                       — last 300 bars
 *   loadBars(symbol, tf, { limit: 300, beforeTs: T })          — last 300 bars at or before T
 *   loadBars(symbol, tf, { fromTs: A, toTs: B })               — full range A..B
 */
export async function loadBars(
  symbol: string,
  tf: string,
  opts: LoadBarsOpts,
): Promise<Bar[]> {
  const params: any[] = [symbol, tf];
  let where = `WHERE symbol = $1 AND tf = $2`;

  if (opts.fromTs !== undefined && opts.toTs !== undefined) {
    params.push(opts.fromTs, opts.toTs);
    where += ` AND ts >= $3 AND ts <= $4`;
    const sql = `SELECT ts::text, open, high, low, close, volume
                 FROM candles ${where}
                 ORDER BY ts ASC`;
    const r = await query<any>(sql, params);
    return r.rows.map(toBar);
  }

  if (opts.beforeTs !== undefined) {
    params.push(opts.beforeTs);
    where += ` AND ts <= $3`;
  }
  const limit = opts.limit ?? 300;
  params.push(limit);
  const sql = `SELECT ts::text, open, high, low, close, volume
               FROM candles ${where}
               ORDER BY ts DESC
               LIMIT $${params.length}`;
  const r = await query<any>(sql, params);
  return r.rows.map(toBar).reverse();
}

function toBar(row: any): Bar {
  return {
    ts: parseInt(row.ts, 10),
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseFloat(row.volume),
  };
}
