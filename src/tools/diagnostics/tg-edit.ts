// Edit a previously-sent Telegram message IN PLACE, using the message ids saved by
// tg-send-raw.ts (<htmlFile>.msgrefs.json). The digest slots send via tg-send-raw,
// so e.g. after digest-morning sends /tmp/digest-morning.html, you can later:
//   npx tsx src/tools/diagnostics/tg-edit.ts /tmp/digest-morning.html
// to push an edited /tmp/digest-morning.html into the SAME message (all chats),
// no new message, no duplicate. Telegram allows edits for < 48h.
//
//   npx tsx src/tools/diagnostics/tg-edit.ts <htmlFile> [refsFile]
import fs from 'node:fs';
import { editMessage, SentRef } from '../../core/telegram';

async function main() {
  const file = process.argv[2];
  const refsFile = process.argv[3] ?? `${file}.msgrefs.json`;
  if (!file || !fs.existsSync(file)) {
    console.error('usage: tg-edit.ts <htmlFile> [refsFile]');
    process.exit(1);
  }
  if (!fs.existsSync(refsFile)) {
    console.error(`no saved message ids at ${refsFile} — this message was not sent via tg-send-raw, cannot edit in place. Re-send instead.`);
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf-8');
  if (text.length > 4096) {
    console.error(`message is ${text.length} chars — Telegram limit is 4096`);
    process.exit(1);
  }
  const refs: SentRef[] = JSON.parse(fs.readFileSync(refsFile, 'utf-8'));
  let ok = 0;
  for (const ref of refs) {
    const done = await editMessage(ref.chatId, ref.messageId, text, { raw: true });
    if (done) ok++;
    console.log(`  edit ${ref.chatId}#${ref.messageId}: ${done ? 'updated' : 'failed (>48h or content identical)'}`);
  }
  console.log(`edited ${ok}/${refs.length} chat(s), ${text.length} chars`);
}

main().catch((e) => {
  console.error('tg-edit failed:', e?.message ?? String(e));
  process.exit(1);
});
