// Send a PRE-FORMATTED HTML message to the Telegram channel from a file.
// Unlike tg-test.ts (which escapes the whole body), this passes raw=true so the
// file's own <b>/<i>/<code> tags render as formatting — the caller owns escaping
// of any literal < > & in the content.
//
// Usage: npx tsx src/tools/diagnostics/tg-send-raw.ts /tmp/message.html
import fs from 'node:fs';
import { send } from '../../core/telegram';
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
  await send(text, { raw: true });
  log.info('telegram raw message sent', { len: text.length });
  console.log(`sent ${text.length} chars`);
}

main().catch((e) => {
  log.error('tg-send-raw failed', { err: e?.message ?? String(e) });
  process.exit(1);
});
