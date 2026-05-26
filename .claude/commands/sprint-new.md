---
description: "Start a new sprint with chosen pending tasks. Either pass task IDs explicitly or let the planner pick within a capacity budget."
argument-hint: "<YYYY-WNN> [--tasks TASK-001,TASK-005,...] [--capacity-hours 20] [--goal \"...\"]"
---

# /sprint-new — Start a Sprint

**Arguments:** `$ARGUMENTS`

## Procedure

1. Parse arguments:
   - Required: `YYYY-WNN`.
   - Optional: `--tasks <comma-separated IDs>`, `--capacity-hours <N>` (default 20), `--goal "<text>"`.

2. Validate `YYYY-WNN` is a valid ISO week. Compute start/end dates.

3. Determine task list:
   - If `--tasks` provided, use that list verbatim. Verify all IDs exist in `board/tasks/`.
   - Else, dispatch the `planner` agent with the capacity hint. It picks tasks per the `plan-feature` skill's sprint section.

4. Read `board/templates/sprint.md`.

5. Filename: `board/sprints/<YYYY-WNN>.md`.

6. Fill frontmatter:
   - `id: <YYYY-WNN>`
   - `active: true`
   - `start: <ISO date>`
   - `end: <ISO date>`
   - `goal: "<from --goal or empty>"`
   - `tasks: [TASK-051, TASK-052, ...]`

7. For each task in `tasks`:
   - Read the task file.
   - Set its `sprint: <YYYY-WNN>` field.
   - Update `updated:`.

8. Update `board/index.json`:
   - Add `sprints.<YYYY-WNN>` entry.
   - Update each task's `sprints[task].sprint` mirror.
   - Update `generated_at`.

9. Mark any currently-active sprint as `active: false` (only one sprint can be active at a time).

10. Reply:

```
Sprint 2026-W23 started:
  goal: Incremental scan-decide refactor
  capacity: 20h
  tasks:
    TASK-051  extract feature-loader      [live_sensitive]
    TASK-052  adapt scan-decide  ← 051
    TASK-053  backtest gate     ← 052
    TASK-054  update CLAUDE.md  ← 053
  start: 2026-06-02, end: 2026-06-08
```

## Sprint-close (run separately at sprint end)

To close the sprint, edit `board/sprints/<YYYY-WNN>.md`:
- Set `active: false`.
- Fill the `## Retrospective` section (what worked, what didn't, what to change).

There's no `/sprint-close` command — keep it manual to ensure thought goes into the retro.
