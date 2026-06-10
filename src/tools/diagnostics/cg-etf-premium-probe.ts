/**
 * cg-etf-premium-probe — read-only probe of ETF premium/discount + AUM + netassets +
 * Grayscale premium endpoint families to verify real v4 paths, tier access, and
 * history depth. Also prints candle/funding_oi depth for the orthogonality plan.
 *
 * Pure HTTP + 2 read-only DB count queries. No live-path mutation.
 * Run: npx tsx src/tools/diagnostics/cg-etf-premium-probe.ts
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe {
  name: string;
  path: string;
  params: Record<string, string | number>;
}

// Candidate v4 paths. Doc-slug hints given; we try the obvious variants too.
const probes: Probe[] = [
  // ---- ETF premium / discount ----
  { name: 'etf-prem-disc-hint',    path: '/etf/bitcoin/premium-discount-history', params: {} },
  { name: 'etf-prem-disc-v4a',     path: '/etf/bitcoin/premium-discount/history', params: {} },
  { name: 'etf-prem-disc-v4b',     path: '/etf/bitcoin/list', params: {} },
  // ---- ETF AUM ----
  { name: 'etf-aum-hint',          path: '/etf/aum', params: {} },
  { name: 'etf-aum-btc',           path: '/etf/bitcoin/aum-history', params: {} },
  { name: 'etf-aum-history',       path: '/etf/bitcoin/aum', params: {} },
  // ---- ETF net assets ----
  { name: 'etf-netassets-hint',    path: '/etf/bitcoin/netassets-history', params: {} },
  { name: 'etf-netassets-v4a',     path: '/etf/bitcoin/net-assets-history', params: {} },
  // ---- ETF assets/history (combined) ----
  { name: 'etf-history',           path: '/etf/bitcoin/history', params: {} },
  { name: 'etf-net-assets-hist2',  path: '/etf/bitcoin/assets-history', params: {} },
  // ---- Grayscale premium ----
  { name: 'grayscale-prem-hint',   path: '/grayscale-premium-history', params: {} },
  { name: 'grayscale-prem-v4a',    path: '/etf/grayscale/premium-history', params: {} },
  { name: 'grayscale-prem-v4b',    path: '/grayscale/premium-history', params: {} },
  // ---- ETF flow (already-done family, but used here just to confirm shape parity) ----
  { name: 'etf-flow-history-ref',  path: '/etf/bitcoin/flow-history', params: {} },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms)),
  ]);
}

function shapeOf(data: any): { rows: number | null; keys: string[] | null; sample: any } {
  if (Array.isArray(data)) {
    const first = data[0];
    return {
      rows: data.length,
      keys: first && typeof first === 'object' ? Object.keys(first) : null,
      sample: first ?? null,
    };
  }
  if (data && typeof data === 'object') {
    // column-array shapes: time_list/data_list/data_map
    if (Array.isArray((data as any).time_list) || Array.isArray((data as any).data_list)) {
      const tl = (data as any).time_list;
      const dl = (data as any).data_list;
      return {
        rows: Array.isArray(tl) ? tl.length : (Array.isArray(dl) ? dl.length : null),
        keys: Object.keys(data),
        sample: {
          first_time: Array.isArray(tl) ? tl[0] : undefined,
          last_time: Array.isArray(tl) ? tl[tl.length - 1] : undefined,
          first_data: Array.isArray(dl) ? dl[0] : undefined,
        },
      };
    }
    if (Array.isArray((data as any).list)) {
      const first = (data as any).list[0];
      return {
        rows: (data as any).list.length,
        keys: first && typeof first === 'object' ? Object.keys(first) : Object.keys(data),
        sample: first ?? null,
      };
    }
    return { rows: 1, keys: Object.keys(data), sample: data };
  }
  return { rows: data == null ? 0 : 1, keys: null, sample: data };
}

async function main() {
  console.log('\n=== ETF premium/discount + AUM + netassets + Grayscale probe ===\n');

  for (const p of probes) {
    try {
      const r: any = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      const { rows, keys, sample } = shapeOf(r.data);
      console.log(`OK    ${p.name.padEnd(22)} ${p.path}`);
      console.log(`      rows=${rows}  keys=${JSON.stringify(keys)?.slice(0, 300)}`);
      console.log(`      sample=${JSON.stringify(sample)?.slice(0, 500)}`);
    } catch (e: any) {
      console.log(`FAIL  ${p.name.padEnd(22)} ${p.path}`);
      console.log(`      ${(e?.message ?? String(e)).slice(0, 240)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }

  // ---- DB depth for orthogonality plan ----
  console.log('\n=== DB depth ===');
  try {
    const c = await query<any>(
      `SELECT tf, COUNT(*)::int AS n, MIN(ts)::text AS min_ts, MAX(ts)::text AS max_ts
       FROM candles WHERE symbol='BTCUSDT' GROUP BY tf ORDER BY tf`);
    for (const row of c.rows) {
      console.log(`candles BTCUSDT ${row.tf}: n=${row.n} min=${new Date(parseInt(row.min_ts)).toISOString()} max=${new Date(parseInt(row.max_ts)).toISOString()}`);
    }
  } catch (e: any) { console.log('candles query err', e?.message); }
  try {
    const f = await query<any>(
      `SELECT COUNT(*)::int AS n, MIN(ts)::text AS min_ts, MAX(ts)::text AS max_ts
       FROM cg_funding_oi_weighted WHERE symbol='BTC'`);
    const row = f.rows[0];
    console.log(`cg_funding_oi_weighted BTC: n=${row.n} min=${row.min_ts ? new Date(parseInt(row.min_ts)).toISOString() : 'NA'} max=${row.max_ts ? new Date(parseInt(row.max_ts)).toISOString() : 'NA'}`);
  } catch (e: any) { console.log('funding_oi query err', e?.message); }

  process.exit(0);
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
