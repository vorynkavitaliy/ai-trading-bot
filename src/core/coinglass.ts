import { withRetry as withRetryGeneric, CoinglassRetryPolicy } from './retry-policy';

const BASE = 'https://open-api-v4.coinglass.com/api';

function getApiKey(): string {
  const k = process.env.COINGLASS_API_KEY;
  if (!k) {
    console.error('[coinglass] COINGLASS_API_KEY missing in .env');
    process.exit(1);
  }
  return k;
}

export interface CgResponse<T> {
  code: string;
  msg?: string;
  data: T;
}

export async function cgGet<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<CgResponse<T>> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const key = getApiKey();
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'CG-API-KEY': key,
      'Accept': 'application/json',
    },
  });
  const txt = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(txt);
  } catch {
    throw new Error(`coinglass ${path} non-JSON response (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }
  if (parsed.code !== '0' && parsed.code !== 0 && parsed.code !== '00000') {
    throw new Error(`coinglass ${path} error code=${parsed.code} msg=${parsed.msg ?? ''}`);
  }
  return parsed as CgResponse<T>;
}

const cgPolicy = new CoinglassRetryPolicy();

export async function withCgRetry<T>(fn: () => Promise<T>, label: string, tries = 3, delayMs = 1500): Promise<T> {
  const policy = (tries !== 3 || delayMs !== 1500)
    ? new CoinglassRetryPolicy({ maxAttempts: tries, baseDelayMs: delayMs })
    : cgPolicy;
  return withRetryGeneric(fn, policy, { callLabel: label });
}
