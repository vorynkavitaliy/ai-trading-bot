// Send Telegram message from file content. Used by Claude (autonomous loop)
// to send formatted alerts with multi-line / HTML / Russian text without
// shell-escaping pitfalls.
//
// Usage: npx tsx src/tools/diagnostics/tg-send-file.ts /tmp/tg-msg.txt

import { sendFromFile } from '../../core/telegram';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('usage: npx tsx src/tools/diagnostics/tg-send-file.ts <path>');
    process.exit(1);
  }
  await sendFromFile(filePath);
  console.log('sent from ' + filePath);
}

main().catch(e => { console.error(e?.message ?? String(e)); process.exit(1); });
