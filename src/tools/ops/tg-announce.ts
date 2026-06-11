// Send an operator announcement to Telegram from a file, with HTML formatting
// preserved (send raw — the file author is responsible for escaping <, >, &
// inside content text; tags like <b>...</b> pass through).
//
//   npx tsx src/tools/ops/tg-announce.ts /tmp/announce.txt
import fs from 'node:fs';
import { send } from '../../core/telegram';

async function main() {
  const path = process.argv[2];
  if (!path || !fs.existsSync(path)) {
    console.error('usage: npx tsx src/tools/ops/tg-announce.ts <file>');
    process.exit(1);
  }
  await send(fs.readFileSync(path, 'utf-8'), { raw: true });
  console.log('announcement sent');
}

main().catch((e) => {
  console.error('tg-announce failed:', e?.message ?? String(e));
  process.exit(1);
});
