# `.claude/` — Operator Quick Reference

This directory holds the multi-agent development team configuration for the trading bot project.

**Two contracts coexist here:**

- `CLAUDE.md` (project root) — the **runtime** contract for the bot itself. Inviolable.
- `.claude/TEAM.md` — the **team** contract for agents that develop the bot.

If they conflict, `CLAUDE.md` wins.

---

## Layout

```
.claude/
  README.md         ← this file
  TEAM.md           ← team contract: flow, board, code quality
  settings.json     ← permissions, hooks, MCP servers
  settings.local.json  ← local-only overrides (untracked)

  agents/
    orchestrator.md       ← dispatcher (always the entry point)
    architect.md          ← deep analysis, ADRs
    tech-lead.md          ← validates analysis, briefs devs
    planner.md            ← writes board entries
    dev-node-ts.md        ← implements code (parallel-spawnable)
    code-reviewer.md      ← critical review (fresh context)
    tester.md             ← acceptance verification
    trader.md             ← LIVE-TRADING maintainer (separate role)

  skills/
    plan-feature/         ← planner recipe
    architect-analysis/   ← architect recipe
    code-review/          ← reviewer recipe
    smoke-test/           ← tester recipe
    board-update/         ← canonical board mutation (all agents)
    handoff/              ← file-based agent-to-agent communication

  commands/
    orchestrate.md        ← /orchestrate "<task>" — entry point
    board.md              ← /board [status|task|next|sprint|reindex]
    task-new.md           ← /task-new "<title>" [--epic ...] [--live-sensitive]
    epic-new.md           ← /epic-new "<title>" [--target-sprint ...]
    sprint-new.md         ← /sprint-new <YYYY-WNN> [--tasks ...] [--capacity-hours ...]
    spec-new.md           ← /spec-new <feature> — opens specs/NNN-<slug>/
    code-quality-check.md ← /code-quality-check <file> — static lint
    trade-scan.md         ← LIVE TRADING — Claude-driven cycle (kept)
    claude-walk-decide.md ← LIVE TRADING — backtest snapshot decider (kept)

  hooks/
    block-heredoc.sh      ← forbidden shell patterns (CLAUDE.md)
    block-destructive.sh  ← catastrophic operations
    warn-comments.sh      ← TEAM.md § 4 comment policy (advisory)

  docs/research/          ← 35 trading-book summaries (reference)
```

---

## How to use (operator)

### Day-to-day

```
/orchestrate "fix reconcile.ts:188 — use initial_qty for R calc"
```

Drops into the multi-agent flow:
- Orchestrator creates `TASK-NNN`.
- Architect analyzes.
- Tech-lead signs off.
- Dev implements.
- Reviewer reviews.
- Tester verifies.
- Orchestrator reports back.

### Inspect the board

```
/board              # overview
/board status review
/board task TASK-042
/board next         # unclaimed work
/board reindex      # rebuild index.json from disk
```

### Manual task entry (skips orchestration)

```
/task-new "tighten BTC funding-fade threshold" --live-sensitive
/epic-new "incremental scan-decide refactor"
/sprint-new 2026-W23 --capacity-hours 20
/spec-new portfolio-rebalancer
```

### Code quality lint

```
/code-quality-check src/runtime/reconcile.ts
```

### Live trading (unchanged)

```
/trade-scan
/claude-walk-decide 5
```

These are the legacy live-trading entry points. Untouched by this configuration; see `.claude/agents/trader.md` for the live-trading maintainer role.

---

## Flow at a glance

```
USER → /orchestrate
        │
        ▼
   orchestrator
        │
   ┌────┼────┐
   ▼    ▼    ▼
  architect tech-lead planner
        │
        ▼
   dev-node-ts × N (parallel where independent)
        │
        ▼
   code-reviewer (fresh)
        │ Important?
   ┌────┴────┐
   ▼ yes     ▼ no
 rework    testing
  │         │
  └─────►   tester
             │
             ▼
            done → archive/
```

See `.claude/TEAM.md § 2` for the detailed state machine.

---

## Code quality contract (TL;DR)

Full version in `.claude/TEAM.md § 4`.

- OOP **where state exists**. SOLID, KISS (simplest version first), DRY (refactor on 3rd occurrence).
- **No comments.** Whitelist: TS/ESLint/Prettier pragmas, shebangs, one-line WHY for a real subtle invariant with a reference token.
- Logical blocks in functions separated by blank lines.
- Names: functions = verbs, classes/variables = nouns, booleans = predicates.
- TypeScript strict, no `as any` / `as unknown as X`.
- No new dependencies without architect approval.

The `warn-comments.sh` hook surfaces comment violations at Edit/Write time (advisory, not blocking).

---

## Hooks

| Hook | Trigger | Behavior |
|---|---|---|
| `block-heredoc.sh` | Bash | Hard-blocks heredocs, `node -e`, `$(...)`, `<(...)`, `$870`-style |
| `block-destructive.sh` | Bash | Hard-blocks `rm -rf /`, force-push to main, mkfs, etc. |
| `warn-comments.sh` | Edit / Write | Warns on non-pragma comments in `src/` |

---

## Conflicts with system-level skills

Two names overlap with system skills loaded from `~/.claude/`:

- `code-review` — system has `/code-review` for PR review; we have `code-review` skill the reviewer agent invokes. The project-local skill takes precedence inside our flow.
- `board` — only ours.

If a system skill ever supersedes a project skill we depend on, the affected agent will fail loudly (it reads the skill content as part of its workflow). No silent fallback.

---

## What's NOT in this configuration

- **React, Next, Nest, Python agents** — operator confirmed stack is pure Node + TS.
- **`claude-mem` MCP server** — overkill for one-operator project; existing `MEMORY.md` + auto-memory + `vault/` covers it.
- **`paperclip` orchestration server** — too heavy; we use file-based board instead.
- **Git worktree dispatch** — currently parallel devs share the working tree. If this becomes a problem (merge conflicts during parallel runs), switch to worktree-isolated dev spawns later.

---

## Live-trading separation

The trader/maintainer flow is **separate** from the development flow:

- `agents/trader.md` — maintainer of the live bot (news halts, reconcile escalation, cron debugging).
- `commands/trade-scan.md`, `claude-walk-decide.md` — legacy live-trading commands (kept).
- `src/runtime/auto-execute.ts` runs autonomously via cron — no Claude in the hot path.

When the dev team (orchestrator+architect+...) touches `src/runtime/`, `src/strategies/`, `src/data/backfill.ts`, or backtest engine, the `live_sensitive: true` flag activates extra scrutiny per `TEAM.md` and `CLAUDE.md` inviolables.

---

## Updating this setup

- Add an agent → drop new `.md` in `.claude/agents/` with `name` + `description` frontmatter.
- Add a skill → new directory under `.claude/skills/<verb>/SKILL.md`.
- Add a command → new `.md` in `.claude/commands/`.
- Add a hook → script in `.claude/hooks/`, registered in `.claude/settings.json` `hooks`.
- Always test with `/board reindex` after schema changes to `board/index.json`.

See `.claude/TEAM.md` for the deeper contract.
