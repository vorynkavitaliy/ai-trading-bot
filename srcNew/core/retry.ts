import { RateLimitError } from './errors';
import { Logger } from './logger';

export interface RetryPolicy {
  readonly label: string;
  readonly maxAttempts: number;
  isRetryable(error: unknown): boolean;
  delayMs(attempt: number): number;
}

export interface ExponentialBackoffOptions {
  label: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  isRetryable: (error: unknown) => boolean;
}

export class ExponentialBackoff implements RetryPolicy {
  readonly label: string;
  readonly maxAttempts: number;

  private readonly baseDelayMs: number;
  private readonly factor: number;
  private readonly maxDelayMs: number;
  private readonly retryable: (error: unknown) => boolean;

  constructor(options: ExponentialBackoffOptions) {
    this.label = options.label;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.factor = options.factor ?? 2;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.retryable = options.isRetryable;
  }

  isRetryable(error: unknown): boolean {
    return this.retryable(error);
  }

  delayMs(attempt: number): number {
    const raw = this.baseDelayMs * Math.pow(this.factor, attempt);
    return Math.min(raw, this.maxDelayMs);
  }
}

export interface WithRetryOptions {
  callLabel?: string;
  logger?: Logger;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDelayMs(policy: RetryPolicy, attempt: number, error: unknown): number {
  const base = policy.delayMs(attempt);
  if (error instanceof RateLimitError && error.retryAfterMs !== null) {
    return Math.max(base, error.retryAfterMs);
  }
  return base;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  options: WithRetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === policy.maxAttempts - 1;
      if (!policy.isRetryable(error) || isLastAttempt) break;

      const delay = resolveDelayMs(policy, attempt, error);
      options.logger?.warn(`${policy.label} retry`, {
        call: options.callLabel ?? 'unknown',
        attempt: attempt + 1,
        delayMs: delay,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}
