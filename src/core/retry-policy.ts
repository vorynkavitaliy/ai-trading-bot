import { log } from './logger';

export interface RetryPolicy {
  readonly label: string;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  isRetryable(err: unknown): boolean;
  delayMs(attempt: number): number;
}

export class BybitRetryPolicy implements RetryPolicy {
  readonly label = 'bybit';
  readonly maxAttempts: number;
  readonly baseDelayMs: number;

  constructor(opts: { maxAttempts?: number; baseDelayMs?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
  }

  isRetryable(err: unknown): boolean {
    const e = err as any;
    const retCode = e?.retCode ?? e?.code;
    return retCode === 10006 || retCode === 10016
        || e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT';
  }

  delayMs(attempt: number): number {
    return this.baseDelayMs * (attempt + 1);
  }
}

export class CoinglassRetryPolicy implements RetryPolicy {
  readonly label = 'coinglass';
  readonly maxAttempts: number;
  readonly baseDelayMs: number;

  constructor(opts: { maxAttempts?: number; baseDelayMs?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1500;
  }

  isRetryable(err: unknown): boolean {
    const msg = (err as any)?.message ?? String(err);
    return /rate|limit|429|busy/i.test(msg);
  }

  delayMs(attempt: number): number {
    return this.baseDelayMs * (attempt + 1);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  opts: { callLabel?: string } = {},
): Promise<T> {
  let lastErr: unknown;

  for (let i = 0; i < policy.maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!policy.isRetryable(err) || i === policy.maxAttempts - 1) break;

      log.warn(`${policy.label} call retry`, {
        label: opts.callLabel ?? 'unknown',
        attempt: i + 1,
        delayMs: policy.delayMs(i),
      });

      await new Promise((r) => setTimeout(r, policy.delayMs(i)));
    }
  }

  throw lastErr;
}
