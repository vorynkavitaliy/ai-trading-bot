import { log } from './logger';

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

export async function withCgRetry<T>(fn: () => Promise<T>, label: string, tries = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message ?? String(e);
      // Rate limit hint from Coinglass
      const isRate = /rate|limit|429|busy/i.test(msg);
      if (!isRate || i === tries - 1) break;
      log.warn('coinglass retry', { label, attempt: i + 1, msg });
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}
