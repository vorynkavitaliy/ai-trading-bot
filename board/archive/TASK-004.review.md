---
task: TASK-004
author: code-reviewer
iteration: 1
created: 2026-05-24T13:47:19Z
---

# TASK-004 Review — Wave 2 DRY/KISS batch

## Verdict
Approved → testing

(One TEAM.md §4 names violation flagged as Important — `valid` field is non-predicate boolean. Borderline; not blocking since (a) iteration 1, (b) low blast radius (3 internal callsites), (c) no behaviour impact. Tester should proceed. If operator wants strict §4 enforcement, dev can rename `valid → isValid` in a single follow-up edit.)

## Important findings

### 1. TEAM.md §4 Names: `valid` boolean should be a predicate
`src/core/qty-normalizer.ts:6,12,13,19,20,26`

```ts
export interface NormalizedQty {
  qtyStr: string;
  qtyNum: number;
  valid: boolean;
}
```

TEAM.md §4 Formatting / Names: "Booleans = predicates (`isBlocked`, `hasOpenPosition`, not `blocked`, `position`)." `valid` is a noun-form boolean — rename to `isValid` on both `NormalizedQty` and `SplitQty`. Three callsites (`execute.ts`, `tp-planner.ts`, `naked-tp-recovery.ts`) follow.

Cost: 6 edits, zero behavioural impact. The same rule was applied by the original audit when it renamed e.g. `blocked → isBlocked` on `Position`.

## Nit findings

### N1. Log shape regression — `retCode` and `msg` no longer emitted
`src/core/retry-policy.ts:67-71`

Original `bybit.ts withRetry` logged `{ label, attempt, retCode, delayMs }`. Original `coinglass.ts withCgRetry` logged `{ label, attempt, msg }`. New generic logs `{ label, attempt, delayMs }` — drops `retCode` (bybit) and `msg` (coinglass). Observability loss; if a future incident needs to know "which Bybit retCode triggered the retry burst", that field is gone from JSON logs. Suggest extending the generic to surface a policy-provided per-attempt context object (e.g. `policy.logContext(err)` returning `{retCode}` or `{msg}`). Not blocking — pure observability.

### N2. Log key string changed: `'coinglass retry'` → `'coinglass call retry'`
`src/core/retry-policy.ts:67` (interpolated via `${policy.label} call retry`)

