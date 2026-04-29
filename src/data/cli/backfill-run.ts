import { runBackfill } from '../backfill';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

async function main() {
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 365;
  await runBackfill(days);
  await closePg();
}

main().catch(async (e) => {
  log.error('backfill-run failed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
