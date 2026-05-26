---
name: board-update
description: Use when an agent needs to mutate the board — change task status, set assignee, add a comment, increment iteration, update index.json, or move done tasks to archive. The canonical procedure all agents follow to keep the board consistent.
---

# board-update — Canonical board mutation procedure

Every agent that writes to the board MUST follow this skill. Manual edits to frontmatter without updating `index.json` create drift; ad-hoc edits to `index.json` without touching the task file create lies.

## When to invoke

- Changing `status` on any task file.
- Setting `assignee` or `reviewer`.
- Incrementing `iteration`.
- Adding notes to `## Notes`.
- Creating, archiving, or cancelling a task.
- Linking a new task to an epic or sprint.

## Procedure

### 1. Read the task file with the Read tool

Never `cat` it. Note the current `updated:` timestamp — you'll set a new one.

### 2. Read `board/index.json` with the Read tool

You need the current `tasks.TASK-NNN` entry plus `counters`. Don't trust your memory of it.

### 3. Compute the new state

Required updates on **every** mutation:

- Frontmatter: `updated: <now ISO 8601, Z suffix>`.
- `index.json`: `tasks[id].updated` matches.
- `index.json`: `tasks[id].<changed field>` matches the file.
- `index.json`: top-level `generated_at: <now>`.

Special cases:

- Status `pending → in_progress`: also set `assignee` (file and index).
- Status `in_progress → review`: increment `iteration` on first review; later submissions also increment.
- Status `* → done`: orchestrator moves the file to `board/archive/` and updates `tasks[id].archived: true`.
- Status `* → cancelled`: orchestrator only. Set `cancelled_at`, leave the file in `tasks/` for one sprint, then archive.
- New task creation: increment `counters.next_task` in `index.json`, add `tasks[id]`, append to `epics[epic_id].tasks` if applicable.
- New epic creation: increment `counters.next_epic`, add `epics[id]`.

### 4. Validate the transition

Cross-check against `.claude/TEAM.md § 3` "Status transitions — who is allowed". If your agent isn't allowed to make this transition, **stop** and report to orchestrator.

### 5. Write atomically — file first, then index

Write the task file first via the Edit tool (one Edit per logical change — don't pile multiple field updates into one giant `replace_all`). Then write `board/index.json` via Write tool with the full updated JSON.

If you crash between the two writes, the index will be stale — the `/board reindex` command rebuilds it from disk. Note this in your reply to the orchestrator.

### 6. Reply concisely

```
TASK-042: status pending → in_progress, assignee dev-node-ts, iteration 0.
index.json updated.
```

## What NOT to do

- ❌ Edit `index.json` by hand for a status that isn't in the task file yet.
- ❌ Append to `## Notes` without setting `updated:`.
- ❌ Change `iteration` without an associated `status` transition.
- ❌ Move a file to `archive/` while `status` is anything but `done` or `cancelled`.
- ❌ Touch task files for tasks you don't own (not your `assignee`).

## Bash queries you can use

```bash
jq '.tasks["TASK-042"]' board/index.json
grep -l "^status: in_progress$" board/tasks/*.md
ls board/tasks/ | wc -l
```

Read individual task files with the Read tool, not `cat`.

## Atomic claim pattern (for parallel dev-agents)

```
1. Read task file via Read tool.
2. Verify `assignee: ""` and `status: pending`. If not, abandon.
3. Read board/index.json. Verify tasks[id].assignee is also "".
4. Edit task file: set assignee to your ID + status to in_progress + updated to now.
5. Edit index.json: same mirror.
6. Re-read task file. If your assignee survived, you have the claim.
7. If a different assignee is there now, another instance won — abandon.
```

This is best-effort, not transactional. Two simultaneous claims may both think they won, but the next agent (reviewer) will see whichever wrote last. Orchestrator can deduplicate from `index.json` history.
