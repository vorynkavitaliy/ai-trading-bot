import { resolveAll } from '../resolve';
import { close as closePg } from '../../../lib/db';
import { log } from '../../../lib/logger';

async function main() {
  await resolveAll();
  await closePg();
}

main().catch(async (e) => {
  log.error('claude-walk resolve failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
