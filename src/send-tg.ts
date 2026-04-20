#!/usr/bin/env npx tsx
/**
 * send-tg.ts — Send arbitrary HTML-formatted message to Telegram.
 *
 * USAGE (preferred — avoids shell quoting / command substitution):
 *   npx tsx src/send-tg.ts --file /tmp/tg-msg.txt
 *
 * Alternate usages (may trigger permission prompts on long content):
 *   npx tsx src/send-tg.ts "short inline message"
 *   echo "msg" | npx tsx src/send-tg.ts
 *
 * DO NOT use `"$(cat /tmp/file.txt)"` — command substitution triggers harness's
 * obfuscation detector and breaks autonomous operation. This is what broke
 * overnight on 2026-04-19/20: heartbeat loop froze on permission prompt for 8+ hours.
 *
 * Reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from .env (loaded via config.ts).
 */
import { readFileSync } from "node:fs";
import { Telegraf } from "telegraf";
import { config } from "./config";

async function main() {
  const args = process.argv.slice(2);
  let text = "";

  // --file <path> — preferred for long messages, no shell quoting
  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    text = readFileSync(args[fileIdx + 1], "utf8").trim();
  } else {
    text = args.join(" ").trim();
  }

  if (!text) {
    text = await new Promise<string>((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (buf += c));
      process.stdin.on("end", () => resolve(buf.trim()));
    });
  }
  if (!text) {
    console.error("send-tg: empty message — nothing to send");
    process.exit(1);
  }

  const token = config.telegram?.token;
  const chatRaw = config.telegram?.chatId;
  if (!token || !chatRaw) {
    console.error("send-tg: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing");
    process.exit(1);
  }
  const chats = String(chatRaw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const bot = new Telegraf(token);
  const results = await Promise.allSettled(
    chats.map((id) =>
      bot.telegram.sendMessage(id, text, { parse_mode: "HTML" }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    for (const r of failed) {
      if (r.status === "rejected")
        console.error("send-tg failed:", (r.reason as Error)?.message ?? r.reason);
    }
    process.exit(1);
  }
  console.log(`send-tg: ok (${chats.length} chat${chats.length > 1 ? "s" : ""})`);
}

main().catch((e) => {
  console.error("send-tg fatal:", e);
  process.exit(1);
});
