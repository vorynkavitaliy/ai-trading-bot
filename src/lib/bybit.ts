import { RestClientV5 } from 'bybit-api';
import { AccountKey } from './accounts';
import { log } from './logger';

const clientCache = new Map<string, RestClientV5>();

export function getRest(account: AccountKey): RestClientV5 {
  const cacheKey = `${account.bucket}/${account.keyName}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const c = new RestClientV5({
    key: account.apiKey,
    secret: account.apiSecret,
    testnet: account.testnet,
    demoTrading: account.demoTrading,
    recv_window: 10_000,
  });
  clientCache.set(cacheKey, c);
  return c;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const tries = opts.tries ?? 3;
  const delayMs = opts.delayMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const retCode = e?.retCode ?? e?.code;
      // 10006 = rate limit, 10016 = system busy — retry
      // Other retCodes (e.g. 10001 invalid params) are not retryable
      const retryable =
        retCode === 10006 || retCode === 10016 || e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT';
      if (!retryable || i === tries - 1) break;
      log.warn('bybit call retry', {
        label: opts.label ?? 'unknown',
        attempt: i + 1,
        retCode,
        delayMs,
      });
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

export async function ping(account: AccountKey): Promise<{ ok: boolean; equity?: number; err?: string }> {
  try {
    const c = getRest(account);
    const res = await withRetry(() => c.getWalletBalance({ accountType: 'UNIFIED' }), {
      label: `wallet-${account.bucket}/${account.keyName}`,
    });
    if (res.retCode !== 0) {
      return { ok: false, err: `retCode=${res.retCode} ${res.retMsg}` };
    }
    const totalEq = parseFloat(res.result?.list?.[0]?.totalEquity ?? '0');
    return { ok: true, equity: totalEq };
  } catch (e: any) {
    return { ok: false, err: e?.message ?? String(e) };
  }
}
