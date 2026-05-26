# Team Contract — Multi-Agent Development Flow

This document is the **operational contract for the development team** that builds and maintains the trading bot. It complements `CLAUDE.md` (the inviolable runtime contract for the bot itself).

Two contracts, two scopes:

- `CLAUDE.md` — how the **bot** must behave at runtime (risk, execution, forbidden patterns).
- `TEAM.md` (this file) — how the **agents that develop the bot** must behave (flow, board, code quality).

When the two conflict, `CLAUDE.md` wins.

---

## 1. Team Roster

| Agent | Scope | Code? | Spawnable parallel? | Context |
|---|---|---|---|---|
| `orchestrator` | Dispatcher. Reads board, routes work, never writes code. | No | No (single) | Persistent — sees the whole flow |
| `architect` | Deep technical analysis, trade-offs, ADRs. | No | Yes | Fresh per invocation |
| `tech-lead` | Validates architect output, briefs devs, enforces standards. | No (rarely) | Yes | Fresh per invocation |
| `planner` | Breaks features into epics/sprints/tasks. Writes to `board/`. | No | No | Fresh per invocation |
| `dev-node-ts` | Implements TypeScript/Node code. | Yes | **Yes** (multiple in parallel) | Fresh per task |
| `code-reviewer` | Reviews diffs. Severity: Important / Nit / Pre-existing. | No (rarely) | Yes | **Fresh** — never has dev context |
| `tester` | Runs Playwright/curl, writes tests **only where they already exist**. | Yes (tests only) | Yes | Fresh per task |
| `trader` | Live-trading bot maintainer (cron pipeline, news halts, reconcile escalations). | Sometimes | No | Existing — operational, not dev |

**The orchestrator is the only agent that talks back to the operator.** All other agents communicate through the board (files), not through the chat.

---

## 2. Flow

```
USER → /orchestrate "<task>"
  │
  ▼
[orchestrator]  creates TASK-NNN, decides what's needed
  │
  ├──▶ in parallel:
  │     [architect]    → TASK-NNN.analysis.md (depth, trade-offs)
  │     [tech-lead]    → reviews architect's output, drafts dev brief
  │
  ▼
[planner]       breaks into subtasks → TASK-NNN-a/b/c.md (status: pending)
  │
  ▼
[dev-node-ts × N]  claim subtask → status: in_progress → push → status: review
  │
  ▼
[code-reviewer] fresh context, reads diff + acceptance criteria
  │              → writes TASK-NNN.review.md
  │              → severity tallied
  │
  ├── Important found      → status: rework  → back to dev
  └── only Nit/Pre-existing → status: testing → tester
                                                 │
                                                 ├── pass → status: done → archive/
                                                 └── fail → status: rework → back to dev
  ▼
[orchestrator]  reports to operator
```

### Loop convergence

After the **first** review cycle, the reviewer suppresses new Nits and reports **Important only**. This prevents infinite style-only rounds. The orchestrator enforces this by injecting `iteration: N` into reviewer's prompt.

A task that loops `review → rework → review` more than **3 times** is escalated to the operator — the orchestrator pauses, surfaces the disagreement, and asks for a ruling.

---

## 3. Board Contract

### Layout

```
board/
  README.md
  index.json                # quick lookup (regenerated on every write)
  templates/
    epic.md
    sprint.md
    task.md
  epics/
    EPIC-NNN-<slug>.md
  sprints/
    YYYY-WNN.md             # ISO week number
  tasks/
    TASK-NNN-<slug>.md
    TASK-NNN.analysis.md    # architect + tech-lead output
    TASK-NNN.review.md      # reviewer findings
    TASK-NNN.test.md        # tester findings
  archive/                  # done/cancelled tasks (keeps tasks/ light)
    TASK-NNN-<slug>.md
```

### Task frontmatter (mandatory fields)

