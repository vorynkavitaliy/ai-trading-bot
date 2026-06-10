/**
 * DB-persisted once-per-4H-anchor decision latch for v5 strategies.
 *
 * The validated srcNew engine decides exactly ONCE per (pair, closed 4H bar) —
 * a blocked signal is consumed and never retried until the next boundary
 * (srcNew/backtest/portfolio-engine.ts, srcNew/live/cycle.ts lastDecisionBarTs).
 * Live scan-decide runs hourly with the SAME anchor bar for all 4 scans inside
 * a 4H window, so without this latch a transiently-blocked signal re-fires at
 * +1/+2/+3h and enters on a stale anchor — trades the validated engine never made.
 *
 * Persistence is DB-backed because every cron tick is a fresh `npx tsx` fork
 * (same failure mode as strategy_cooldowns — see src/core/strategy-cooldowns.ts).
 *
 * Both helpers never throw: a DB hiccup degrades to pre-latch behavior (hourly
 * re-evaluation) instead of blocking the scan cycle.
 */
import { query } from './db';
import { log } from './logger';

export type DecidedAnchors = Map<string, number>;

export async function loadDecidedAnchors(): Promise<DecidedAnchors> {
  const state: DecidedAnchors = new Map();
  try {
    const { rows } = await query<{ pair: string; anchor_ts: string }>(
      `SELECT pair, anchor_ts FROM decided_anchors`
    );
    for (const r of rows) {
      const ts = Number(r.anchor_ts);
      if (Number.isFinite(ts)) state.set(r.pair, ts);
    }
  } catch (err: any) {
    log.warn('decided-anchors loadAll failed — falling back to hourly re-evaluation', {
      err: err?.message ?? String(err),
    });
  }
  return state;
}

export async function recordDecidedAnchor(pair: string, anchorTs: number): Promise<void> {
  try {
    await query(
      `INSERT INTO decided_anchors (pair, anchor_ts, decided_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (pair)
       DO UPDATE SET anchor_ts = EXCLUDED.anchor_ts, decided_at = NOW()
       WHERE decided_anchors.anchor_ts < EXCLUDED.anchor_ts`,
      [pair, anchorTs],
    );
  } catch (err: any) {
    log.warn('decided-anchors record failed', {
      pair, anchorTs, err: err?.message ?? String(err),
    });
  }
}
