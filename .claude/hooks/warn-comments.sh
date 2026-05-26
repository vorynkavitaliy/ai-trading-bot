#!/bin/bash
# Pre-Edit / Pre-Write hook: surfaces comment-policy violations.
#
# Per .claude/TEAM.md § 4: agents should not leave comments in production code.
# Whitelist:
#   - TypeScript pragmas:  // @ts-ignore, // @ts-expect-error, // @ts-nocheck
#   - ESLint pragmas:      // eslint-disable-*, /* eslint-disable */
#   - Prettier pragmas:    // prettier-ignore
#   - Shebangs:            #!/...
#   - One-line WHY:        // ... contains a reference [BUG-, REF-, issue, http(s)://, "measured "]
#
# Scope: only files under src/ (project code). Tests, configs, scripts skipped.
#
# Behavior: WARN (not block) — print to stderr with exit 0. Reviewer/dev decides.
# We don't hard-block because legitimate TS/ESLint pragmas can be misclassified
# by a regex, and false-blocks during a real bug hunt are worse than a missed nit.

set -u
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only care about Edit/Write into src/
if [ -z "$file_path" ]; then exit 0; fi
case "$file_path" in
  */src/*) ;;
  *) exit 0 ;;
esac
case "$file_path" in
  *.test.ts|*.spec.ts|*__tests__*) exit 0 ;;
esac

# Extract new content depending on tool
new_text=""
case "$tool_name" in
  Edit)
    new_text=$(echo "$input" | jq -r '.tool_input.new_string // empty' 2>/dev/null)
    ;;
  Write)
    new_text=$(echo "$input" | jq -r '.tool_input.content // empty' 2>/dev/null)
    ;;
  *)
    exit 0
    ;;
esac

if [ -z "$new_text" ]; then exit 0; fi

# Scan line-by-line for suspect comments.
violations=0
suspect_lines=""
line_no=0

while IFS= read -r line; do
  line_no=$((line_no + 1))

  # Strip leading whitespace
  trimmed="${line#"${line%%[![:space:]]*}"}"

  # Skip empty
  [ -z "$trimmed" ] && continue

  # Whitelist matches — skip
  case "$trimmed" in
    '#!/'*) continue ;;
    '// @ts-'*) continue ;;
    '// eslint-'*) continue ;;
    '/* eslint-'*) continue ;;
    '// prettier-ignore'*) continue ;;
    '/* @ts-'*) continue ;;
  esac

  # Check for single-line // comments
  case "$trimmed" in
    '//'*)
      # Look for a reference token that justifies a WHY comment
      if echo "$trimmed" | grep -qE '(BUG-[A-Z0-9]+|REF-[A-Z0-9]+|TASK-[0-9]+|issue\s*#?[0-9]+|https?://|measured\s+[0-9])'; then
        continue
      fi
      violations=$((violations + 1))
      suspect_lines="${suspect_lines}  line ${line_no}: ${trimmed}\n"
      ;;
    '/*'*)
      # Block comments: flag the opener line; not detailed multi-line analysis
      if echo "$trimmed" | grep -qE '\*\s*(eslint-|@ts-)'; then continue; fi
      violations=$((violations + 1))
      suspect_lines="${suspect_lines}  line ${line_no}: ${trimmed}\n"
      ;;
  esac
done <<< "$new_text"

if [ "$violations" -gt 0 ]; then
  printf "⚠️  Comment policy (.claude/TEAM.md § 4): %d suspect comment(s) in %s\n" "$violations" "$file_path" >&2
  printf "%b" "$suspect_lines" >&2
  echo "" >&2
  echo "Allowed: TypeScript/ESLint/Prettier pragmas; shebangs; one-line WHY with a reference" >&2
  echo "         (BUG-/REF-/TASK-/issue #/https?://, 'measured Nms')." >&2
  echo "If the comment is justified, add a reference token to it. Otherwise: rename the variable" >&2
  echo "or extract a function so the code self-documents." >&2
fi

# Always allow — this is advisory.
exit 0
