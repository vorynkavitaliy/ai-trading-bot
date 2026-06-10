import { CoinglassClient } from '../clients/coinglass';
import { createLogger } from '../core/logger';
import { coinglassConfigFromEnv } from '../config/clients';

async function main(): Promise<void> {
  const logger = createLogger('cg-smoke');
  const client = new CoinglassClient(coinglassConfigFromEnv(), { logger });

  const coins = await client.request<string[]>('/futures/supported-coins');
  logger.info('supported coins fetched', { count: coins.length, sample: coins.slice(0, 8) });

  const exchanges = await client.request<string[]>('/futures/supported-exchanges');
  logger.info('supported exchanges fetched', { count: exchanges.length });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
