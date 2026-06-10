import { loadAccounts, summarizeAccounts } from '../config/accounts';
import { BybitMultiClient } from '../clients/bybit';
import { createLogger } from '../core/logger';

async function main(): Promise<void> {
  const logger = createLogger('bybit-smoke');

  const accounts = loadAccounts();
  logger.info('loaded isolated accounts', { summary: summarizeAccounts(accounts) });

  const client = new BybitMultiClient(accounts, { logger });
  const pings = await client.pingAll();

  for (const result of pings.results) {
    logger.info('account ping', {
      account: result.accountId,
      ok: result.ok,
      equity: result.value?.equity,
      error: result.value?.error ?? result.error?.message,
    });
  }

  logger.info('ping summary', { ok: pings.okCount, fail: pings.failCount });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
