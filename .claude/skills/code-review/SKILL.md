---
name: code-review
description: Use when the code-reviewer agent is reviewing a dev submission (status:review). The full review procedure: read diff fresh, run the category checklist, classify Important/Nit/Pre-existing, write TASK-NNN.review.md, transition status. Owned by code-reviewer agent.
---

# code-review — Review procedure

Used by the `code-reviewer` agent. See also `.claude/agents/code-reviewer.md` for context.

## When to invoke

- Task status is `review`.
- Iteration starts at 1 on first invocation, increments after each `rework → review` cycle.

## Procedure

### 1. Read fresh

- Task file + acceptance criteria.
- `TASK-NNN.analysis.md`.
- The diff: `git diff` for unstaged, `git diff --staged` for staged, `git log -p HEAD~1..HEAD` for the most recent commit. Use whichever matches what the dev actually submitted.
- Prior `TASK-NNN.review.md` if `iteration > 0`.

### 2. Run the category checklist

For every changed line, mentally run through these categories. Skip a category only if it's clearly inapplicable.

#### Correctness

- Logic bugs.
- Off-by-one.
- Wrong field (e.g. `t.qty` vs `t.initial_qty` in risk math — pattern from `feedback_live_vs_backtest_truth.md`).
- Async race conditions.
- Error paths — silent catch, missing rethrow, fallback values masking bugs.
- Null/undefined/empty array at boundaries.

#### Inviolable violations (always Important)

Cross-check against `CLAUDE.md § Inviolable execution rules`:

- Server-side SL within 5 min — code that places a position without `stopLoss` in the same call is a violation.
- Edit-never-cancel SL — `cancel + place` to move a stop is forbidden; must be `amend`.
- Pre-trade risk-guard check present.
- Reconcile must run before decide.
- Funding window ±10 min around 00/08/16 UTC respected.
- Forbidden shell patterns (heredocs, `node -e`, `$(...)`, `<(...)`, raw curl to Telegram).

#### Security

- `accounts.json` keys never in diff.
- No `.env` modifications.
- No `console.log` of order payloads or secrets.

#### Bybit API contract

- `execute.ts --side`: `buy`/`sell` only (long/short silently becomes Sell — see `feedback_execute_side_param.md`).
- Reduce-only flag on TP/SL legs.
- Limit vs native TP semantics correct.

#### Concurrency

- Multi-account `Promise.all` — failure on one sub-key doesn't kill the batch.
- Cron-driven scripts idempotent.
- DB `ON CONFLICT` semantics — does `DO NOTHING` mask a real update?

#### Backtest honesty (live-sensitive only)

- No future-bar leakage.
- Intra-bar resolution intact.
- Slip semantics consistent with live.
- Walk-forward gate referenced if logic changed.

#### Code quality (`TEAM.md § 4`)

- OOP / SOLID / KISS / DRY.
- **Comments outside the whitelist** (TS/ESLint/Prettier pragmas, shebang, one-line WHY for subtle invariant). Default: no comments.
- Blank lines between logical blocks within functions.
- Verb-named functions, noun-named variables/classes, predicate-named booleans.
- `as unknown as X` casts.
- `// @ts-ignore` without justification.
- New default exports outside CLI entrypoints.
- New dependencies (forbidden without architect approval).

#### Telegram style (`src/core/telegram.ts`, `src/core/tg-templates.ts`, `src/bot/`)

- Russian, no slang.
- Forbidden terms: `лонг`, `шорт-сетап`, `профит`, `луп`, `кэш-аут`, `лонгуем`, `шортуем`.
- Each message has *what / why / what next*.

#### Performance

- N+1 DB queries.
- Unbatched Bybit calls in hot path.
- Redundant Coinglass refresh.

#### Acceptance criteria coverage

For each criterion in the task's `acceptance:` list, verify the diff actually addresses it. Missing coverage is Important.

### 3. Classify each finding

- **Important** — must fix. Bug, security, inviolable violation, missed acceptance criterion, clear code-quality violation.
- **Nit** — improvement, non-blocking. Style preferences where TEAM.md doesn't take a hard line, micro-optimizations.
- **Pre-existing** — bug present before this diff. Flag once. Don't gate this task.

### 4. Iteration ≥ 2 — suppress new nits

If this isn't the first review, drop any Nit you would have flagged for the first time. Important always surfaces.

### 5. Write `TASK-NNN.review.md`

Use the template in `.claude/agents/code-reviewer.md`. Frontmatter must include the tally and `verdict` (`APPROVE_FOR_TEST` or `REWORK`).

Each finding gets:

- `file:line` citation.
- One paragraph explanation of the problem.
- A concrete fix snippet the dev can paste-and-adapt.

### 6. Transition status

- `verdict: REWORK` → set task `status: rework`. Reply tally.
- `verdict: APPROVE_FOR_TEST` → set task `status: testing`. Reply tally.

Also update `reviewer: code-reviewer` and `updated: <now>` in the task file. Update `index.json` per the `board-update` skill.

### 7. Reply concisely

```
TASK-042 reviewed (iteration 1):
  Important: 2 (reconcile risk-calc, missing null-guard)
  Nit: 1 (function name)
  Pre-existing: 1 (silent catch in line 78)
  verdict: REWORK
  → board/tasks/TASK-042.review.md
```

## Anti-patterns

- ❌ Approving without line-by-line read.
- ❌ Inventing severity to soften ("Nit but please fix").
- ❌ Findings without `file:line`.
- ❌ Surfacing new Nits on iteration ≥ 2.
- ❌ Skipping inviolables checklist on `live_sensitive`.
- ❌ Modifying task body — only frontmatter `status` / `reviewer` / `updated` plus the `.review.md` file.
- ❌ Bringing your reading-of-the-dev's-chat into the review. You don't see their chat. Don't pretend you do.
