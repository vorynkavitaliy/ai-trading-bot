import { HttpError, RateLimitError, TimeoutError } from './errors';
import { Logger } from './logger';
import { RateLimiter } from './rate-limiter';
import { RetryPolicy, withRetry } from './retry';

export type QueryValue = string | number | boolean | undefined | null;

export interface HttpClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  rateLimiter?: RateLimiter;
  logger?: Logger;
}

export interface RequestOptions {
  params?: Record<string, QueryValue>;
  headers?: Record<string, string>;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly retryPolicy?: RetryPolicy;
  private readonly rateLimiter?: RateLimiter;
  private readonly logger?: Logger;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retryPolicy = options.retryPolicy;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
  }

  async getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.params);
    const headers = { ...this.defaultHeaders, ...(options.headers ?? {}) };

    const execute = () => this.fetchJson<T>(url, headers);

    if (!this.retryPolicy) return execute();
    return withRetry(execute, this.retryPolicy, { callLabel: path, logger: this.logger });
  }

  private buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl + normalized);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    if (this.rateLimiter) await this.rateLimiter.acquire();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        throw new TimeoutError(url, this.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      throw new RateLimitError(url, text.slice(0, 300), parseRetryAfter(response));
    }

    if (!response.ok) {
      throw new HttpError(response.status, url, text.slice(0, 300));
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(response.status, url, text.slice(0, 300), `non-JSON response from ${url}`);
    }
  }
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}
