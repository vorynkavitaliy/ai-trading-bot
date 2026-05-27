---
task: TASK-005
author: code-reviewer
iteration: 1
created: 2026-05-26T09:40:03Z
---

# TASK-005 Review — closeAndVerify trifecta

## Verdict
**Approved → testing**

All 8 commits faithfully implement the architect spec. The new `closeAndVerify` helper is correct under the edge cases I tried to break (pre-check before submit guards against double-submit, retCode != 0 is non-fatal because position size is the source of truth, dust_below_min is detected both pre-submit and post-final-snapshot). The divergence-detector dust gate is the right minimal change (preserves `tp1_partial` branch). The position-watcher safety-net now has the missing force-close fallback covering all four outcomes. The admin tools and diagnostic all migrated cleanly. Typecheck passes from project root with zero output.

No Important findings. A small handful of Nits below are non-blocking; tester can proceed.

## Important findings
None.

## Nit findings

1. `src/core/close-verifier.ts:54` — `(p: any)` parameter annotation on Bybit position list filter. Matches the existing codebase precedent (`reconcile.ts:84`, `position-watcher.ts:81`, several diagnostics) so I'm not flagging as Important, but if a typed wrapper for `getPositionInfo` ever lands (e.g. in `core/bybit.ts`), this is the next consumer to migrate. Note: this is a parameter type annotation, **not** an `as any` cast — the file has zero `as` / `as unknown as` casts (verified).

2. `src/core/close-verifier.ts:64` — `parseFloat(p.markPrice ?? p.avgPrice ?? '0')` falls back to `avgPrice` then `'0'`. For a USDT-perp Bybit V5 response with an open position, `markPrice` is always present; the fallback chain is a defensive courtesy. The downstream consumer at line 134 guards with `markPrice > 0` before using the notional check, so a stale `0` markPrice **skips the pre-submit dust gate** but does not cause incorrect classification (the final snapshot at line 168 may still classify as dust on `dust_below_min` flag from the pre-check, or fall to `stuck`). Acceptable; flagging only because the chain hides what `0` semantically means here.

3. `src/core/close-verifier.ts:175` — final classification: `dustBelowMin || (finalMark > 0 && finalSize * finalMark < info.minNotionalValue)`. The OR with the in-loop flag covers the case where we broke out without doing the final-snapshot notional check. Correct, but worth a one-line "why" comment if the operator ever wonders why both conditions exist. Per TEAM.md §4 a comment here would be allowed (subtle invariant). Not required.

4. `src/core/close-verifier.ts` — `closeAcrossAccounts` cross-check pass downgrades `ok → stuck` if residue reappears, but **does not** also consider downgrading to `dust_below_min` even when the residue is sub-min-notional. Will surface marginal dust residues as `stuck` (and trigger operator Telegram via callers). Architect explicitly noted this conservative-side trade-off in the Risks table. Acceptable.

5. `src/tools/admin/close-all.ts:32-37` — `cancelAccountOrders` swallows the exception with a `console.log`; no log.warn / structured logging on cancel failure. Matches the file's pre-existing style for the admin tool (operator-facing, console output is the primary signal). Not blocking.

6. `src/tools/diagnostics/full-exit-symbol.ts:50-51` — the dry-run printout still says `→ market closeSide qty=p.size (reduce-only)` per position, but on `--execute` we now call `closeAcrossAccounts` which does its own iteration and printing. Cosmetic dual-print is harmless. Could be tidied later.

7. `src/runtime/position-watcher.ts` — `closePosition` is still not called anywhere (architect noted this). The wrap is correct, just dead-code-ready for future regime-flip rules. No action needed.

## Pre-existing
- Top-of-file comment headers in `close-symbol.ts`, `close-all.ts`, `full-exit-symbol.ts`, and the docstring block at `divergence-detector.ts:1-16` predate this task. They lean toward describing WHAT but are acceptable per TEAM.md §4 whitelist (module-level "why this exists" docstrings, and they survived the prior refactor commit `f50d901`). Not in scope to fix here.
- `position-watcher.ts:12` retains the `getInstrumentInfo` import — still used by the DCA fill branch at line 379. Architect explicitly called this out as expected.
- `(p: any)` filter pattern repeated across many files (pre-task pattern). Not introduced by this task.

## Reviewer checklist (per commit)

