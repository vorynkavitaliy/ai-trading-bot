import { RestClientV5 } from 'bybit-api';
import { AccountKey } from './accounts';
import { withRetry as withRetryGeneric, BybitRetryPolicy } from './retry-policy';

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

const bybitPolicy = new BybitRetryPolicy();

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const policy = (opts.tries !== undefined || opts.delayMs !== undefined)
    ? new BybitRetryPolicy({ maxAttempts: opts.tries, baseDelayMs: opts.delayMs })
    : bybitPolicy;
  return withRetryGeneric(fn, policy, { callLabel: opts.label });
}

// Per-symbol instrument metadata (qty step, tick size, min qty) — fetched once per symbol per process.
// Bybit's /v5/market/instruments-info is public, so we use any account's client.
export interface InstrumentInfo {
  qtyStep: number;            // 0.001 for BTC, 0.01 for ETH, 0.1 for SOL, etc.
  minOrderQty: number;
  maxOrderQty: number;        // limit-order ceiling (940 for BNB)
  maxMktOrderQty: number;     // market-order ceiling (370 for BNB) — usually MUCH lower
  tickSize: number;
  minNotionalValue: number;   // Bybit V5 lotSizeFilter.minNotionalValue (USDT); fallback 5 — never 0.
}

const instrumentCache = new Map<string, InstrumentInfo>();

function decimalsOf(stepStr: string): number {
  const s = stepStr.trim();
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  return s.length - dot - 1;
}

export async function getInstrumentInfo(account: AccountKey, symbol: string): Promise<InstrumentInfo> {
  const cached = instrumentCache.get(symbol);
  if (cached) return cached;
  const c = getRest(account);
  const r = await withRetry(() => c.getInstrumentsInfo({ category: 'linear', symbol }), {
    label: `instr-${symbol}`,
  });
  if (r.retCode !== 0) throw new Error(`getInstrumentsInfo retCode=${r.retCode} ${r.retMsg}`);
  const item = r.result?.list?.[0];
  if (!item) throw new Error(`no instrument info for ${symbol}`);
  const info: InstrumentInfo = {
    qtyStep: parseFloat(item.lotSizeFilter?.qtyStep ?? '0.001'),
    minOrderQty: parseFloat(item.lotSizeFilter?.minOrderQty ?? '0.001'),
    maxOrderQty: parseFloat(item.lotSizeFilter?.maxOrderQty ?? '1e9'),
    maxMktOrderQty: parseFloat(item.lotSizeFilter?.maxMktOrderQty ?? item.lotSizeFilter?.maxOrderQty ?? '1e9'),
    tickSize: parseFloat(item.priceFilter?.tickSize ?? '0.1'),
    minNotionalValue: parseFloat(item.lotSizeFilter?.minNotionalValue ?? '5'),
  };
  // Stash decimal counts on the object for formatting helpers
  (info as any)._qtyDecimals = decimalsOf(item.lotSizeFilter?.qtyStep ?? '0.001');
  (info as any)._priceDecimals = decimalsOf(item.priceFilter?.tickSize ?? '0.1');
  instrumentCache.set(symbol, info);
  return info;
}

export function roundQtyToStep(qty: number, info: InstrumentInfo): string {
  const rounded = Math.floor(qty / info.qtyStep) * info.qtyStep;
  const dec = (info as any)._qtyDecimals ?? 3;
  return rounded.toFixed(dec);
}

export function roundPriceToTick(price: number, info: InstrumentInfo): string {
  const rounded = Math.round(price / info.tickSize) * info.tickSize;
  const dec = (info as any)._priceDecimals ?? 1;
  return rounded.toFixed(dec);
}

// Live tickers — single batch call for all linear USDT pairs. Used by scan-decide
// to override ctx.price with current market price (otherwise strategy decides on
// the last 1H close, which can be 50+ minutes stale and lead to invalid SL/TP).
export async function getLiveTickers(account: AccountKey, symbols: string[]): Promise<Map<string, number>> {
  const c = getRest(account);
  const r = await withRetry(() => c.getTickers({ category: 'linear' }), {
    label: 'tickers-batch',
  });
  if (r.retCode !== 0) throw new Error(`getTickers retCode=${r.retCode} ${r.retMsg}`);
  const wanted = new Set(symbols);
  const out = new Map<string, number>();
  for (const t of r.result?.list ?? []) {
    if (wanted.has(t.symbol)) {
      out.set(t.symbol, parseFloat(t.lastPrice));
    }
  }
  return out;
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
