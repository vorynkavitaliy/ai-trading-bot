/**
 * Max-hold (time-stop) enforcer — cron, every 5 min via scripts/cycle.sh.
 *
 * The validated v5 backtest force-closes every position at entry + maxHoldBars × 4H
 * (srcNew portfolio-engine 'time' exits; live config maxHoldBars=12 → 48h). Until
 * 2026-06-10 NOTHING in the live runtime enforced this — positions that hit neither
 * SL nor TP rode indefinitely, diverging from the validated exit distribution
 * (stale fade theses ride to full SL instead of being cut at 48h).
 *
 * Scope guard: acts ONLY on trades attributable to a strategy —
 *   - trades.strategy matching cg-slow-fade-v5 (hold horizon read from the live
 *     pair config when available), or
 *   - strategy IS NULL with the auto-execute rationale prefix '[auto]' (covers the
 *     rare daemon-promoted row that lost its strategy tag) at the default 48h.
 * Operator/manual trades (strategy NULL, no '[auto]' prefix) are NEVER touched.
 *
 * Mechanics: pre-tag exit_reason='time_stop' on the open rows, then close the Bybit
 * positions via closeAcrossAccounts (market reduce-only, verified, per-symbol order
 * cancel). The WS daemon / reconcile catch-net then finalize the DB rows through
 * autoCloseTrade, which preserves the pre-tagged reason and sends ONE consolidated
 * Telegram («Причина: Таймаут»). Idempotent: if anything fails mid-way, the trade
 * is still open and >48h old on the next 5-min tick, so the whole flow re-runs.
 * Runs even while PAUSE.md exists — the pause halts ENTRIES, never exits.
 */
import { loadAccounts } from '../core/accounts';
import { closeAcrossAccounts } from '../core/close-verifier';
import { query, close as closePg } from '../core/db';
import { log } from '../core/logger';
import { getStrategyForPair } from './pair-strategies';
import { CgSlowFade } from '../strategies/cg-slow-fade';

const FOUR_H_MS = 4 * 3600_000;
const DEFAULT_MAX_HOLD_MS = 12 * FOUR_H_MS;
const V5_PREFIX = 'cg-slow-fade-v5';

interface OverdueRow {
  id: number;
  symbol: string;
  strategy: string | null;
  rationale: string | null;
  opened_at: string;
  age_ms: string;
}

function maxHoldMsForSymbol(symbol: string): number {
  const s = getStrategyForPair(symbol);
  if (s instanceof CgSlowFade) return s.p.maxHoldBars * FOUR_H_MS;
  return DEFAULT_MAX_HOLD_MS;
}

export async function enforceMaxHold(): Promise<{ closedSymbols: string[]; overdueTrades: number }> {
  // Age from SIGNAL time, not fill time (srcNew parity: maxHoldUntilTs = placedTs +
  // 12×4H). A resting limit can fill up to 230 min after placement — counting from
  // opened_at would hold those up to ~4h longer than the validated engine.
  // pending_orders.requested_at is the placement timestamp; market entries fill
  // within seconds of it, and trades without a linked pending row fall back to
  // opened_at.
  const { rows } = await query<OverdueRow>(
    `SELECT t.id, t.symbol, t.strategy, t.rationale, t.opened_at::text,
            (EXTRACT(EPOCH FROM (NOW() - COALESCE(po.placed_at, t.opened_at))) * 1000)::text AS age_ms
     FROM trades t
     LEFT JOIN LATERAL (
       SELECT MIN(requested_at) AS placed_at
         FROM pending_orders
        WHERE trade_id = t.id
     ) po ON TRUE
     WHERE t.status = 'open'
       AND (t.strategy LIKE $1 OR (t.strategy IS NULL AND t.rationale LIKE '[auto]%'))`,
    [`${V5_PREFIX}%`],
  );

  const overdue = rows.filter((r) => parseFloat(r.age_ms) >= maxHoldMsForSymbol(r.symbol));
  if (overdue.length === 0) return { closedSymbols: [], overdueTrades: 0 };

  const bySymbol = new Map<string, OverdueRow[]>();
  for (const r of overdue) {
    const arr = bySymbol.get(r.symbol) ?? [];
    arr.push(r);
    bySymbol.set(r.symbol, arr);
  }

  const accounts = loadAccounts();
  const closedSymbols: string[] = [];

  for (const [symbol, trades] of bySymbol) {
    const ids = trades.map((t) => t.id);
    const ageH = Math.round(parseFloat(trades[0].age_ms) / 3600_000);
    log.info('max-hold: time-stop triggered', {
      symbol, ids, ageHours: ageH,
      maxHoldHours: maxHoldMsForSymbol(symbol) / 3600_000,
    });

    await query(
      `UPDATE trades SET exit_reason = 'time_stop'
       WHERE id = ANY($1) AND status = 'open'`,
      [ids],
    );

    const result = await closeAcrossAccounts(accounts, symbol, {
      reason: `time_stop: held ${ageH}h ≥ max ${maxHoldMsForSymbol(symbol) / 3600_000}h`,
    });
    const ok = result.attempts.every((a) => a.status === 'ok' || a.status === 'no_position' || a.status === 'dust_below_min');
    if (ok) {
      closedSymbols.push(symbol);
      log.info('max-hold: positions closed, daemon/reconcile will finalize DB rows', { symbol, ids });
    } else {
      log.error('max-hold: close incomplete — will retry next 5-min tick', {
        symbol,
        attempts: result.attempts.map((a) => `${a.account}:${a.status}(final=${a.finalSize})`),
      });
    }
  }

  return { closedSymbols, overdueTrades: overdue.length };
}

async function main() {
  const res = await enforceMaxHold();
  if (res.overdueTrades > 0) {
    console.log(`max-hold: overdue=${res.overdueTrades} closedSymbols=${res.closedSymbols.join(',') || 'none'}`);
  } else {
    console.log('max-hold: nothing overdue');
  }
  await closePg();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (e) => {
      log.error('max-hold failed', { err: e?.message ?? String(e), stack: e?.stack });
      try { await closePg(); } catch {}
      process.exit(1);
    });
}
