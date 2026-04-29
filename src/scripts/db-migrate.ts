import { runMigrations, close } from '../lib/db';
import { log } from '../lib/logger';

async function main() {
  log.info('running migrations');
  await runMigrations();
  log.info('migrations complete');
  await close();
}

main().catch((e) => {
  log.error('migration failed', { err: e?.message ?? String(e) });
  process.exit(1);
});
