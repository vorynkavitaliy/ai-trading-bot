/**
 * DB-persisted same-direction strategy cooldown state.
 *
 * Background: cg-fade strategies enforce a `cooldownHours` (default 6) gate that
 * blocks re-entry into the SAME (symbol, side) within N hours of the last entry.
 * The in-process Map in cg-fade.ts is empty on every cron tick (scan-decide is a
 * fresh process every 5 min), so live execution never honored the gate.
 *
 * Surface:
 *   - `loadAll()`: read the whole table into a Map keyed by symbol. Same shape as
 *     the legacy in-process Map (`Map<symbol, { side, ts }>`). Called ONCE per
 *     scan-decide cycle, before the per-pair loop.
 *   - `recordEntry()`: UPSERT after a successful entry build. Fire-and-forget
 *     from the caller; this helper itself does NOT throw — it logs and swallows
 *     errors so DB hiccups never block a live entry.
 *
 * Notes on shape:
 *   The legacy Map keyed by symbol stored only the LAST entry (across both sides
 *   — a fresh long replaces a recorded short). We preserve that exact semantics
 *   in `loadAll()` so strategy behavior is unchanged: for each (symbol, side)
 *   row in DB, we keep the one with the largest `last_entry_ts` per symbol.
 *   The table stores both sides so we never lose history when sides alternate,
 *   but the strategy's `inCooldown(symbol, side, ...)` check only cares about
 *   the most recent record for that symbol.
 */
import { query } from './db';
import { log } from './logger';

export type CooldownEntry = { side: 'long' | 'short'; ts: number };
export type CooldownState = Map<string, CooldownEntry>;

interface CooldownRow {
  symbol: string;
  side: 'long' | 'short';
  last_entry_ts: string;  // pg BIGINT comes back as string
}

/**
 * Load the whole strategy_cooldowns table into a Map keyed by symbol.
 * For each symbol, keep the entry with the most recent `last_entry_ts` across
 * sides — matches the legacy in-process Map semantics.
 *
 * Never throws. On DB failure logs a warn and returns an empty Map (strategy
 * then behaves as if no cooldown was active for that cycle — same as today).
 */
export async function loadAll(): Promise<CooldownState> {
  const state: CooldownState = new Map();
  try {
    const { rows } = await query<CooldownRow>(
      `SELECT symbol, side, last_entry_ts FROM strategy_cooldowns`
    );
    for (const r of rows) {
      const ts = Number(r.last_entry_ts);
      if (!Number.isFinite(ts)) continue;
      const existing = state.get(r.symbol);
      if (!existing || ts > existing.ts) {
        state.set(r.symbol, { side: r.side, ts });
      }
    }
  } catch (err: any) {
    log.warn('strategy-cooldowns loadAll failed — treating cycle as no-cooldown', {
      err: err?.message ?? String(err),
    });
  }
  return state;
}

/**
 * UPSERT a fresh entry on (symbol, side). Never goes backwards: if the stored
 * `last_entry_ts` is already >= the new ts, the row is left alone.
 *
 * Fire-and-forget from the caller. Swallow all errors here — a DB outage must
 * NOT block a live entry being built by the strategy.
 */
export async function recordEntry(
  symbol: string,
  side: 'long' | 'short',
  ts: number,
): Promise<void> {
  try {
    await query(
      `INSERT INTO strategy_cooldowns (symbol, side, last_entry_ts, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (symbol, side)
       DO UPDATE SET last_entry_ts = EXCLUDED.last_entry_ts, updated_at = NOW()
       WHERE strategy_cooldowns.last_entry_ts < EXCLUDED.last_entry_ts`,
      [symbol, side, ts],
    );
  } catch (err: any) {
    log.warn('strategy-cooldowns recordEntry failed', {
      symbol, side, ts, err: err?.message ?? String(err),
    });
  }
}
