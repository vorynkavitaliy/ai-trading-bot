import { BybitPublicClient } from '../../clients/bybit/public';
import { CoinglassClient } from '../../clients/coinglass';
import { coinglassConfigFromEnv } from '../../config/clients';
import { createLogger } from '../../core/logger';
import {
  cgSeriesSpecs,
  downloadCgSeries,
  downloadKlines,
  persistCandles,
  persistSeries,
} from '../download';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

async function main(): Promise<void> {
  const logger = createLogger('download-pair');
  const coin = process.argv[2];
  const pair = process.argv[3];
  const days = Number(process.argv[4] ?? 360);
  const cgInterval = process.argv[5] ?? '4h';

  if (!coin || !pair) {
    console.error('usage: download-pair.ts <COIN> <PAIR> [days=360] [cgInterval=4h]');
    process.exit(1);
  }

  const cgIntervalMs = cgInterval === '4h' ? 4 * HOUR_MS : HOUR_MS;
  const now = Date.now();
  const fromTs = now - days * DAY_MS;

  logger.info('download start', { coin, pair, days, cgInterval });

  const bybit = new BybitPublicClient({ logger });
  const candles1m = await downloadKlines(bybit, pair, '1', fromTs, now, logger);
  persistCandles(`bybit_${pair}_1m`, candles1m, logger);

  const cg = new CoinglassClient(coinglassConfigFromEnv(), { logger });
  const cgFrom = now - Math.min(days, 360) * DAY_MS;
  for (const spec of cgSeriesSpecs(coin, pair, 'Binance', cgInterval)) {
    const points = await downloadCgSeries(cg, spec, cgFrom, now, cgIntervalMs, logger);
    persistSeries(spec.name, points, logger);
  }

  logger.info('download done', { coin, pair, klines: candles1m.length });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
