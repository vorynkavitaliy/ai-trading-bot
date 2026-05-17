import { runIncremental } from '../backfill';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  await runIncremental();
  await closePg();
}

main().catch(async (e) => {
  log.error('incremental-run failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
