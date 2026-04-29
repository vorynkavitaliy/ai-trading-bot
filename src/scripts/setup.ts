import { query, close as closePg } from '../lib/db';
import { getRedis, close as closeRedis } from '../lib/redis';
import { runMigrations } from '../lib/db';
import { loadAccounts, summary as accountsSummary } from '../lib/accounts';
import { log } from '../lib/logger';

async function checkPg(): Promise<void> {
  const r = await query<{ now: string }>(`SELECT NOW()::text AS now`);
  log.info('postgres OK', { server_time: r.rows[0].now });
}

async function checkRedis(): Promise<void> {
  const r = getRedis();
  const pong = await r.ping();
  log.info('redis OK', { pong });
}

async function main() {
  log.info('=== infrastructure self-check ===');

  log.info('--- postgres ---');
  await checkPg();
  await runMigrations();

  log.info('--- redis ---');
  await checkRedis();

  log.info('--- accounts ---');
  console.log(accountsSummary());
  loadAccounts(); // validate format

  log.info('=== self-check OK ===');
  await closePg();
  await closeRedis();
}

main().catch(async (e) => {
  log.error('setup failed', { err: e?.message ?? String(e) });
  try {
    await closePg();
    await closeRedis();
  } catch {}
  process.exit(1);
});
