import { closeAllAcrossAccounts } from '../../runtime/close-runner';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';

async function main() {
  const result = await closeAllAcrossAccounts({
    cancelPending: true,
    outerRetries: 3,
    reason: 'admin close-all',
    onProgress: (line) => { console.log(line); },
  });

  console.log(`\n=== close-all verified-closed: ${result.totalOk}/${result.totalAttempts}, stuck: ${result.totalStuck}, retries: ${result.retriesUsed} ===`);

  if (!result.allClosed) {
    log.error('close-all: stuck after retries', { totalStuck: result.totalStuck });
    await closePg();
    process.exit(2);
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('close-all crashed', { err: e?.message ?? String(e) });
  try { await closePg(); } catch {}
  process.exit(1);
});
