#!/bin/bash
# Pre-Bash hook: blocks heredoc patterns in bash commands.
# Heredocs (`<< 'EOF'` or `<<EOF`) trigger Claude Code's permission prompt
# on every /loop cycle and break autonomous operation.
#
# Rule violations this blocks:
#   - cat > file << 'EOF' ... EOF
#   - cat >> file << 'EOF' ... EOF
#   - python3 << 'EOF' ... EOF
#   - node -e '...' with heredoc
#
# Allowed alternatives:
#   - Edit tool (for appending/modifying existing files)
#   - Write tool (for creating new files)
#   - npx tsx src/journal-append.ts (for journal appends specifically)
#   - npx tsx src/scan-summary.ts (for JSON inspection)
#
# Input: JSON on stdin with tool_input.command
# Output: exit 2 + stderr message to block the tool call; exit 0 to allow.

input=$(cat)
# Use jq for reliable JSON parsing (escaped quotes, newlines, unicode).
command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [ -z "$command" ]; then
  # Fallback if jq fails — allow through (don't break non-Bash tools)
  exit 0
fi

# Detect unescaped dollar-amount patterns (`$870`, `$1,234`, `$0.5`).
# These trigger Claude Code's "simple_expansion" detector in bash arg parsing.
# Any `$` followed by a digit is almost always a USD amount, never a real variable.
# Allow escaped: `\$870`.
if echo "$command" | grep -qE '(^|[^\\])\$[0-9]'; then
  cat >&2 <<'MSG'
🚫 Dollar-sign inside double-quoted string blocked.

The harness treats "$123" or "$abc" inside double-quoted bash args as shell expansion
and prompts for permission every time. This is broken for /loop autonomy.

Fixes:
  • For trade rationale → use `--rationale-file /tmp/rationale.txt` instead of `--rationale "..."`
    (Write tool creates file, execute.ts reads it; supports $ signs freely)
  • In message text → escape with backslash: `\$870` instead of `$870`
  • Or replace `$` with `USD` / `$` with `доллар`

See CLAUDE.md § "Autonomous Execution — Command Discipline".
MSG
  exit 2
fi

# Detect heredoc pattern — `<<` followed by optional quote and identifier
if echo "$command" | grep -qE '<<\s*-?\s*['\''"]?[A-Za-z_][A-Za-z0-9_]*['\''"]?'; then
  cat >&2 <<'MSG'
🚫 Heredoc pattern blocked.

Bash heredocs (`<< 'EOF'`, `<<EOF`, etc.) are forbidden in this project because
they trigger Claude Code permission prompts on every /loop cycle, breaking autonomy.

Use one of these instead:

  • Journal append → Edit tool (find last line, append new entry)
                  OR npx tsx src/journal-append.ts --file /tmp/entry.md

  • Create new file → Write tool

  • JSON inspection → npx tsx src/scan-summary.ts (saves to /tmp, read via Read tool)

See CLAUDE.md § "Autonomous Execution — Command Discipline" for full rules.
MSG
  exit 2
fi

# Detect inline-code-eval patterns — python3 -c, node -e, perl -e, ruby -e, etc.
# These trigger harness "newline followed by # inside quoted argument" security prompt
# because `#` in multi-line code can look like argument-hiding. Broken for /loop autonomy.
# Hit 2× on 2026-04-22 (extracting scan-data JSON, inspecting balance-snapshots.json).
if echo "$command" | grep -qE '(^|[^A-Za-z0-9_-])(python3?|node|nodejs|perl|ruby|php|deno|bun)[[:space:]]+-(c|e)[[:space:]]'; then
  cat >&2 <<'MSG'
🚫 Inline-code-eval pattern blocked.

Commands like `python3 -c "..."`, `node -e "..."`, `perl -e`, etc. are forbidden:
their multi-line quoted strings trigger the harness "newline followed by # inside
quoted argument" security detection → permission prompt every cycle → bot hangs.

Use one of these instead:

  • Need structured data from JSON?
    → Save to /tmp with Write tool OR npx tsx src/scan-summary.ts
    → Read with Read tool (handles JSON natively)
    → If recurring need: add the field to src/scan-data.ts + scan-summary.ts,
      commit as reusable infra. NEVER shell out inline.

  • Need to process a committed file?
    → Write a proper committed src/my-tool.ts and invoke `npx tsx src/my-tool.ts`
    → Covered by `Bash(npx tsx *)` allowlist.

  • Need a one-off inspection?
    → `cat /path/to/file` + Read tool OR jq (jq --version is allowed)

See memory/execution_discipline.md for the full forbidden-patterns list.
MSG
  exit 2
fi

exit 0
