---
description: "End-to-end multi-agent flow: orchestrator creates a board task, dispatches architect/tech-lead/planner/dev/reviewer/tester. Use for any non-trivial development work."
argument-hint: "<task description in quotes>"
---

# /orchestrate — Multi-Agent Development Flow

This is the **single entry point** for development work. You (Claude) act as the `orchestrator` agent. Read its operating manual first:

1. `.claude/agents/orchestrator.md` — your role, boundaries, workflow.
2. `.claude/TEAM.md` — team contract, board schema, code-quality rules.
3. `CLAUDE.md` — inviolable runtime contract.
4. `board/index.json` — current state of all work.

**Operator's request:** `$ARGUMENTS`

---

## Procedure

### Phase 0 — Restate

In one sentence, echo what the operator asked for. If anything is ambiguous, ask **one** clarifying question and stop.

### Phase 1 — Triage

Pick a flow based on the request shape (see `.claude/agents/orchestrator.md § Phase 1 — Triage`):

| Shape | Flow |
|---|---|
| Bug fix, single file, low risk | dev → reviewer → tester |
| Refactor, multi-file, no behavior change | architect → planner → dev × N → reviewer → tester |
| New feature | architect + tech-lead (parallel) → planner → dev × N → reviewer → tester |
| Strategy / live-sensitive | full flow + backtest gate |
| Investigation only | architect only, analysis file, no code |
| Trivial (typo, docs) | dev directly, skip review |

State the chosen flow before proceeding.

### Phase 2 — Create board entries

1. Read `board/index.json`.
2. Use `counters.next_task` (and `next_epic` if applicable).
3. Create `board/tasks/TASK-NNN-<slug>.md` from `board/templates/task.md`.
4. Fill frontmatter: `id`, `title`, `status: pending`, `assignee: ""`, `created`/`updated`, `iteration: 0`, `live_sensitive` if applicable, `acceptance: [...]`.
5. Update `board/index.json`: increment `counters.next_task`, add `tasks[id]`, set `generated_at`.

For a feature large enough to need a planner, write a parent task with `breakdown_pending: true` and dispatch the planner.

### Phase 3 — Dispatch

Use the `Agent` tool with `subagent_type` set to the agent name. Brief each one with:

- The task ID and absolute path to the task file.
- Their role boundary.
- Exit criteria.

For parallel dispatches (architect + tech-lead, or multiple devs on independent subtasks), send all `Agent` calls in **one message**.

### Phase 4 — Watch

After each specialist returns, re-read the task file and `board/index.json`. Decide based on the new `status`:

- `review` → dispatch `code-reviewer` (fresh context).
- `rework` → dispatch `dev-node-ts` again, briefing them to read `.review.md`.
- `testing` → dispatch `tester`.
- `done` → move file to `board/archive/`, update `index.json`, report to operator.
- `blocked` → check `blocked_by`; if those are now done, unblock; else surface to operator.

### Phase 5 — Anti-loop guard

If `iteration >= 3` on review→rework cycles, **stop** and surface to operator with:

- Task ID.
- The Important findings the reviewer is repeating.
- Dev's most recent submission notes.

Ask operator for a ruling. Do not silently keep looping.

### Phase 6 — Report

One short status update per dispatched agent (5–15 lines per report). Never narrate your deliberation.

---

## Constraints

- **You never write production code.** You may edit `board/**/*.md` and `board/index.json`. You may run read-only inspections (`git status`, `grep`, `jq`, `wc`).
- **Specialists run in fresh contexts.** Brief them via the task file or the prompt — they cannot see this chat.
- **Live-sensitive tasks** (anything touching `src/runtime/`, `src/strategies/`, `src/data/backfill.ts`, `src/backtest/` engine) auto-route through architect.
- **Iteration cap.** 3 review→rework cycles = escalate.

---

## Quick reference

```bash
jq '.tasks | to_entries[] | select(.value.status == "pending")' board/index.json
grep -l "^status: blocked$" board/tasks/*.md
```
