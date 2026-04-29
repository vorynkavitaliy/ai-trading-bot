import { loadAccounts, summary } from '../lib/accounts';
import { ping } from '../lib/bybit';
import { log } from '../lib/logger';

async function main() {
  log.info('listing accounts');
  console.log(summary());
  const accs = loadAccounts();
  log.info('pinging Bybit for each key');
  const results = await Promise.all(
    accs.map(async (a) => ({ a, r: await ping(a) }))
  );
  for (const { a, r } of results) {
    if (r.ok) {
      log.info(`OK ${a.bucket}/${a.keyName}`, { equity: r.equity, label: a.label });
    } else {
      log.error(`FAIL ${a.bucket}/${a.keyName}`, { err: r.err, label: a.label });
    }
  }
  const failures = results.filter((x) => !x.r.ok);
  if (failures.length) {
    log.error(`${failures.length} key(s) failed ping`);
    process.exit(2);
  }
  log.info('all keys reachable');
}

main().catch((e) => {
  log.error('bybit-test failed', { err: e?.message ?? String(e) });
  process.exit(1);
});
