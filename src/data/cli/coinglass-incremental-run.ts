import { runCgIncremental } from '../coinglass-backfill';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  await runCgIncremental();
  await closePg();
}

main().catch(async (e) => {
  log.error('coinglass-incremental failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
