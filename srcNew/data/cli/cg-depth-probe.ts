import { CoinglassClient } from '../../clients/coinglass';
import { coinglassConfigFromEnv } from '../../config/clients';
import { createLogger } from '../../core/logger';

const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  const logger = createLogger('cg-depth-probe');
  const cg = new CoinglassClient(coinglassConfigFromEnv(), { logger });
  const now = Date.now();

  for (const daysBack of [360, 540, 720, 1080]) {
    const start = now - daysBack * DAY_MS;
    try {
      const rows = await cg.request<Record<string, unknown>[]>('/futures/top-long-short-position-ratio/history', {
        exchange: 'Binance',
        symbol: 'BTCUSDT',
        interval: '4h',
        start_time: start,
        end_time: start + 30 * DAY_MS,
        limit: 10,
      });
      const first = rows?.[0]?.time;
      console.log(`lsTopPos ${daysBack}d back: rows=${rows?.length ?? 0} firstTs=${first ? new Date(Number(first)).toISOString() : '-'}`);
    } catch (error) {
      console.log(`lsTopPos ${daysBack}d back: ERROR ${(error as Error).message.slice(0, 120)}`);
    }
  }

  for (const daysBack of [540, 720]) {
    const start = now - daysBack * DAY_MS;
    try {
      const rows = await cg.request<Record<string, unknown>[]>('/futures/funding-rate/oi-weight-history', {
        symbol: 'BTC',
        interval: '4h',
        start_time: start,
        end_time: start + 30 * DAY_MS,
        limit: 10,
      });
      const first = rows?.[0]?.time;
      console.log(`funding ${daysBack}d back: rows=${rows?.length ?? 0} firstTs=${first ? new Date(Number(first)).toISOString() : '-'}`);
    } catch (error) {
      console.log(`funding ${daysBack}d back: ERROR ${(error as Error).message.slice(0, 120)}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
