import { runCgIncremental } from '../data/coinglass-backfill';
import { close as closePg } from '../lib/db';
import { log } from '../lib/logger';

async function main() {
  await runCgIncremental();
  await closePg();
}

main().catch(async e => {
  log.error('cg-incremental crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
