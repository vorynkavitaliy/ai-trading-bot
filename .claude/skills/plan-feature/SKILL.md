---
name: plan-feature
description: Use when the planner is breaking a feature or large task into board entries. Walks through: pick scope, slice into thematic tasks, order by dependency, write epic + child tasks with acceptance criteria, update index.json. Owned by the planner agent.
---

# plan-feature — Feature decomposition recipe

The planner uses this to turn a vague operator brief or an architect's analysis into a well-formed set of board entries. See also the `planner` agent file for context and constraints.

## When to invoke

- Operator brief mentions multiple-file or multi-step work.
- Architect's analysis lists ≥ 3 changes that can't be done in one task.
- Sprint planning — picking which pending tasks make the cut.

## Procedure

### 1. Read the inputs

- Operator/orchestrator brief.
- Architect's `TASK-NNN.analysis.md` if present.
- `board/index.json` for counters and existing IDs.
- `board/templates/task.md` and `epic.md`.

### 2. Decide: epic, or just tasks?

- **Epic** — multi-sprint, ≥ 5 child tasks, requires its own ID, has its own success criteria.
- **Just tasks** — single-sprint, 2–4 tasks under an existing epic or none.

If unsure, default to "just tasks" — you can promote to an epic later.

### 3. Slice into thematic tasks

Each task is **one theme**. Themes that recur in this codebase:

- DB schema or migration.
- Core domain logic (`src/runtime/*`, `src/strategies/*`).
- Data pipeline (`src/data/*`).
- Backtest validation (`src/backtest/cli/*`).
- Diagnostics / ops tools (`src/tools/*`).
- Telegram/CLI surface (`src/bot/*`, `src/reporting/*`).
- Documentation / contract (`CLAUDE.md`, `.claude/TEAM.md`, `board/README.md`).

If one task spans two themes, it's too big — split.

### 4. Right-size

Target: **1–4 hours of dev work per task**. Rough heuristic:

- 1 file touched, ≤ 30 lines diff → 1h.
- 2–3 files, ≤ 100 lines diff → 2–3h.
- > 100 lines or > 3 files → split.

Bigger tasks lose review quality (reviewer skim) and rework cycles take longer.

### 5. Order by dependency

For each task, list which other tasks it depends on. The first task in execution order should be the one that unblocks the most others.

For each task, set `blocked_by: [TASK-XXX]` if applicable.

### 6. Write acceptance criteria

**Mandatory.** 3–5 items per task. Each must be:

- **Measurable** — "all reconcile rows match within 0.01R" beats "reconcile works".
- **Verifiable by execution** — the tester needs to run something to confirm.
- **Scoped** — about this task only, not the epic.

Examples of good criteria:

- "`npm run typecheck` exits 0".
- "`npm run reconcile` reports `aligned: true` on the current DB state".
- "Backtest portfolio PF ≥ 1.4 and MaxDD ≤ 4% on 365d data".
- "Telegram exit message uses ВЫХОД format and contains realized R".

Examples of bad criteria:

- "Code is clean" — not measurable.
- "Performance is good" — not measurable.
- "User is happy" — not verifiable.

### 7. Flag live-sensitive

If a task touches `src/runtime/`, `src/strategies/`, `src/data/backfill.ts`, or any `src/backtest/` engine file (not just CLIs), set `live_sensitive: true`.

When in doubt, set it. False positives cost extra review; false negatives can deploy a broken risk-guard.

### 8. Write the files

For each task:

1. Read `board/templates/task.md`.
2. Compute slug from title (kebab-case, max 5 words, lowercase, no dots).
3. Filename: `board/tasks/TASK-NNN-<slug>.md`.
4. Fill frontmatter completely:
   - `id`, `title`, `epic`, `sprint`, `status: pending`, `assignee: ""`, `reviewer: ""`.
   - `severity_threshold: important` (default).
   - `blocked_by: [...]`.
   - `created` + `updated` in ISO date (not full timestamp — those are for `index.json`).
   - `iteration: 0`.
   - `artifacts: [...]` — files expected to change.
   - `live_sensitive`.
   - `acceptance: [...]`.
5. Fill body sections — leave architect/dev sections empty placeholder.

For an epic:

1. Read `board/templates/epic.md`.
2. Filename: `board/epics/EPIC-NNN-<slug>.md`.
3. Fill frontmatter, list all child task IDs in `tasks: [...]`.
4. Fill Motivation, Scope, Out-of-scope, Success criteria, Risks.

### 9. Update index.json

Increment counters by however many tasks/epics you created. Add `tasks.TASK-NNN` entries with their initial state. If creating an epic, add `epics.EPIC-NNN`. Update `generated_at`.

### 10. Reply

```
Created EPIC-003 (refactor scan-decide):
  TASK-051 — extract feature-loader [live_sensitive]
  TASK-052 — adapt scan-decide ← 051
  TASK-053 — backtest gate ← 052
  TASK-054 — update CLAUDE.md diagram ← 053

Total est: ~12h dev. Suggest fitting in sprint 2026-W23.
```

## Anti-patterns

- ❌ Tasks without acceptance criteria.
- ❌ Tasks too big to fit one dev session.
- ❌ Implicit dependencies ("obviously do this one first").
- ❌ Skipping `live_sensitive` because "it's small".
- ❌ Touching `index.json` without recomputing counters.
- ❌ Filling architect/dev sections in the task body — those belong to those agents.