```yaml
---
id: TASK-042
title: Fix reconcile.ts:188 riskedUsd uses qty not initial_qty
epic: EPIC-001                  # optional
sprint: 2026-W22                # optional
status: pending                 # pending|in_progress|review|rework|testing|done|blocked|cancelled
assignee: ""                    # agent name, empty if unclaimed
reviewer: ""                    # agent name, set when dispatched
severity_threshold: important   # important|nit — minimum severity that blocks
blocked_by: []                  # list of task IDs
created: 2026-05-24
updated: 2026-05-24
iteration: 0                    # how many review→rework cycles
artifacts: []                   # files that will be / were changed
acceptance:                     # list — must all pass for status: done
  - "All reconcile R-values match Bybit closedPnL within 0.01R"
  - "Backtest still passes walk-forward gate"
---
```

### Status lifecycle

```
pending ──claim──▶ in_progress ──submit──▶ review
                                              │
                       ┌──────────────────────┤
                       │ Important found      │ no Important
                       ▼                      ▼
                    rework ──resubmit──▶  testing
                       ▲                      │
                       │                      │ tests pass
                       │                      ▼
                       │                    done ──▶ archive/
                       │
   any state ─block(dep|news|risk)─▶ blocked ─unblock─▶ prior state
```

### Status transitions — who is allowed

| From → To | Allowed agent |
|---|---|
| `pending → in_progress` | `dev-node-ts` (sets `assignee`) |
| `in_progress → review` | `dev-node-ts` |
| `review → rework` | `code-reviewer` (Important found) |
| `review → testing` | `code-reviewer` (no Important) |
| `testing → done` | `tester` |
| `testing → rework` | `tester` (acceptance fails) |
| `done → archive/` | `orchestrator` (file move) |
| `* → blocked` | any agent (sets `blocked_by` or `blocked_reason`) |
| `blocked → prior` | `orchestrator` |
| `* → cancelled` | `orchestrator` (operator decision) |

### Handoff is via files, not chat

When `code-reviewer` flags Important findings, it writes them into `TASK-NNN.review.md` and sets `status: rework`. The dev-agent picks the task up next cycle, reads `.review.md`, fixes, resubmits. No chat round-trip between agents.

### Index

`board/index.json` is the cache. Schema:

```json
{
  "tasks": {
    "TASK-042": {
      "status": "review",
      "assignee": "dev-node-ts",
      "epic": "EPIC-001",
      "sprint": "2026-W22",
      "updated": "2026-05-24T14:00:00Z",
      "iteration": 1,
      "blocked_by": []
    }
  },
  "epics": { "EPIC-001": { "title": "...", "status": "active", "tasks": ["TASK-042"] } },
  "sprints": { "2026-W22": { "active": true, "tasks": ["TASK-042"] } }
}
```

Every agent that mutates a task file must also update `index.json`. The `/board` slash command rebuilds it from scratch on demand.

---

## 4. Code Quality Contract

**Every dev-agent must follow this. The reviewer enforces it. Hook `warn-comments.sh` surfaces violations at edit time.**

### Paradigm

- **OOP where state exists.** A class is justified when it owns invariants or lifecycle. Pure transformations stay as functions.
- **SOLID:**
  - **S** (Single Responsibility) — one reason to change per unit. No "manager" classes that do five things.
  - **O** (Open/Closed) — extend via composition or strategy, not by editing existing class internals.
  - **L** (Liskov) — subtypes must be drop-in replacements. No "this method throws on subclass X".
  - **I** (Interface Segregation) — small interfaces. A consumer asks for `Reader`, not `FileSystem`.
  - **D** (Dependency Inversion) — depend on abstractions. Bybit client, db client, telegram client — injected, never imported at point-of-use in domain code.
- **KISS** — write the simplest version that works. Optimize after a profiler points at something. Three similar lines beat a premature abstraction.
- **DRY** — refactor on the **third** occurrence, not the second. Two similar blocks may stay duplicated if abstracting them couples unrelated concerns.

### Comments

