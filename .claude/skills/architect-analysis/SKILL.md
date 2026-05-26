---
name: architect-analysis
description: Use when the architect produces TASK-NNN.analysis.md. Walks through the analysis template: map territory, generate options, recommend with trade-offs, hand off to tech-lead. Owned by architect agent.
---

# architect-analysis — Analysis recipe

Used by the `architect` agent to produce a `TASK-NNN.analysis.md` that a developer can implement from without coming back with questions.

## When to invoke

Orchestrator dispatches you on:

- A new task that touches multiple files or non-trivial logic.
- A live-sensitive task (always — `live_sensitive: true` mandates architect review).
- An operator request for an ad-hoc deep-dive (no board task needed; output goes to `board/tasks/_adhoc_<slug>.md`).

## Procedure

### 1. Read inputs (in order, cold)

- The task file.
- `CLAUDE.md`.
- `.claude/TEAM.md` § 4 and § 7.
- Every file the task `artifacts:` lists.
- Anything those files import that could ripple.

Use `grep` to find call sites of any function/class you'd modify. Cost of grep is low; cost of missing a caller is high.

### 2. Map the territory

In your head (or as a draft section in the analysis):

- Which files touch which entities.
- Where the boundary of the change ends.
- What's frozen by inviolable rules (`CLAUDE.md`).

### 3. Generate ≥ 2 approaches

Always two. If you can only think of one, you haven't thought hard enough.

For each:

- Concrete files + line ranges.
- Estimated diff size (use `wc -l` and judgment, not round numbers).
- Behavior delta.
- Risks.

### 4. Recommend one, reject the others explicitly

Don't leave alternatives "open". Pick. Reject in one paragraph each.

Criteria, in priority order:

1. **Inviolable compliance** — anything that risks an inviolable is auto-rejected.
2. **Blast radius** — smaller diff, fewer files, fewer call sites.
3. **Simplicity** — does it make the code easier to reason about after?
4. **Reversibility** — how hard to back out if wrong?
5. **Performance** — only relevant when measured, not guessed.

### 5. Write `TASK-NNN.analysis.md`

Use the template in `.claude/agents/architect.md`. Mandatory sections:

- Summary
- Current behavior (with `file:line` for every claim)
- Proposed change (file-by-file)
- Interfaces / types (any new or modified signatures)
- Alternatives considered and rejected
- Risks (table with likelihood + mitigation)
- Live-trading impact (mandatory if `live_sensitive`, else "n/a")
- Out of scope
- Acceptance criteria (proposed refinement, if needed)
- Dev brief (one paragraph, the launch pad)
- Open questions (`[NEEDS CLARIFICATION: ...]` markers)

### 6. Cite, don't paraphrase

For every claim about current behavior:

```
src/runtime/reconcile.ts:188 uses `t.qty` as the divisor in the R-value computation,
where `qty` reflects post-TP1 remainder rather than the original position size.
```

Not:

```
The reconcile code uses the wrong qty field.
```

The former is verifiable in 5 seconds. The latter sends the reader hunting.

### 7. Honesty about uncertainty

If you don't know:

```
[NEEDS CLARIFICATION: should the migration backfill existing rows with initial_qty=qty, or leave them null and let reconcile fall back?]
```

Don't guess. The orchestrator will surface to the operator before dispatching dev.

### 8. Hand off

Default: hand off to `tech-lead` for sign-off. They sharpen the dev brief.

Exceptions:

- Task is trivial and self-contained → hand directly to dev. Set task `status: pending` and a note that tech-lead is skipped.
- Architecture is too tangled for one task → hand to `planner` for subtask breakdown.

Reply to orchestrator with the recommendation and the path to the analysis file.

## Anti-patterns

- ❌ Single-option analyses — always show alternatives.
- ❌ Round-number estimates when a real measurement is possible.
- ❌ "Best practice" claims without naming the practice.
- ❌ Hidden assumptions — write them down as Risks or Open questions.
- ❌ Recommending a refactor that wasn't asked for.
- ❌ Touching `src/` yourself.

## Live-sensitive analysis additions

For `live_sensitive: true` tasks, the analysis MUST also include:

- **Inviolables touched.** List every `CLAUDE.md § Inviolable execution rules` and `§ Risk budget v4` rule the change could affect.
- **Walk-forward proof requirement.** Yes/no and why. If yes, name the backtest CLI to run (`src/backtest/cli/<file>`) and the gate (PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R, ≥ 100 trades).
- **Failure modes.** What happens if the change is buggy in prod? Bybit returns 5xx? DB is stale? Reconcile diverges? Cron skips a cycle?
- **Rollback plan.** How to revert without losing data. Whether reverting requires a DB rollback.

The tech-lead and reviewer will check that these sections are non-trivially filled.
