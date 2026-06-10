/**
 * oi-margin-probe — confirm v4 paths for coin-margined vs stablecoin-margined
 * aggregated OI OHLC history are accessible on our Standard key, and report
 * history depth + response shape. Read-only, no DB.
 *
 * Run: npx tsx src/tools/diagnostics/oi-margin-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const EX = 'Binance,OKX,Bybit,Bitget,Gate,Huobi,Deribit,dYdX,Bitmex,CoinEx';

const candidates: { name: string; path: string; params: Record<string, string | number> }[] = [
  // coin-margin valid path (alt1) — now WITH exchange_list
  { name: 'coin-margin +exlist', path: '/futures/open-interest/aggregated-coin-margin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: EX, limit: 5 } },
  { name: 'coin-margin no-exlist-all', path: '/futures/open-interest/aggregated-coin-margin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: 'all', limit: 5 } },
  // stablecoin variants to find the right slug
  { name: 'stable v-a', path: '/futures/open-interest/aggregated-stablecoin-margin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: EX, limit: 5 } },
  { name: 'stable v-b', path: '/futures/open-interest/aggregated-stable-coin-margin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: EX, limit: 5 } },
  { name: 'stable v-c', path: '/futures/open-interest/aggregated-usdt-margin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: EX, limit: 5 } },
  { name: 'stable v-d', path: '/futures/open-interest/aggregated-usd-margin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: EX, limit: 5 } },
  { name: 'stable v-e', path: '/futures/open-interest/aggregated-stablecoin-history', params: { symbol: 'BTC', interval: '4h', exchange_list: EX, limit: 5 } },
];

async function depth(path: string, params: Record<string, string | number>) {
  const r = await cgGet<any>(path, { ...params, limit: 100000 });
  const d = r.data;
  if (Array.isArray(d)) {
    const first = d[0], last = d[d.length - 1];
    return { n: d.length, keys: first ? Object.keys(first) : [], first, last };
  }
  return { n: 0, keys: d && typeof d === 'object' ? Object.keys(d) : [], first: null, last: null };
}

const okPaths: { name: string; path: string }[] = [];

async function main() {
  for (const c of candidates) {
    try {
      const r = await cgGet<any>(c.path, c.params);
      const d = r.data;
      const arr = Array.isArray(d) ? d : (d?.data_list ?? d?.list ?? null);
      const sample = Array.isArray(arr) ? arr.slice(0, 2) : d;
      console.log(`\n=== 200-OK  ${c.name}  ${c.path}`);
      console.log(`    code=${r.code}  shape=${Array.isArray(d) ? 'array' : typeof d}`);
      console.log(`    sample=${JSON.stringify(sample).slice(0, 500)}`);
      okPaths.push({ name: c.name, path: c.path });
    } catch (e: any) {
      console.log(`\n=== ERR    ${c.name}  ${c.path}`);
      console.log(`    ${(e?.message ?? String(e)).slice(0, 160)}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n\n=== DEPTH PROBE (full 4h history for OK paths) ===');
  for (const c of okPaths) {
    try {
      const info = await depth(c.path, { symbol: 'BTC', interval: '4h', exchange_list: EX });
      const f = info.first, l = info.last;
      const tsKey = info.keys.find(k => k === 'time' || k === 't' || k.toLowerCase().includes('time')) ?? info.keys[0];
      const toIso = (row: any) => { if (!row) return 'n/a'; let ts = Number(row[tsKey]); const ms = ts < 1e12 ? ts * 1000 : ts; return new Date(ms).toISOString().slice(0, 16); };
      console.log(`${c.name} [${c.path}]: n=${info.n}  keys=${JSON.stringify(info.keys)}`);
      console.log(`   first=${toIso(f)}  last=${toIso(l)}  firstRow=${JSON.stringify(f)}`);
    } catch (e: any) {
      console.log(`${c.name}: depth ERR ${(e?.message ?? String(e)).slice(0, 160)}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
}

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
