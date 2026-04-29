import { runIncremental } from '../backfill';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

async function main() {
  await runIncremental();
  await closePg();
}

main().catch(async (e) => {
  log.error('incremental-run failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