### Step 1 — `0ab03d4` bybit InstrumentInfo
- [x] `minNotionalValue` parsed with `?? '5'` fallback (line 71 in `bybit.ts`)
- [x] No other `InstrumentInfo` construction sites broken — verified: only `getInstrumentInfo` constructs the interface (grep'd); all other usages are consumers
- [x] Commit touches only `src/core/bybit.ts` (verified via `--name-only`)

### Step 2 — `7014f59` close-verifier.ts (CORE — TIGHTEST SCRUTINY)
- [x] `closeAndVerify` loop logic correct — 3 attempts, pre-check, round-to-step, notional gate, submit, sleep
- [x] **Pre-check size == 0 BEFORE submit** (line 123) — no double-submit race
- [x] **Race resistance**: each iteration re-fetches position (line 120)
- [x] `dust_below_min` branches present: rounded qty 0 (line 127) + notional < minNotional (line 134)
- [x] **No fatal on retCode != 0**: `log.warn` + continue to next poll (line 154-158); architect's "position is source of truth" mandate honored
- [x] Exception → `'error'` status with `detail = e.message` (line 191-202)
- [x] `closeAcrossAccounts` cross-check pass present (line 215-235), correctly downgrades only when `status === 'ok'` AND residue reappears
- [x] **No Telegram inside the helper** (SRP) — callers compose messages
- [x] No `as`, no `as unknown as`, no `as any` casts (grep verified: 0 hits in the new file)
- [x] No magic numbers — `DEFAULT_MAX_ATTEMPTS = 3`, `DEFAULT_POLL_DELAY_MS = 1500` as constants; `?? '5'` for `minNotionalValue` lives in `bybit.ts` step 1
- [x] `withRetry` used for transient network at the submitOrder call (`tries: 2`) but the retCode-decision logic lives outside withRetry — correct separation
- [x] Imports grouped: node stdlib → core (accounts, bybit, logger) — correct per TEAM.md §4 formatting

### Step 3 — `ad16b01` divergence-detector
- [x] Dust no longer requires `tp1_filled` (line 51-52: `isAbsoluteDust = pos.size > 0 && pos.size < initial_qty * DUST_FRAC`)
- [x] **`tp1_partial` branch preserved** (line 47, still gated on `!match.tp1_filled` between 40-60% ratio) — different condition, correctly untouched
- [x] Order of verdicts: aligned (line 42) → tp1_partial (47) → dust (52) → mismatch (54)
- [x] `grep "match.tp1_filled" src/runtime/divergence-detector.ts` → exactly 1 hit (the tp1_partial branch). Dust branch is clean

### Step 4 — `af050c1` position-watcher
- [x] Safety-net fallback covers all 4 `closeAndVerify` outcomes:
  - `'ok'` → push `EMERGENCY-CLOSE` action + Telegram "экстренно закрыта"
  - `'dust_below_min'` → Telegram "остаток < min notional, мониторим"
  - `'stuck'` / `'error'` → throw inside inner try → outer `closeErr` catch → 🆘 КРИТИЧНО alert
- [x] `closePosition` rewritten as thin wrapper over `closeAndVerify`: throws only on `stuck` / `error`, does NOT throw on `dust_below_min` (line 156-160 of new file)
- [x] No nested silent catches — both `slErr` and `closeErr` include error messages in the Telegram action field
- [x] `closeAndVerify` imported from `'../core/close-verifier'` (line 13)
- [x] `kind: 'reconcile_divergence'` used consistently for all three new alerts (matches existing convention)

### Step 5 — `5daad76` reconcile dust
- [x] `pos.size = 0` set **only** on `ok` or `dust_below_min` (line 308); on `stuck` it logs warn and leaves `pos.size` alone so the gap-fill loop won't auto-close the DB row
- [x] `cancelOrders: false` (line 306) — pending TP/SL self-cancel when size→0; redundant cancel would be noise
- [x] `randomUUID` import removed (no longer needed since inline submitOrder is gone); `getRest`/`withRetry` still imported because used elsewhere in the file
- [x] Try/catch around `closeAndVerify` retains for safety even though the helper itself catches — defensive but harmless

### Step 6 — `40c1c9f` close-symbol
- [x] Main loop replaced with single `closeAcrossAccounts` call
- [x] Table-style per-account output with status tags (✅ / ∅ / ⚠ dust / ❌)
- [x] **Non-zero exit (`process.exit(2)`) on `!result.allClosed`** (line 47-54)
- [x] `cancelOrders: true` (default for admin tool, correct because admin invocation needs to also clear pending TP/SL)
- [x] Unused imports (`getRest`, `withRetry`) removed cleanly

### Step 7 — `d80f178` close-all
- [x] Per-account `cancelAllOrders({ settleCoin: 'USDT' })` pre-step preserved (line 32-44 in new file)
- [x] Unique-symbol discovery across all accounts (line 73-79); deduplicated set; sorted
- [x] Per-symbol fan-out via `closeAcrossAccounts(accounts, symbol, { cancelOrders: false })` — `false` because pre-step already cancelled
- [x] Non-zero exit when any (account, symbol) pair ends stuck
- [x] Empty-positions short-circuit: prints "no open positions across all accounts" and returns

### Step 8 — `7fded20` full-exit-symbol
- [x] Diagnostic; only the `if (execute) { ... submitOrder ... }` block replaced (line 52-62 in new file)
- [x] `cancelOrders: false` (file's own step 1 already does symbol-level cancelAllOrders)
- [x] Unused imports `getInstrumentInfo`, `normalizeQty` removed
- [x] Dry-run printout preserved for operator preview

### Cross-cutting
- [x] **`npx tsc --noEmit` clean** (verified empty stdout/stderr from project root)
- [x] **0 Market+reduceOnly:true submitOrder calls outside `close-verifier.ts`** — verified by grepping for `orderType: 'Market'` with `reduceOnly: true` in a 6-line context window; only hits are inside `close-verifier.ts:142-149`. All other reduceOnly:true submitOrders are `timeInForce: 'GTC'` (i.e. limit TP placement in `tp-planner.ts`, `naked-tp-recovery.ts`, `position-watcher.ts:382` DCA fill, `tools/diagnostics/replace-tp-full-position.ts`)
- [x] **0 hits of `match.tp1_filled` in the dust branch** of divergence-detector (only the `tp1_partial` branch retains the flag check, by design)
- [x] **No new WHAT-comments** in the diffs (verified by reading each diff hunk). Existing module-level docstrings predate this task
- [x] **Operator WIP NOT committed**: `git status --short` shows working-tree contains many uncommitted `D` and untracked files (`btc-*.ts`, `cg-*.ts`, `grid-*.ts`, `cg-coverage.ts`, etc., plus `board/index.json`, `board/tasks/`, new `wf-*.ts` files). `src/strategies/cg-fade.ts` is **not** in the modified set in this branch's commits — verified by `git show --name-only` for each of the 8 commits
- [x] Each commit touches exactly the files per architect's dev brief (verified):
  - 0ab03d4 → `src/core/bybit.ts` only
  - 7014f59 → `src/core/close-verifier.ts` only (new file)
  - ad16b01 → `src/runtime/divergence-detector.ts` only
  - af050c1 → `src/runtime/position-watcher.ts` only
  - 5daad76 → `src/runtime/reconcile.ts` only
  - 40c1c9f → `src/tools/admin/close-symbol.ts` only
  - d80f178 → `src/tools/admin/close-all.ts` only
  - 7fded20 → `src/tools/diagnostics/full-exit-symbol.ts` only
- [x] All 8 commit messages reference `TASK-005` and preserve the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer (8/8 verified via `git log --format=%B`)

## Notes

**Live-trading inviolables (CLAUDE.md):**

1. **"Server-side SL within 5 minutes of every position open."** Strengthened: the safety-net's new force-close fallback (af050c1) means that "SL set failed → alert only" is no longer a terminal state. When `setTradingStop` is rejected (e.g. dust < minNotional), we now force-close instead of leaving the position naked overnight. This is the precise gap that produced the 2026-05-25 incident.

2. **"Edit-never-cancel SL."** Untouched. `setTradingStop` remains the primary SL-move path everywhere; `cancelOrders: true` in `closeAndVerify` is only used in admin close paths (close-symbol, close-trade context) — when the operator explicitly wants the position flat, both pending limits and the position go. Each runtime callsite correctly chose `cancelOrders: false`:
   - `position-watcher.closePosition` → `false`
   - `position-watcher` safety-net fallback → `false`
   - `reconcile` dust handler → `false`
   - Admin/diagnostic tools → `true` (close-symbol) or `false` after a separate per-account cancel (close-all, full-exit-symbol)

3. **"Reconcile before every cycle. If trades DB rows and Bybit positions diverge → halt analysis."** Strengthened: dust verdicts (previously gated on `tp1_filled`) now auto-close via the same hardened helper, so the divergence-detector's `mismatch` verdict reliably signals genuine operator-attention divergences only.

**Race condition I tried to break:** I traced through 3 scenarios that I thought might bite — (a) matching engine delays the fill so the IOC partials and we submit a stale `qtyStr` next iteration, (b) operator opens a NEW position on the same symbol during the cross-check pass, (c) the very first attempt sees size=0 (engine already filled an ambient TP1) so `attemptsTaken` stays 0 and we return `ok` with no submits. All three reach a safe terminal state: (a) Bybit rejects with size mismatch → log.warn → re-poll on next iter shows correct residue → next submit uses fresh qty; (b) cross-check downgrades to `stuck` → operator notified (false positive but safer side); (c) `attemptsTaken: 0, status: 'ok'` correctly indicates "nothing to do" without misleading the caller. I'm satisfied the helper is race-safe within the limits of Bybit's V5 IOC reduce-only contract.

**Recommended tester actions** (per task acceptance #7 + #8):
- Run `bash scripts/cycle.sh` once on testnet or with `LIVE=false`-equivalent and confirm reconcile + position-watcher do not regress on healthy positions.
- If feasible, simulate dust by manually closing 99% of an ARBUSDT testnet position with a stop-loss left dangling, then run `npx tsx src/tools/admin/close-symbol.ts ARBUSDT` and confirm:
  1. status comes back as `ok` or `dust_below_min` (not `stuck`)
  2. exit code is 0
  3. consolidated console table shows per-account result rows
- Confirm `npx tsx src/runtime/reconcile.ts` does not surface `mismatch` after a manual partial close (should now route through the dust auto-close path).
