export interface RateLimiterOptions {
  minIntervalMs: number;
}

export class RateLimiter {
  private readonly minIntervalMs: number;
  private nextSlot = 0;

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = Math.max(0, options.minIntervalMs);
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextSlot);
    this.nextSlot = scheduledAt + this.minIntervalMs;

    const wait = scheduledAt - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  static perMinute(requestsPerMinute: number): RateLimiter {
    const safe = Math.max(1, requestsPerMinute);
    return new RateLimiter({ minIntervalMs: Math.ceil(60_000 / safe) });
  }
}
