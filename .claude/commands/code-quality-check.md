---
description: "Check one or more source files against the code-quality contract from .claude/TEAM.md § 4 (OOP/SOLID/KISS/DRY, no comments, formatting). Read-only, no edits."
argument-hint: "<file path> [<file path> ...]"
---

# /code-quality-check — Static Lint Against TEAM.md § 4

Read-only check that one or more source files comply with the team's code-quality contract. Doesn't replace `npm run typecheck` — runs in addition.

**Arguments:** `$ARGUMENTS`

## Procedure

1. Parse file paths from `$ARGUMENTS`. Validate each is under `src/` (or `scripts/`).

2. For each file, read it with the Read tool.

3. Run these checks. For each violation, output `file:line — <category> — <description>`.

### Check 1 — Comments outside whitelist

Whitelist (ok):

- `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`.
- `// eslint-disable-*`, `/* eslint-disable */`.
- `// prettier-ignore`.
- `#!/...` shebang.
- One-line "WHY" comment if it includes a reference (bug ID, link, "measured X ms").

Everything else flagged as **violation**.

Regex (informational — apply with judgment, not blindly):

- Single-line: `^\s*//(?!\s*(@ts-|eslint-|prettier-)).+`
- Block: `/\*[^*].*\*/` (multi-line block comments).

Note: JSDoc `/** ... */` is **not** whitelisted in this project — code self-documents.

### Check 2 — Logical block formatting

Functions longer than ~10 lines should have blank lines separating logical groups (parsing → computation → side-effect → return). If a function is 30 lines with zero blank lines inside, flag it.

### Check 3 — Naming conventions

- Function names: should be verbs. Flag exports like `export const riskedUsd = ...` if they return a value but read as a noun. (`computeRiskedUsd` is correct.)
- Boolean variables/parameters: should be predicates. Flag `let blocked = false` if it's used in `if (blocked)`. Should be `isBlocked`.
- Class names: PascalCase nouns.

### Check 4 — Default exports outside CLI entrypoints

Default export OK in:
- `src/backtest/cli/*.ts`
- `src/tools/diagnostics/*.ts` invoked via `npx tsx`
- `src/runtime/scan-decide.ts`, `src/runtime/auto-execute.ts`, `src/runtime/execute.ts`, `src/runtime/reconcile.ts`, `src/runtime/position-watcher.ts`, `src/tools/ops/heartbeat.ts` (CLI entrypoints invoked from `scripts/cycle.sh` or `package.json` scripts).
- `src/bot/tg-bot.ts`.

Anywhere else — flag.

### Check 5 — Suspect casts

- `as unknown as X` — flag.
- `as any` — flag.
- `// @ts-ignore` without a comment explaining why on the same or prior line — flag.

### Check 6 — N+1 DB query patterns

Heuristic: `for` or `while` loop containing `await db.query` or `await pgClient.query`. If found, flag.

### Check 7 — Forbidden shell patterns referenced in code

(Less common — usually hooks catch these in actual command execution. But code might embed them.)

Scan for: `child_process.exec` with heredoc, `node -e`, raw curl to `api.telegram.org`. Flag.

### Check 8 — Logical block in TypeScript classes

For classes with > 3 methods, check that each method is separated from the next by a blank line.

## Output format

```
src/runtime/reconcile.ts:78  Comment outside whitelist
  Line: "// fallback for legacy rows"
  Action: rename variable or remove. If a real "WHY" justifies it, add a reference.

src/runtime/reconcile.ts:188  Naming convention
  `const qty = trade.qty` followed by `if (qty)` reads as predicate.
  Suggest renaming destructure: `const hasQty = trade.qty != null` if predicate intent.

src/runtime/reconcile.ts:201-235  Logical block formatting
  Function `settleTrade` is 35 lines with no blank-line separators.
  Suggest grouping: parse (201-210), compute R (211-218), update DB (219-228), notify (229-235).
```

End with a summary:

```
Files checked: 1
Violations: 3
  Comments: 1
  Naming: 1
  Formatting: 1
```

## Anti-patterns

- ❌ Auto-fixing. This command is read-only.
- ❌ Treating heuristics as gospel — flag as suggestions, let dev judge.
- ❌ Flagging the whitelisted comments.

## Tip

Reviewers run this command during review. Devs run it before submitting.
