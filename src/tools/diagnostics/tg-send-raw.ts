// Send a PRE-FORMATTED HTML message to the Telegram channel from a file.
// Unlike tg-test.ts (which escapes the whole body), this passes raw=true so the
// file's own <b>/<i>/<code> tags render as formatting — the caller owns escaping
// of any literal < > & in the content.
//
// Saves the sent message ids alongside the file (<file>.msgrefs.json) so the same
// message can be edited in place later via tg-edit.ts (e.g. "edit the morning
// digest"). Telegram gives no message_id after the fact, so persisting it at send
// time is the ONLY reliable way to enable in-place edits.
//
// Usage: npx tsx src/tools/diagnostics/tg-send-raw.ts /tmp/message.html
import fs from 'node:fs';
import { sendReturningRefs } from '../../core/telegram';
import { log } from '../../core/logger';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tg-send-raw.ts <file>');
    process.exit(1);
  }
  const text = fs.readFileSync(path, 'utf-8');
  if (text.length > 4096) {
    console.error(`message is ${text.length} chars — Telegram limit is 4096; trim before sending`);
    process.exit(1);
  }
  const refs = await sendReturningRefs(text, { raw: true });
  try {
    fs.writeFileSync(`${path}.msgrefs.json`, JSON.stringify(refs));
  } catch (e: any) {
    log.warn('failed to persist msgrefs (edit-in-place unavailable for this message)', { err: e?.message });
  }
  log.info('telegram raw message sent', { len: text.length, chats: refs.length });
  console.log(`sent ${text.length} chars to ${refs.length} chat(s)`);
}

main().catch((e) => {
  log.error('tg-send-raw failed', { err: e?.message ?? String(e) });
  process.exit(1);
});
