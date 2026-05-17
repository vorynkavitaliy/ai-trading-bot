import { runMigrations, close } from '../../core/db';
import { log } from '../../core/logger';

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
