import { compactClosedWeek } from '../vault/weekly-compact';
import { log } from '../lib/logger';

async function main() {
  const r = await compactClosedWeek();
  if (r) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(JSON.stringify({ skipped: true, reason: 'no closed-week dailies' }, null, 2));
  }
}

main().catch(e => {
  log.error('vault-compact failed', { err: e?.message ?? String(e) });
  process.exit(1);
});
