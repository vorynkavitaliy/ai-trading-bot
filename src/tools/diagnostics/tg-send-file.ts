// Send Telegram message from file content. Used by Claude (autonomous loop)
// to send formatted alerts with multi-line / HTML / Russian text without
// shell-escaping pitfalls.
//
// Usage: npx tsx src/tools/diagnostics/tg-send-file.ts /tmp/tg-msg.txt

import fs from 'node:fs';
import { send } from '../../core/telegram';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('usage: npx tsx src/tools/diagnostics/tg-send-file.ts <path>');
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  // raw=true: file content is already pre-formatted HTML (b/i/code/etc tags work).
  await send(text, { raw: true });
  console.log('sent from ' + filePath);
}

main().catch(e => { console.error(e?.message ?? String(e)); process.exit(1); });
