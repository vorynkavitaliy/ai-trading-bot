---
description: "Create a single task on the board (skips orchestration). Use when you know exactly what task to file. Doesn't dispatch any agent — just writes the file."
argument-hint: "<title in quotes> [--epic EPIC-NNN] [--live-sensitive] [--sprint YYYY-WNN]"
---

# /task-new — Create One Task

**Arguments:** `$ARGUMENTS`

## Procedure

1. Parse arguments:
   - Required: title (in quotes).
   - Optional: `--epic EPIC-NNN`, `--live-sensitive`, `--sprint YYYY-WNN`.

2. Read `board/index.json` to get `counters.next_task`.

3. Compute slug from title: lowercase, kebab-case, max 5 words, strip articles.

4. Filename: `board/tasks/TASK-NNN-<slug>.md`.

5. Read `board/templates/task.md`, fill frontmatter:
   - `id: TASK-NNN`
   - `title: "<original title>"`
   - `epic: <EPIC-NNN if provided, else "">`
   - `sprint: <YYYY-WNN if provided, else "">`
   - `status: pending`
   - `assignee: ""`
   - `reviewer: ""`
   - `severity_threshold: important`
   - `blocked_by: []`
   - `created: <today>`
   - `updated: <now ISO>`
   - `iteration: 0`
   - `artifacts: []`
   - `live_sensitive: <true if flag set, else false>`
   - `acceptance: []` — leave empty; operator fills via Edit tool or the architect proposes during analysis.

6. Body sections — leave skeleton from the template. Architect/dev fill these.

7. Update `board/index.json`:
   - Increment `counters.next_task`.
   - Add `tasks.<id>` with the initial state.
   - If `--epic`, append the task ID to `epics.<EPIC-NNN>.tasks[]`.
   - If `--sprint`, append the task ID to `sprints.<YYYY-WNN>.tasks[]`.
   - Update `generated_at`.

8. Reply with the new task path and a reminder that acceptance criteria are empty:

```
Created board/tasks/TASK-042-fix-reconcile-r.md
  live_sensitive: false
  acceptance: [] — fill via Edit tool or let architect propose.
```

## Anti-patterns

- ❌ Creating a task without a title.
- ❌ Inventing acceptance criteria the operator didn't ask for.
- ❌ Filling architect/dev sections — those agents own them.
