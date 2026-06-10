import { CoinglassClient } from '../clients/coinglass';
import { coinglassConfigFromEnv } from '../config/clients';
import { createLogger } from '../core/logger';

async function main(): Promise<void> {
  const logger = createLogger('cg-smoke');
  const client = new CoinglassClient(coinglassConfigFromEnv(), { logger });

  const coins = await client.market.getSupportedCoins();
  logger.info('supported coins', { count: coins.length, sample: coins.slice(0, 8) });

  const exchanges = await client.market.getSupportedExchanges();
  logger.info('supported exchanges', { count: exchanges.length });

  const oi = await client.openInterest.getAggregatedHistory({
    symbol: 'BTC',
    interval: '4h',
    limit: 5,
  });
  logger.info('BTC aggregated OI (last 5 x 4h)', { bars: oi.length, latest: oi.at(-1) });

  const funding = await client.funding.getOiWeightHistory({
    symbol: 'BTC',
    interval: '4h',
    limit: 5,
  });
  logger.info('BTC OI-weighted funding (last 5 x 4h)', {
    bars: funding.length,
    latest: funding.at(-1),
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
