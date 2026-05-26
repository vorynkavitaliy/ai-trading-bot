# Board — Multi-Agent Task Tracking

This directory is a Jira-style work tracker stored as Markdown files. Every file is one work-item; status lives in YAML frontmatter; agents query it via `grep` + `index.json`.

See `.claude/TEAM.md § 3` for the full board contract. This README is the day-to-day operator cheat sheet.

---

## Hierarchy

```
EPIC  ──▶ SPRINT ──▶ TASK
        many        many
```

- **Epic** — large initiative, multi-sprint. Example: `EPIC-001-cg-fade-tuning`.
- **Sprint** — one ISO calendar week. Example: `2026-W22`.
- **Task** — atomic unit of work, has acceptance criteria. Example: `TASK-042-fix-reconcile-r`.

---

## Layout

```
board/
  README.md           ← this file
  index.json          ← cache (regenerated on every write)
  templates/
    epic.md
    sprint.md
    task.md
  epics/EPIC-NNN-<slug>.md
  sprints/YYYY-WNN.md
  tasks/
    TASK-NNN-<slug>.md
    TASK-NNN.analysis.md    ← architect + tech-lead output
    TASK-NNN.review.md      ← code-reviewer findings
    TASK-NNN.test.md        ← tester findings
  archive/              ← done/cancelled (keeps tasks/ light)
```

---

## ID numbering

- Epics: `EPIC-001`, `EPIC-002`, …
- Tasks: `TASK-001`, `TASK-002`, … (separate counter)
- Sprints: ISO week format `YYYY-WNN`, e.g. `2026-W22`.

ID is monotonic — never reuse a deleted ID.

The next ID is computed by the `planner` agent as `max(existing IDs) + 1` across `tasks/` and `archive/` combined.

---

## Status

```
pending → in_progress → review → rework / testing → done → (move to archive/)
                  ↑                                       ↓
                  └──── unblock ────── blocked ───────────┘
```

See `.claude/TEAM.md § 3` for the full state machine and allowed transitions per agent.

---

## How to query

The operator interacts via slash commands:

| Command | Purpose |
|---|---|
| `/board` | Overview: counts by status, blocked tasks, current sprint |
| `/board status <STATUS>` | List all tasks in a status |
| `/board task TASK-NNN` | Show one task's full state |
| `/board next` | List unclaimed tasks ready for pickup |
| `/board sprint <YYYY-WNN>` | List tasks in a sprint |
| `/board reindex` | Rebuild `index.json` from disk |

Agents query the board with bash:

```bash
grep -l "^status: blocked$" board/tasks/*.md
grep -l "^sprint: 2026-W22$" board/tasks/*.md
jq '.tasks | to_entries[] | select(.value.status == "pending")' board/index.json
```

---

## How to create work

| Command | Purpose |
|---|---|
| `/orchestrate "<task>"` | End-to-end: orchestrator creates TASK + dispatches the flow |
| `/task-new` | Create a single task interactively |
| `/epic-new` | Open a new epic |
| `/sprint-new` | Start a new sprint |

---

## Conventions

- Filename matches `id` in frontmatter (case-sensitive).
- Slugs in filenames are kebab-case, lowercase, max 5 words.
- Frontmatter dates use ISO 8601 (`2026-05-24` for dates, full `2026-05-24T14:00:00Z` for timestamps).
- Frontmatter list fields use YAML array syntax: `blocked_by: [TASK-005, TASK-009]`.
- Don't edit `index.json` by hand — let the `board-update` skill maintain it.

---

## Live-trading sensitivity

Tasks touching `src/runtime/`, `src/strategies/`, `src/data/backfill.ts`, or backtest engine are **live-sensitive**. They:

- Require `architect` review (not skippable).
- Require walk-forward proof if strategy/backtest logic changes (PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R, ≥ 100 trades).
- Get reviewed against `CLAUDE.md` inviolables, not just code quality.

The `planner` agent flags these by adding `live_sensitive: true` to frontmatter.
