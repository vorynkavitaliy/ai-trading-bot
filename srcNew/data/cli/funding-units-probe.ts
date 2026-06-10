import { CoinglassClient } from '../../clients/coinglass';
import { coinglassConfigFromEnv } from '../../config/clients';
import { HttpClient } from '../../core/http';
import { createLogger } from '../../core/logger';

async function main(): Promise<void> {
  const logger = createLogger('funding-probe');

  const cg = new CoinglassClient(coinglassConfigFromEnv(), { logger });
  const cgRows = await cg.request<Record<string, unknown>[]>('/futures/funding-rate/history', {
    exchange: 'Bybit',
    symbol: 'BTCUSDT',
    interval: '8h',
    limit: 5,
  });
  console.log('CG funding-rate/history (Bybit BTCUSDT, 8h):');
  for (const row of cgRows) {
    console.log(`  ts=${new Date(Number(row.time)).toISOString()} close=${row.close}`);
  }

  const bybit = new HttpClient({ baseUrl: 'https://api.bybit.com' });
  const resp = await bybit.getJson<{
    retCode: number;
    result: { list: Array<{ fundingRate: string; fundingRateTimestamp: string }> };
  }>('/v5/market/funding/history', {
    params: { category: 'linear', symbol: 'BTCUSDT', limit: 5 },
  });
  console.log('Bybit native funding history (fraction per 8h):');
  for (const row of resp.result.list) {
    console.log(`  ts=${new Date(Number(row.fundingRateTimestamp)).toISOString()} rate=${row.fundingRate}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
