---
name: handoff
description: Use when an agent finishes its phase and needs to hand off to another agent. The canonical pattern is: write the handoff payload to a file, update the task frontmatter to signal the next phase, then reply to the orchestrator with a one-line summary. Agents communicate through files, never through chat history.
---

# handoff — File-based agent-to-agent communication

Claude Code subagents run in **isolated contexts** — the next agent does not see the prior agent's chat. If you "tell" it something only in your reply, it's lost. Everything that matters must be on disk.

## When to invoke

Whenever your phase ends and the orchestrator will dispatch a different agent next.

## Procedure

### 1. Write the handoff payload

The receiving agent will read one of these files:

| From → To | Payload file |
|---|---|
| `architect → tech-lead` | `board/tasks/TASK-NNN.analysis.md` |
| `tech-lead → planner` or `tech-lead → dev` | append "Tech lead sign-off" section to `TASK-NNN.analysis.md` |
| `planner → dev` | new `TASK-NNN-*.md` task files with `status: pending` |
| `dev → reviewer` | the diff (committed or unstaged) + task file's "Notes" entry |
| `reviewer → dev` | `board/tasks/TASK-NNN.review.md` (Important findings) |
| `reviewer → tester` | `board/tasks/TASK-NNN.review.md` (no Important, optional Nits) |
| `tester → orchestrator` | `board/tasks/TASK-NNN.test.md` |

Make sure the payload file is complete BEFORE updating status. Half-written files cause silent failures downstream.

### 2. Update task frontmatter to signal the next phase

Set `status` per the lifecycle. Set `updated: <now>`. Per the `board-update` skill, also update `index.json`.

### 3. Reply to the orchestrator

```
TASK-042 handed off.
  status: in_progress → review
  next: code-reviewer
  payload: board/tasks/TASK-042.review.md ← will be created by reviewer
```

5–10 lines max. The orchestrator dispatches the next agent based on the new `status`.

## What NOT to do

- ❌ Pass information "in the reply" instead of writing it to a file.
- ❌ Update `status` before the payload file is fully written.
- ❌ Skip `index.json` update — the orchestrator's first query uses it.
- ❌ Modify a task's body for something the next agent will read once and forget — use the `## Notes` thread instead.

## Why files, not chat

- **Resumability** — a flow that takes 4 hours can resume from any agent at any point because state is on disk.
- **Auditability** — operator reads `TASK-NNN.*.md` to see who did what when.
- **Isolation** — fresh-context agents (`code-reviewer`, `tester`) don't carry the dev's biases.
- **Parallelism** — three devs working on three tasks don't poison each other's context.

## Handoff anti-patterns

- ❌ "I'll just tell the reviewer in chat what to look for" — they don't see your chat.
- ❌ "The orchestrator will pass my notes along" — orchestrator routes, doesn't ferry payloads.
- ❌ "The next agent can `git log` my commits" — git is supplementary; the task file is canonical.
