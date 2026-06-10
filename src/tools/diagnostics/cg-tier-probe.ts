/**
 * cg-tier-probe — read-only probe of high-value Coinglass v4 endpoint families we do
 * NOT currently ingest, to learn what our Standard-plan key can actually fetch (and
 * thus backfill) vs what is tier-locked or needs path verification.
 *
 * Reuses the shared cgGet client (src/core/coinglass.ts) — no re-implemented auth.
 * Hits each candidate endpoint ONCE with BTC params, classifies the outcome, and on
 * success prints row count + first-row keys (the schema we'd model a table on).
 *
 * Pure HTTP — no pg pool opened/closed. Each call is wrapped in try/catch + a short
 * per-call timeout so one failure (or hang) does not abort the rest.
 *
 * Run: npx tsx src/tools/diagnostics/cg-tier-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 12_000; // short, generous enough for a single CG call
const PACE_MS = 300;                // Standard plan 300 req/min — pace well under cap

// family = the data family this endpoint belongs to (for the verdict bucket).
interface Probe {
  name: string;
  family: string;
  path: string;
  params: Record<string, string | number>;
  // optional alternate path to try if the primary returns a path-not-found style error
  altPath?: string;
}

const probes: Probe[] = [
  { name: 'etf-flow-history',        family: 'ETF flows',         path: '/etf/bitcoin/flow-history', altPath: '/bitcoin/etf/flow-history', params: {} },
  { name: 'coinbase-premium',        family: 'Coinbase premium',  path: '/coinbase-premium-index', params: { interval: '4h', limit: 5 } },
  { name: 'liq-heatmap-model1',      family: 'Liq heatmap',       path: '/futures/liquidation/heatmap/model1', params: { exchange: 'Binance', pair: 'BTCUSDT', range: '24h' } },
  { name: 'liq-agg-heatmap-model1',  family: 'Liq heatmap',       path: '/futures/liquidation/aggregated-heatmap/model1', params: { symbol: 'BTC', range: '24h' } },
  { name: 'liq-map',                 family: 'Liq map',           path: '/futures/liquidation/map', params: { exchange: 'Binance', pair: 'BTCUSDT' } },
  // NOTE: these v4 *aggregated* endpoints require an `exchange_list` param (CSV of exchanges),
  // not just symbol/interval. Without it CG returns code=400 (path valid, key accepted).
  { name: 'liq-aggregated-history',  family: 'Aggregated liq',    path: '/futures/liquidation/aggregated-history', params: { symbol: 'BTC', exchange_list: 'Binance', interval: '4h', limit: 5 } },
  { name: 'taker-aggregated',        family: 'Aggregated taker',  path: '/futures/aggregated-taker-buy-sell-volume/history', params: { symbol: 'BTC', exchange_list: 'Binance', interval: '4h', limit: 5 } },
  { name: 'hyperliquid-whale-pos',   family: 'Hyperliquid whale', path: '/hyperliquid/whale-position', params: {} },
  { name: 'hyperliquid-whale-alert', family: 'Hyperliquid whale', path: '/hyperliquid/whale-alert', params: {} },
  // max-pain requires an `exchange` param (e.g. Deribit) in addition to symbol.
  { name: 'option-max-pain',         family: 'Options',           path: '/option/max-pain', params: { symbol: 'BTC', exchange: 'Deribit' } },
  { name: 'option-info',             family: 'Options',           path: '/option/info', params: { symbol: 'BTC' } },
  { name: 'exchange-balance-list',   family: 'Exchange balance',  path: '/exchange/balance/list', params: { symbol: 'BTC' } },
  { name: 'exchange-chain-tx-list',  family: 'Exchange balance',  path: '/exchange/chain/tx/list', params: { symbol: 'BTC' } },
  { name: 'spot-cvd-history',        family: 'Spot CVD',          path: '/spot/aggregated-taker-buy-sell-volume/history', altPath: '/spot/taker-buy-sell-volume/history', params: { exchange_list: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5 } },
  // bitfinex margin uses a Bitfinex symbol (e.g. BTCUSD) + interval.
  { name: 'bitfinex-margin-ls',      family: 'Bitfinex margin',   path: '/bitfinex-margin-long-short', params: { symbol: 'BTCUSD', interval: '4h', limit: 5 } },
  // OI-by-exchange history chart wants `range` from {all,1m,15m,1h,4h,12h} (interval-like, per CG 400 hint).
  { name: 'oi-exchange-history',     family: 'OI by exchange',    path: '/futures/open-interest/exchange-history-chart', params: { symbol: 'BTC', range: '4h' } },
  { name: 'fear-greed-history',      family: 'Fear & greed',      path: '/index/fear-greed-history', params: {} },
  { name: 'bitcoin-dominance',       family: 'Dominance',         path: '/index/bitcoin-dominance', params: {} },
];

type Classification = '200-ok' | 'tier-locked' | '404-path' | 'other-error';

interface Result {
  name: string;
  family: string;
  path: string;
  outcome: Classification;
  rows: number | null;
  firstRowKeys: string[] | null;
  detail: string; // raw code/msg or note
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms),
    ),
  ]);
}

// Pull a row count + first-row key list from the variety of shapes CG returns.
function shapeOf(data: any): { rows: number | null; keys: string[] | null } {
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : null;
    return { rows: data.length, keys };
  }
  if (data && typeof data === 'object') {
    // Common nested shapes: { list: [...] } or { data: [...] } or column arrays.
    if (Array.isArray((data as any).list)) {
      const first = (data as any).list[0];
      const keys = first && typeof first === 'object' ? Object.keys(first)
        : Object.keys(data); // fall back to top-level keys
      return { rows: (data as any).list.length, keys };
    }
    return { rows: 1, keys: Object.keys(data) };
  }
  return { rows: data == null ? 0 : 1, keys: null };
}

// Map a thrown cgGet error into a classification. cgGet throws either:
//  - "coinglass <path> error code=<code> msg=<msg>"  (HTTP 200 but CG error code)
//  - "coinglass <path> non-JSON response (HTTP <status>): <body>"  (transport/path)
//  - our own "timeout ..." sentinel
function classifyError(msg: string): { outcome: Classification; detail: string } {
  const m = msg.toLowerCase();
  // CG application error code path
  const codeMatch = msg.match(/code=([^\s]+)\s+msg=(.*)$/);
  if (codeMatch) {
    const code = codeMatch[1];
    const cgMsg = codeMatch[2].trim();
    const lm = cgMsg.toLowerCase();
    // Path-not-found style → needs path verification, NOT a permission conclusion.
    if (lm.includes('not found') || lm.includes('no such') || lm.includes('invalid path') ||
        lm.includes('does not exist') || lm.includes('url') || code === '404') {
      return { outcome: '404-path', detail: `code=${code} msg=${cgMsg}` };
    }
    // Permission / plan / upgrade style → tier-locked.
    if (lm.includes('upgrade') || lm.includes('permission') || lm.includes('plan') ||
        lm.includes('not authorized') || lm.includes('unauthorized') || lm.includes('forbidden') ||
        lm.includes('access') || lm.includes('subscribe') || code === '403' || code === '40001' ||
        lm.includes('api key')) {
      return { outcome: 'tier-locked', detail: `code=${code} msg=${cgMsg}` };
    }
    return { outcome: 'other-error', detail: `code=${code} msg=${cgMsg}` };
  }
  // Transport/HTTP layer (non-JSON). Try to read the HTTP status.
  const httpMatch = msg.match(/HTTP\s+(\d{3})/i);
  if (httpMatch) {
    const status = httpMatch[1];
    if (status === '404') return { outcome: '404-path', detail: `HTTP ${status} ${msg.slice(0, 120)}` };
    if (status === '403' || status === '401') return { outcome: 'tier-locked', detail: `HTTP ${status} ${msg.slice(0, 120)}` };
    return { outcome: 'other-error', detail: `HTTP ${status} ${msg.slice(0, 120)}` };
  }
  if (m.includes('timeout')) return { outcome: 'other-error', detail: msg };
  return { outcome: 'other-error', detail: msg.slice(0, 160) };
}

async function runOne(p: Probe, path: string): Promise<Result> {
  const r = await withTimeout(cgGet<any>(path, p.params), PER_CALL_TIMEOUT_MS, p.name);
  const { rows, keys } = shapeOf((r as any).data);
  return {
    name: p.name, family: p.family, path,
    outcome: '200-ok', rows, firstRowKeys: keys,
    detail: `code=${(r as any).code}`,
  };
}

async function probeOne(p: Probe): Promise<Result> {
  try {
    return await runOne(p, p.path);
  } catch (e: any) {
    const primary = classifyError(e?.message ?? String(e));
    // If the primary path looks like a wrong path AND we have an alternate, try it.
    if (primary.outcome === '404-path' && p.altPath) {
      try {
        const alt = await runOne({ ...p, path: p.altPath }, p.altPath);
        return { ...alt, detail: `${alt.detail} (via altPath ${p.altPath})` };
      } catch (e2: any) {
        const altC = classifyError(e2?.message ?? String(e2));
        return {
          name: p.name, family: p.family, path: `${p.path} | ${p.altPath}`,
          outcome: altC.outcome, rows: null, firstRowKeys: null,
          detail: `primary: ${primary.detail} || alt: ${altC.detail}`,
        };
      }
    }
    return {
      name: p.name, family: p.family, path: p.path,
      outcome: primary.outcome, rows: null, firstRowKeys: null,
      detail: primary.detail,
    };
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  const startedAt = Date.now();
  console.log('\n=== Coinglass tier probe (Standard-plan key) ===');
  console.log(`base: https://open-api-v4.coinglass.com/api   key-env: COINGLASS_API_KEY`);
  console.log(`probes: ${probes.length}   per-call timeout: ${PER_CALL_TIMEOUT_MS}ms\n`);

  const results: Result[] = [];
  for (const p of probes) {
    const res = await probeOne(p);
    results.push(res);
    const tag =
      res.outcome === '200-ok' ? `OK   ${res.rows} rows` :
      res.outcome === 'tier-locked' ? 'LOCK tier-locked' :
      res.outcome === '404-path' ? 'PATH 404/path-needs-verification' :
      'ERR  other-error';
    console.log(`${pad(tag, 38)} ${pad(res.name, 24)} ${res.path}`);
    if (res.outcome === '200-ok' && res.firstRowKeys) {
      console.log(`     keys: ${JSON.stringify(res.firstRowKeys).slice(0, 400)}`);
    } else {
      console.log(`     ${res.detail.slice(0, 280)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }

  // ---- Summary table ----
  console.log('\n=== SUMMARY TABLE ===');
  console.log(`${pad('endpoint', 26)} ${pad('family', 20)} ${pad('outcome', 34)} first-row keys (if ok)`);
  console.log('-'.repeat(140));
  for (const r of results) {
    const outcome =
      r.outcome === '200-ok' ? `200-ok ${r.rows} rows` :
      r.outcome === 'tier-locked' ? 'tier-locked' :
      r.outcome === '404-path' ? '404-path (verify path)' :
      `other-error`;
    const keys = r.outcome === '200-ok' && r.firstRowKeys ? r.firstRowKeys.join(',') : '';
    console.log(`${pad(r.name, 26)} ${pad(r.family, 20)} ${pad(outcome, 34)} ${keys.slice(0, 90)}`);
  }

  // ---- Verdict buckets ----
  const accessible = results.filter(r => r.outcome === '200-ok').map(r => `${r.family} (${r.name})`);
  const locked = results.filter(r => r.outcome === 'tier-locked').map(r => `${r.family} (${r.name})`);
  const pathV = results.filter(r => r.outcome === '404-path').map(r => `${r.family} (${r.name})`);
  const other = results.filter(r => r.outcome === 'other-error').map(r => `${r.family} (${r.name}: ${r.detail.slice(0, 60)})`);

  console.log('\n=== VERDICT ===');
  console.log(`ACCESSIBLE (backfillable now): ${accessible.length ? accessible.join('; ') : 'none'}`);
  console.log(`TIER-LOCKED: ${locked.length ? locked.join('; ') : 'none'}`);
  console.log(`NEEDS-PATH-VERIFICATION (404): ${pathV.length ? pathV.join('; ') : 'none'}`);
  console.log(`OTHER-ERROR: ${other.length ? other.join('; ') : 'none'}`);
  console.log(`\nelapsed ${Date.now() - startedAt}ms\n`);
}

main().catch(e => {
  console.error('cg-tier-probe crashed', e?.message ?? String(e));
  process.exit(1);
});
