---
description: "Query the board: overview, status filter, single-task view, sprint contents, or reindex from disk."
argument-hint: "[status <STATE> | task <ID> | next | sprint <YYYY-WNN> | reindex] (default: overview)"
---

# /board — Query the Board

Operator command to inspect the board without invoking orchestration.

**Arguments:** `$ARGUMENTS`

---

## Subcommands

### `(no args)` — Overview

Display:

- Counts by status (pending, in_progress, review, rework, testing, blocked).
- Current sprint (most recent in `board/sprints/`) and its tasks.
- Tasks with `iteration >= 2` (escalation candidates).
- Tasks blocked > 24h.

Read `board/index.json` first. If `generated_at` is older than 1h, suggest `reindex`.

### `status <STATE>` — Filter

Use the Read tool on `board/index.json`, filter `tasks` where `status == <STATE>`. For each, display:

- ID, title (from task file frontmatter).
- Assignee.
- Updated timestamp.
- Iteration.

### `task <ID>` — Single task detail

Read the task file and any siblings:

- `board/tasks/<ID>-*.md`
- `board/tasks/<ID>.analysis.md`
- `board/tasks/<ID>.review.md`
- `board/tasks/<ID>.test.md`

Display frontmatter, acceptance criteria, current Notes thread (latest 3), and review/test verdict.

### `next` — Unclaimed work

Tasks where:

- `status == pending`
- `assignee == ""`
- `blocked_by` is empty OR all blockers are `done`

Sorted by sprint priority, then ID.

### `sprint <YYYY-WNN>` — Sprint contents

Read `board/sprints/<YYYY-WNN>.md` and list all child tasks with their current status.

### `reindex` — Rebuild `index.json` from disk

1. Read every `board/tasks/*.md` (excluding `*.analysis.md`, `*.review.md`, `*.test.md`).
2. Read every `board/epics/*.md` and `board/sprints/*.md`.
3. Rebuild `index.json` with the actual state.
4. Compute `counters.next_task` as `max(existing IDs) + 1` across tasks (active + archive).
5. Write the new `index.json` with current `generated_at`.
6. Report any drift found (e.g. status in file vs index mismatch).

---

## Procedure

1. Parse `$ARGUMENTS`. If empty, default to Overview.
2. Validate subcommand. If invalid, list valid options.
3. Execute the subcommand using the Read tool (never `cat`) and `jq` where it makes parsing cleaner.
4. Output in a compact table or short-list format. No prose narration.

---

## Output style

Match the operator's preference for terseness. Use compact tables:

```
TASK-042  review     dev-node-ts  iter 1  3h ago  fix reconcile risk-calc
TASK-051  pending    -            iter 0  2d ago  extract feature-loader
TASK-053  blocked    -            iter 0  1d ago  backtest gate         ← blocked by 052
```

Don't pad with explanatory text. The operator reads the table.

## Permissions needed

- Read tool on `board/**/*` and `board/index.json`.
- `jq` on `board/index.json` (already allowed).
- Optionally `grep` on `board/tasks/*.md`.

No mutation. This command never writes — except `reindex`, which writes `board/index.json`.
