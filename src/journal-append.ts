#!/usr/bin/env npx tsx
/**
 * journal-append.ts — canonical helper for appending entries to today's journal.
 *
 * Replaces `cat >> vault/Journal/{DATE}.md << 'EOF' ... EOF` which triggers
 * permission prompts and is explicitly forbidden (see CLAUDE.md § Autonomous
 * Execution — Command Discipline and feedback_autonomous_no_heredoc.md).
 *
 * Usage:
 *   npx tsx src/journal-append.ts "$(cat <<'EOF'
 *   entry body with multiple
 *   lines is fine here
 *   EOF
 *   )"
 *
 * Better (no heredoc, single-arg):
 *   echo "entry body" | npx tsx src/journal-append.ts --stdin
 *
 * Or write a tmp file and:
 *   npx tsx src/journal-append.ts --file /tmp/entry.md
 *
 * Simplest — pass as a single argument (for short entries):
 *   npx tsx src/journal-append.ts "### [17:30] — Цикл N\n\n**Decision:** FLAT."
 *
 * Note: the script appends the body verbatim to vault/Journal/{YYYY-MM-DD}.md.
 * It does NOT add its own timestamp — the caller provides the `### [HH:MM]` header.
 *
 * If you can use the Edit tool instead, PREFER THAT. This script is a fallback for
 * cases where Bash is the only available path.
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function journalPath(): string {
  return resolve(process.cwd(), `vault/Journal/${todayUTC()}.md`);
}

async function readStdin(): Promise<string> {
  return new Promise((res) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk.toString()));
    process.stdin.on("end", () => res(data));
  });
}

async function main() {
  const args = process.argv.slice(2);
  let body: string;

  if (args[0] === "--stdin") {
    body = await readStdin();
  } else if (args[0] === "--file" && args[1]) {
    body = readFileSync(args[1], "utf8");
  } else if (args.length === 1) {
    body = args[0].replace(/\\n/g, "\n");
  } else {
    console.error(
      "Usage: npx tsx src/journal-append.ts <body> | --stdin | --file <path>",
    );
    process.exit(1);
  }

  const path = journalPath();

  if (!existsSync(path)) {
    // Create with minimal frontmatter if missing
    writeFileSync(
      path,
      `---\ndate: ${todayUTC()}\n---\n\n# Trading Journal ${todayUTC()}\n\n`,
    );
  }

  // Ensure separation between entries
  const prefix = body.startsWith("\n") ? "" : "\n";
  appendFileSync(path, prefix + body + (body.endsWith("\n") ? "" : "\n"));
  console.log(`✅ Appended to ${path} (${body.length} chars)`);
}

main().catch((e) => {
  console.error("journal-append failed:", e);
  process.exit(1);
});
