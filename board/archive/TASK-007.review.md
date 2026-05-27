---
task: TASK-007
reviewer: code-reviewer
iteration: 2
reviewed_at: 2026-05-27T09:49:48Z
tally: { important: 0, nit: SUPPRESSED, pre_existing: SUPPRESSED }
verdict: APPROVED
---

# TASK-007 Re-Review iter 2

## Verdict
Approved → testing. The single iter-1 Important (unguarded reconcile promotion) is fixed in `eeb6eed`. No new Important introduced.

## Important fix verification

iter-1 Important #1 — `reconcile.ts` Phase-A promotion call unguarded → DB throw aborts the whole reconcile cycle (process.exit(1)), skipping Phase-B close journaling; violates inviolable Rule 4.

Verified against `eeb6eed` (`reconcile.ts:131-147`):

- **Wrapped?** Yes. `try` (`:131`) now encloses both `findUnpromotedPending` and `promotePendingToTrade`.
- **Logged, not silent?** Yes. `catch` (`:143`) calls `log.warn('pending promotion failed during reconcile; falling through to bybit_without_db', { account, symbol, side, err: e?.message })`. Context-rich, no swallow.
- **Fall-through on throw?** Yes. The `continue` is inside the `try` (`:141`) and only fires after a successful match. On throw, control exits the catch and reaches `:149` `divergences.push({ type: 'bybit_without_db', ... })` — the pre-existing behavior the architect spec mandated (analysis.md:258). Exception does not propagate; cycle is not aborted.
- **Phase-B protected?** Yes. Because Phase-A no longer escapes to `process.exit(1)`, the close-journaling loop and `confirmedEntries` notifications (`:261-264`) are reached on a promotion-DB failure.
- **Pattern consistent?** Yes. Matches the `} catch (e: any) { log.warn(..., { ..., err: e?.message }) }` shape already used by the dust-close guard (`:185-187`), the stale-orphan sweep (`:73,:83,:288`), and the daemon promotion path (account-monitor.ts).

## New Important (if any)

None.

- catch scope is tight — wraps only the promotion attempt, not the surrounding loop; no over-broad swallow.
- `bybit_without_db` divergence is still pushed on both the no-pending path and the throw path; no divergence is dropped.
- `continue` placement unchanged (success-only), so the catch-net semantics are preserved.
- `npx tsc --noEmit`: clean.
- Commit touches **only** `src/runtime/reconcile.ts` (+15/-9). No operator WIP, no `cycle.sh`. Clean scope.

## Summary

Surgical, on-spec fix. The promotion attempt is now isolated; a transient DB error degrades to a logged `bybit_without_db` divergence instead of killing the cycle, restoring the Rule-4 invariant. Pattern matches the established guards in the same file. Typecheck clean, scope clean. Approved for testing.