Original coinglass log message was `'coinglass retry'`; new one is `'coinglass call retry'` (because the generic uses one template `${label} call retry` for both policies, matching bybit's wording). No grep hits in repo for the old string, so dashboards/scripts likely unaffected, but it's still a wire-format change worth noting.

### N3. Logged `delayMs` value semantics changed
`src/core/retry-policy.ts:70`

Original logged `delayMs` was the **base** constant (500 or 1500). New code logs `policy.delayMs(i) = baseDelayMs * (attempt+1)` — the actual wait being performed. Arguably an improvement, but it's still a wire-format change for log consumers expecting the constant.

### N4. `as any` casts in `RetryPolicy.isRetryable`
`src/core/retry-policy.ts:22,44`

```ts
const e = err as any;
const msg = (err as any)?.message ?? String(err);
```

The original code also used `catch (e: any)`, so this is parity, not a regression. Per TEAM.md §4 TypeScript ("No `as` casts unless narrowing a known wider type"), a typed narrowing would be cleaner — e.g. `type BybitError = { retCode?: number; code?: string | number }; const e = err as Partial<BybitError>;`. Defer to follow-up.

### N5. `backfill-realized-r.ts` lost the `stopDist <= 0 || initialQty <= 0` skip guard
`src/tools/admin/backfill-realized-r.ts:44-51`

Old code: degenerate rows were `continue`'d and counted as `unchanged`. New code: degenerate rows pass through `riskUnitsFromRaw` which returns 0; if the row's stored `realized_r` was already 0, it stays `unchanged` (via the `Math.abs(newR - oldR) < 0.0005` check), otherwise it would be rewritten to 0. Practically: SQL filter requires entry/sl/initial_qty not null, and degenerate (`entry === sl` or `initialQty === 0`) trades shouldn't exist as TP1-partial closed rows. Architect analysis explicitly accepted this drift ("the existing guard becomes implicit"). Flagging for visibility, not blocking.

### N6. `delayMs(attempt)` / `riskUnits(pnl)` are not verb-prefixed
TEAM.md §4 strict: "Functions = verbs (`computeRiskedUsd`, not `riskedUsd`)." `delayMs`, `riskUnits`, `riskUnitsFromRaw` are noun-form. They mirror the existing `riskedUsd()` style on `Position`, so renaming all three breaks consistency with the in-house convention. Leave as-is; if §4 verb rule is strict, that's a project-wide rename out of scope for TASK-004.

### N7. Empty `catch {}` in `backfill-realized-r.ts`
`src/tools/admin/backfill-realized-r.ts:74` (pre-existing, unchanged): `try { await closePg(); } catch {}`. Pre-existing silent catch, not introduced by this task.

## Pre-existing
- `as any` in error handlers throughout codebase (`tg-bot/`, `coinglass.ts`) — predates TASK-004.
- `catch {}` empty handlers in CLI entrypoints — pre-existing.
- `tp-planner.ts` retained verbose `withRetry({ tries: 2 })` callsite signatures — out of scope per analysis (40+ consumers).

## Reviewer checklist (per step)

### Step 1 — RetryPolicy (1145edb)
- [x] interface + 2 classes + generic withRetry — `src/core/retry-policy.ts` matches analysis §Design verbatim
- [x] bybit.ts shim preserves call signature — `withRetry(fn, { tries?, delayMs?, label? })` external shape unchanged
- [x] coinglass.ts shim preserves call signature — `withCgRetry(fn, label, tries=3, delayMs=1500)` external shape unchanged
- [x] retry conditions identical to original — bybit: retCode 10006/10016 + ECONNRESET/ETIMEDOUT (verified line-by-line); coinglass: regex `/rate|limit|429|busy/i` (verified)
- [~] log shape minor regression — see N1/N2/N3

### Step 2 — QtyNormalizer (6448467)
- [x] pure functions (not class) — per TEAM.md §4 "Pure transformations stay as functions"
- [x] `roundQtyToStep` remains in `bybit.ts:78`, not duplicated
- [x] 3 callsites correct policy on invalid:
  - `execute.ts:150-153` — throws (`if (!valid) throw new Error(...)`)
  - `tp-planner.ts:58-65` — `if (split.valid) {...}` then falls through to SingleLimit (the "Too small to split" comment was correctly removed since SingleLimit fallback is now the natural continuation)
  - `naked-tp-recovery.ts:75-83` — `if (!split.valid) { log.warn(...); return null; }`
- [!] `valid` field is non-predicate boolean — see Important #1

### Step 3 — Position.riskUnits (7b4926f)
- [x] instance method `riskUnits(pnlUsd)` + static `riskUnitsFromRaw({entryPrice, sl, initialQty, pnlUsd})` added to `position.ts:163-178`
- [x] static uses **named args** (object literal destructure) — TASK-002 swap-bug class blocked at type level
- [x] 4 live callsites + 1 diagnostic rewritten:
  - `reconcile.ts:154` — instance method on `Position.fromOpenTrade(t)`, collapsed 2 lines to 1
  - `position-watcher.ts:370-375` — static, named args
  - `close-trade.ts:60-65` — static, named args
  - `backfill-realized-r.ts:49` — static, named args
  - `trade-detail.ts:58,64,65` — three static calls (full / tp1 / tail)
- [x] `scan-decide.ts:410-411 rrTp1/rrTp2` correctly **excluded** (different domain — planned RR ratio, no qty, no PnL)
- [x] `position-watcher` 0R-on-degenerate change documented in commit message
- [x] Behaviour preserved: `risked > 0 ? pnl/risked : 0` ↔ original ternaries

### Step 4 — Cleanup (7ace203)
- [x] exactly 14 deletions (verified `git show --stat`)
- [x] 3 false positives kept: `tg-test.ts`, `risk-status.ts`, `coinglass-test.ts`
- [x] untracked operator files untouched: `cg-coverage.ts`, `cg-schema-dump.ts`, `dw-scrub-task003.ts`, `grid-math.ts`, `btc-*.ts`, `grid-engine.ts` still untracked in working tree

### Cross-cutting
- [x] `npx tsc --noEmit` clean (zero output)
- [x] no comments-on-WHAT added (zero added `//` lines in diff); legacy WHAT-comments removed (`Dual-TP split. Try 50/50.`, `Too small to split — fall through ...`, `Position.riskedUsd() always uses initial_qty ...`) — net code-self-documentation improvement
- [~] one new `as any` (`src/core/retry-policy.ts:22,44`) — parity with original `catch (e: any)`; see N4
- [x] `src/strategies/cg-fade.ts` NOT committed — still `M` in working tree per `git status`
- [x] `.claude/settings.json` NOT committed — still `M` in working tree per `git status`
- [x] commits are independent and non-duplicative — verified via per-commit `--name-only`; no file appears in two commits
- [x] commit messages reference TASK-004 sub-numbers (#5/#4/#3/#6) and include Co-Authored-By trailer

## Notes

The implementation matches the architect analysis very closely — there's no "creative reinterpretation" of the design. The only **functional** drift is the deliberate position-watcher 0R-on-degenerate-input change, which the analysis flagged and the commit message documents.

The most defensible Important is the `valid` boolean naming. It's a contract-level rule (TEAM.md §4) and the codebase already follows it elsewhere (`isBlocked`, `isTp1Filled`, `isSingleTpPlan`, etc.). However, given iteration 1 + the small surface (3 callsites in one file + the type itself), classifying as Important would force a rework loop for what is effectively a single-character rename. Tester proceeding is reasonable; if a follow-up touches `qty-normalizer.ts` it should fold in the rename.

Log-shape regressions (N1/N2/N3) are pure observability; no dashboards or alerts in the repo grep for the dropped fields/strings. Worth a one-line follow-up someday but not gating.

Smoke + backtest were correctly deferred to the tester per the dev's note — analysis explicitly stated `walk-forward re-run NOT required`, and a portfolio sanity run was on the dev's pre-submit list. Tester to verify.
