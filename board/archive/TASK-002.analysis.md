---
task: TASK-002
author: architect
created: 2026-05-24T09:00:39Z
iteration: 0
---

## Summary

CLAUDE.md flags reconcile riskedUsd as using `t.qty` (post-TP1 remaining qty), which would inflate `realized_r` ~2× on TP1-partial trades. Verification: **the bug is already fixed**. Two independent fixes are in place — (1) the original direct patch (`369f54a` 2026-05-23) replaced `t.qty` with `t.initial_qty` inline, and (2) the subsequent `Position` state-machine refactor (`4826ee6`) encapsulated the calc inside `Position.riskedUsd()`, which structurally cannot consume `current_qty`. Recommendation: close TASK-002 as **verified done**, update CLAUDE.md to remove the stale "known outstanding issue" entry.

## Map of territory

### `src/runtime/reconcile.ts` — the R-calc site (now line 157, was line 188 pre-refactor)

The current `autoCloseTrade()` computes pnlR via `Position`:

```ts
// src/runtime/reconcile.ts:153-158
const exitReason = inferExitReason(t, wAvgExit);
// Position.riskedUsd() always uses initial_qty (encapsulated invariant).
// Eliminates the t.qty vs initial_qty bug class entirely — callers can no
// longer access qty for risk math.
const riskedUsd = Position.fromOpenTrade(t).riskedUsd();
const pnlR = riskedUsd > 0 ? totalPnl / riskedUsd : 0;
```

All other uses of `t.qty` / `match.qty` in reconcile are operational (close-ratio guards, dust-vs-initial ratio logs, size_mismatch divergence struct), not risk math:

- `reconcile.ts:139` — `closeRatio = totalClosedSize / t.qty` (legitimate: gating on remaining qty)
- `reconcile.ts:254, 260, 263` — logging `match.initial_qty` vs `pos.size`
- `reconcile.ts:289` — size_mismatch divergence reports `db_qty: match.qty` (correctly reports remaining)

### `src/core/position.ts` — the encapsulated invariant

```ts
// src/core/position.ts:90-106
static fromOpenTrade(t: OpenTrade): Position {
  return new Position({
    id: t.id,
    ...
    initialQty: t.initial_qty,   // ← sourced from initial_qty column
    currentQty: t.qty,
    ...
  });
}

// src/core/position.ts:152-161
/**
 * Dollar risk based on initial qty × stop distance. Always uses initial_qty —
 * never current_qty. This is the field whose abuse caused realized_r inflation
 * on TP1-partial trades; encapsulating it here means no caller can recreate
 * the bug.
 */
riskedUsd(): number {
  if (this.entryPrice === null || this.sl === null) return 0;
  return Math.abs(this.entryPrice - this.sl) * this.initialQty;
}
```

`current_qty` is stored on the instance but unreachable from any risk-math API surface. The class header itself cites the bug (`position.ts:7-11`) as the motivation for the refactor.

### `src/data/trade-repo.ts` — schema-level safety net

Every `OpenTrade`-returning query uses `COALESCE(initial_qty, qty)::text AS initial_qty` (lines 73, 86, 100, 114, 130) — so legacy rows from before migration 005 still produce a non-null `initial_qty` equal to `qty` (which is correct for those rows: they predate TP1-partial tracking, so `qty` never mutated).

### `src/runtime/position-watcher.ts` — the second R-calc site

The TP1-fill inline pnlR at line 370 uses `pos.dbInitialQty` (set from `db.initial_qty` at line 106):

```ts
// src/runtime/position-watcher.ts:366-371
grp.fills.push({
  label: accountLabel,
  qty: filledQty,
  pnlUsd: realizedPnl,
  pnlR: realizedPnl / Math.max(Math.abs(pos.entryPrice - pos.dbInitialSL) * pos.dbInitialQty, 1),
});
```

This is consistent with the reconcile path. Both denominators use `entry_price × initial_qty × stop_distance`.

### `migrations/005_tp1_fill_tracking.sql` — DB column

```sql
ALTER TABLE trades ADD COLUMN IF NOT EXISTS initial_qty NUMERIC(28, 8);
UPDATE trades SET initial_qty = qty WHERE initial_qty IS NULL AND status = 'open';
```

In place. Migration also backfills open trades.

### Git history — fix chain

```
369f54a  fix(reconcile): use initial_qty for riskedUsd calc + backfill historic R  (2026-05-23, original fix)
4826ee6  refactor(core): introduce Position state-machine (OOP)                    (encapsulation refactor)
d41e129  refactor(core): add 4 abstractions, eliminate 4 sources of truth (DRY)
f50d901  refactor(runtime): extract NakedTpRecovery and DivergenceDetector (SRP)
6e482d7  refactor(risk+data): introduce ITradeRepository + RiskManager (DIP)
```

Commit `369f54a` is the canonical fix. Its commit body explicitly references the BNB 2026-05-19 trade (recorded R 1.79 vs correct 0.90) and reports 3 LTC rows backfilled. The subsequent `4826ee6` refactor moved the inline calc behind `Position.riskedUsd()` so the bug class is structurally extinct.

### Backfill tool

`src/tools/admin/backfill-realized-r.ts` exists (2963 bytes, dated 2026-05-23). Per the fix commit body, it ran once on 2026-05-23 and updated 3 LTCUSDT rows. Idempotent via `--dry-run` per the commit message.

## Findings

**Scenario A — bug is not present.** Three independent layers of defense:

1. **Direct fix in reconcile.ts** (commit `369f54a`): `stopDist * t.qty` → `stopDist * t.initial_qty`. CLAUDE.md's line reference "reconcile.ts:188" is also stale — after subsequent refactors the risk-calc site moved to line 157.

2. **Encapsulation in Position class** (commit `4826ee6`): the calc now lives behind `Position.riskedUsd()`; callers cannot pass `current_qty` even if they wanted to. The class's own doc comment names the bug it eradicates.

3. **Repository-layer COALESCE** (`trade-repo.ts`): even pre-migration-005 legacy rows return a non-null `initial_qty` (= `qty`), so no NaN/zero leak path.

The historic data fix (backfill) has also been executed per the commit message. Live `realized_r` values produced from 2026-05-23 onwards are correct.

## Recommendation

**Close TASK-002 as `done`.** No code change required.

Follow-up housekeeping (outside this task's scope, suggest separate task):

- **Update `CLAUDE.md`** to remove the "Known outstanding issues" bullet referencing `reconcile.ts:188`. The current text is stale — both the line number and the bug itself. Replace with a single-line note in the v4 history section if any record is wanted.
- Optional: verify backfill idempotency by running `src/tools/admin/backfill-realized-r.ts --dry-run` once (commit body claims 0 changes on re-run). Not blocking.

## Open questions

None.

## Dev brief

No dev work needed. The architect's recommendation to orchestrator is to mark TASK-002 status `done`, archive the task, and (optionally) spin a tiny follow-up to scrub the stale CLAUDE.md reference. If the operator wants formal proof beyond code citations, the tester agent can run `npx tsx src/tools/admin/backfill-realized-r.ts --dry-run` and confirm zero rows updated.
