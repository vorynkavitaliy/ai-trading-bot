import { report } from '../report';
import { close as closePg } from '../../../lib/db';
import { log } from '../../../lib/logger';

async function main() {
  await report();
  await closePg();
}

main().catch(async (e) => {
  log.error('claude-walk report failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
