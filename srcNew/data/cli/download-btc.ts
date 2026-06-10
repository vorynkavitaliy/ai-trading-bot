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
  const logger = createLogger('download-btc');
  const days = Number(process.argv[2] ?? 400);
  const cgInterval = process.argv[3] ?? '1h';
  const skipKlines = process.argv[4] === 'skip-klines';
  const cgIntervalMs = cgInterval === '4h' ? 4 * HOUR_MS : HOUR_MS;
  const now = Date.now();
  const fromTs = now - days * DAY_MS;

  logger.info('download start', { days, cgInterval, skipKlines, fromIso: new Date(fromTs).toISOString() });

  if (!skipKlines) {
    const bybit = new BybitPublicClient({ logger });
    const candles1m = await downloadKlines(bybit, 'BTCUSDT', '1', fromTs, now, logger);
    persistCandles('bybit_BTCUSDT_1m', candles1m, logger);
  }

  const cg = new CoinglassClient(coinglassConfigFromEnv(), { logger });
  const cgFrom = now - Math.min(days, 360) * DAY_MS;
  for (const spec of cgSeriesSpecs('BTC', 'BTCUSDT', 'Binance', cgInterval)) {
    const points = await downloadCgSeries(cg, spec, cgFrom, now, cgIntervalMs, logger);
    persistSeries(spec.name, points, logger);
  }

  logger.info('download done');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
