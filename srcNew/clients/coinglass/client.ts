import { CoinglassConfig } from '../../config/clients';
import { ApiError, RateLimitError, TimeoutError } from '../../core/errors';
import { HttpClient, QueryValue } from '../../core/http';
import { Logger } from '../../core/logger';
import { RateLimiter } from '../../core/rate-limiter';
import { ExponentialBackoff, RetryPolicy } from '../../core/retry';
import { FundingEndpoints } from './endpoints/funding';
import { LiquidationEndpoints } from './endpoints/liquidation';
import { MarketEndpoints } from './endpoints/market';
import { OpenInterestEndpoints } from './endpoints/open-interest';
import { OrderbookEndpoints } from './endpoints/orderbook';
import { PositioningEndpoints } from './endpoints/positioning';
import { CgTransport } from './transport';
import { CgEnvelope } from './types';

const SUCCESS_CODES = new Set<string | number>(['0', 0, '00000']);

export interface CoinglassClientOptions {
  logger?: Logger;
}

function coinglassRetryPolicy(): RetryPolicy {
  return new ExponentialBackoff({
    label: 'coinglass',
    maxAttempts: 4,
    baseDelayMs: 1_500,
    isRetryable: error => {
      if (error instanceof RateLimitError) return true;
      if (error instanceof TimeoutError) return true;
      const code = (error as { code?: string })?.code;
      if (code === 'ECONNRESET' || code === 'ETIMEDOUT') return true;
      const message = (error as Error)?.message ?? '';
      return /rate|limit|429|busy/i.test(message);
    },
  });
}

export class CoinglassClient implements CgTransport {
  readonly market: MarketEndpoints;
  readonly openInterest: OpenInterestEndpoints;
  readonly funding: FundingEndpoints;
  readonly positioning: PositioningEndpoints;
  readonly liquidation: LiquidationEndpoints;
  readonly orderbook: OrderbookEndpoints;

  private readonly http: HttpClient;

  constructor(config: CoinglassConfig, options: CoinglassClientOptions = {}) {
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      defaultHeaders: { 'CG-API-KEY': config.apiKey },
      timeoutMs: config.timeoutMs,
      retryPolicy: coinglassRetryPolicy(),
      rateLimiter: RateLimiter.perMinute(config.requestsPerMinute),
      logger: options.logger,
    });

    this.market = new MarketEndpoints(this);
    this.openInterest = new OpenInterestEndpoints(this);
    this.funding = new FundingEndpoints(this);
    this.positioning = new PositioningEndpoints(this);
    this.liquidation = new LiquidationEndpoints(this);
    this.orderbook = new OrderbookEndpoints(this);
  }

  async request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
    const envelope = await this.http.getJson<CgEnvelope<T>>(path, { params });

    if (!SUCCESS_CODES.has(envelope.code)) {
      throw new ApiError('coinglass', path, envelope.code, envelope.msg ?? 'unknown error');
    }

    return envelope.data;
  }
}