**Default: no comments.** Code documents itself through names. Specifically forbidden:

- Comments that describe **what** the code does (the code does that).
- Comments that reference the task, PR, or commit (rot fast, belong in commit message).
- Comments that paraphrase a function name.

**Whitelisted comments** (allowed, hook ignores them):

- TypeScript pragmas: `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`.
- ESLint pragmas: `// eslint-disable-*`, `/* eslint-disable */`.
- Prettier pragmas: `// prettier-ignore`.
- Shebangs: `#!/usr/bin/env node`.
- Comments **explaining a non-obvious WHY** — hidden constraint, subtle invariant, workaround for a known bug. Must include a reference: bug ID, link, or measured behavior. Maximum one short line.

If you feel a comment is needed, first try renaming the variable or extracting a function. Only fall back to a comment if the WHY truly can't be expressed in code.

### Formatting

- **Logical blocks separated by blank lines.** A function with three responsibilities reads as three paragraphs.
- **One concept per line.** No clever chains that pack three operations on one line for brevity.
- **Names:**
  - Functions = verbs (`computeRiskedUsd`, not `riskedUsd`).
  - Variables/classes = nouns (`riskedUsd`, `RiskGuard`).
  - Booleans = predicates (`isBlocked`, `hasOpenPosition`, not `blocked`, `position`).
- **Indentation** as configured (TS = 2 spaces, project default). No mixed tabs/spaces.
- **Imports grouped:** external libs → core/shared → local. Blank line between groups.

### Error handling

- Validate at boundaries (user input, exchange API responses, DB row schemas). Don't validate inside internal pure functions — trust your own types.
- No silent catches. Either rethrow with context or handle a specific known case and log.
- No fallback values that mask a real error (`?? 0` on a missing API field is a bug, not resilience).

### TypeScript

- `strict: true` is mandatory; no implicit `any`.
- No `as` casts unless narrowing a known wider type. `as unknown as X` is a code smell — find the right type.
- Prefer `readonly` for shared structures. `const` for locals.
- No default exports for code (only allowed for CLI entrypoints).

---

## 5. Operator interaction

- Operator interacts only with the orchestrator (via `/orchestrate`, `/board`, `/task-new`, etc.).
- Operator may invoke `trader` directly for live-trading concerns (news halt, reconcile escalation).
- Operator may invoke `architect` directly for ad-hoc deep-dives (no board entry needed).
- All other dev-agents are **never invoked directly** — they only run inside the orchestration flow.

---

## 6. Inviolables (from `CLAUDE.md`)

All agents must respect the runtime contract in `CLAUDE.md`. Specifically:

- Forbidden shell patterns (heredocs, `node -e`, `$(...)`, `<(...)`) are enforced by hooks; agents must use Read/Write/Edit tools or committed `npx tsx` scripts.
- Live-trading code (`src/runtime/auto-execute.ts`, `src/runtime/execute.ts`, `src/runtime/risk-guard.ts`, `src/runtime/reconcile.ts`) is **highest sensitivity** — code-reviewer must apply maximum scrutiny.
- Backtest changes require a walk-forward proof (PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R, ≥ 100 trades) before going live.
- Telegram style is Russian, no slang, every message says *what / why / what next*.

---

## 7. Stack constraints

- TypeScript 6.x, Node.js, `tsx` runner.
- Dependencies: `pg`, `bybit-api`, `telegraf`, `technicalindicators`, `ws`, `dotenv`. No React, no Next, no Nest, no Python (yet).
- DB: Postgres via `pg` driver. Migrations in `migrations/`.
- No new dependencies without architect approval.

---

## 8. References

- `CLAUDE.md` — runtime contract (inviolable).
- `board/README.md` — board usage guide.
- `.claude/agents/<name>.md` — per-agent operating manual.
- `.claude/skills/<verb>/SKILL.md` — workflow verbs agents invoke.
- `.claude/commands/<name>.md` — slash commands operator runs.
