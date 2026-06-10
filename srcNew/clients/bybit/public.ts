import { ApiError } from '../../core/errors';
import { HttpClient } from '../../core/http';
import { Logger } from '../../core/logger';
import { RateLimiter } from '../../core/rate-limiter';
import { ExponentialBackoff } from '../../core/retry';
import { Candle } from '../../data/types';

export type KlineInterval = '1' | '3' | '5' | '15' | '30' | '60' | '120' | '240' | '360' | '720' | 'D' | 'W';

export interface GetKlinesParams {
  symbol: string;
  interval: KlineInterval;
  start?: number;
  end?: number;
  limit?: number;
}

interface BybitPublicEnvelope<R> {
  retCode: number;
  retMsg: string;
  result: R;
}

interface KlineResult {
  symbol: string;
  category: string;
  list: string[][];
}

export class BybitPublicClient {
  private readonly http: HttpClient;

  constructor(options: { logger?: Logger } = {}) {
    this.http = new HttpClient({
      baseUrl: 'https://api.bybit.com',
      timeoutMs: 15_000,
      rateLimiter: RateLimiter.perMinute(150),
      retryPolicy: new ExponentialBackoff({
        label: 'bybit-public',
        maxAttempts: 10,
        baseDelayMs: 20_000,
        maxDelayMs: 120_000,
        isRetryable: error => {
          const message = (error as Error)?.message ?? '';
          return /429|10006|rate|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
        },
      }),
      logger: options.logger,
    });
  }

  async getKlines(params: GetKlinesParams): Promise<Candle[]> {
    const envelope = await this.http.getJson<BybitPublicEnvelope<KlineResult>>('/v5/market/kline', {
      params: {
        category: 'linear',
        symbol: params.symbol,
        interval: params.interval,
        start: params.start,
        end: params.end,
        limit: params.limit ?? 1000,
      },
    });

    if (envelope.retCode !== 0) {
      throw new ApiError('bybit-public', '/v5/market/kline', envelope.retCode, envelope.retMsg);
    }

    return (envelope.result?.list ?? [])
      .map(row => ({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }))
      .sort((a, b) => a.ts - b.ts);
  }
}
