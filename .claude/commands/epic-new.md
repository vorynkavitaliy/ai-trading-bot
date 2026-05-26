---
description: "Open a new epic on the board. Doesn't auto-create child tasks — those come from /orchestrate or /task-new under this epic."
argument-hint: "<title in quotes> [--target-sprint YYYY-WNN]"
---

# /epic-new — Create One Epic

**Arguments:** `$ARGUMENTS`

## Procedure

1. Parse arguments:
   - Required: title.
   - Optional: `--target-sprint YYYY-WNN`.

2. Read `board/index.json` to get `counters.next_epic`.

3. Compute slug: kebab-case, max 5 words.

4. Filename: `board/epics/EPIC-NNN-<slug>.md`.

5. Read `board/templates/epic.md`, fill frontmatter:
   - `id: EPIC-NNN`
   - `title: "<original title>"`
   - `status: active`
   - `created: <today>`
   - `updated: <now ISO>`
   - `target_sprint: <YYYY-WNN if provided, else "">`
   - `tasks: []`
   - `acceptance: []` — fill via Edit tool.

6. Body sections — leave the template skeleton. Architect / operator fill Motivation, Scope, Out-of-scope, Success criteria, Risks.

7. Update `board/index.json`:
   - Increment `counters.next_epic`.
   - Add `epics.<id>` entry.
   - Update `generated_at`.

8. Reply with the new epic path and the next step (write Motivation, then `/orchestrate` or `/task-new --epic <id>` per task).

```
Created board/epics/EPIC-003-incremental-scan.md
  status: active
  tasks: [] — add child tasks via /orchestrate or /task-new --epic EPIC-003
```
