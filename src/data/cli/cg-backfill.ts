import { runCgBackfill } from '../coinglass-backfill';
import { close as closePg, runMigrations } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  // Apply pending migrations first (idempotent)
  await runMigrations();
  await runCgBackfill();
  await closePg();
}

main().catch(async e => {
  log.error('cg-backfill crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
