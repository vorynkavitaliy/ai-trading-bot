export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodySnippet: string;

  constructor(status: number, url: string, bodySnippet: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.bodySnippet = bodySnippet;
  }
}

export class RateLimitError extends HttpError {
  readonly retryAfterMs: number | null;

  constructor(url: string, bodySnippet: string, retryAfterMs: number | null) {
    super(429, url, bodySnippet, `HTTP 429 rate limited for ${url}`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class TimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class ApiError extends Error {
  readonly provider: string;
  readonly code: string | number;
  readonly endpoint: string;

  constructor(provider: string, endpoint: string, code: string | number, message: string) {
    super(`${provider} ${endpoint} returned code=${code}: ${message}`);
    this.name = 'ApiError';
    this.provider = provider;
    this.endpoint = endpoint;
    this.code = code;
  }
}
