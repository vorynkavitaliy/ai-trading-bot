/**
 * oi-mcap-probe — verify units & daily depth for the leverage-saturation family:
 *   total aggregated OI (USD)  /futures/open-interest/aggregated-history  (interval 1d)
 *   stablecoin marketcap       /index/stableCoin-marketCap-history        (daily, data_list per-coin)
 * Plus dump the stablecoin marketcap data_list shape (is data_list[i] {USDT:..} only, or all coins?).
 * Read-only, no DB. Run: npx tsx src/tools/diagnostics/oi-mcap-probe.ts
 */
import { cgGet } from '../../core/coinglass';

const EX = 'Binance,OKX,Bybit,Bitget,Gate,Huobi,Deribit,dYdX,Bitmex,CoinEx';

async function probe(label: string, path: string, params: Record<string, string | number>) {
  try {
    const r = await cgGet<any>(path, params);
    const d = r.data;
    if (Array.isArray(d)) {
      const f = d[0], l = d[d.length - 1];
      const iso = (row: any) => { const t = Number(row?.time ?? row?.t); const ms = t < 1e12 ? t * 1000 : t; return new Date(ms).toISOString().slice(0, 16); };
      console.log(`OK  ${label}  n=${d.length}  keys=${JSON.stringify(f ? Object.keys(f) : [])}`);
      console.log(`    first=${iso(f)} ${JSON.stringify(f)}`);
      console.log(`    last =${iso(l)} ${JSON.stringify(l)}`);
    } else if (d && typeof d === 'object') {
      const keys = Object.keys(d);
      console.log(`OK  ${label}  object keys=${JSON.stringify(keys)}`);
      for (const k of keys) {
        const v = (d as any)[k];
        if (Array.isArray(v)) console.log(`    ${k}[${v.length}] first=${JSON.stringify(v[0])} last=${JSON.stringify(v[v.length - 1])}`);
      }
    }
  } catch (e: any) {
    console.log(`ERR ${label}  ${(e?.message ?? String(e)).slice(0, 180)}`);
  }
}

async function main() {
  console.log('=== OI total (USD) — daily depth & units ===');
  await probe('agg-history 1d (no exlist)', '/futures/open-interest/aggregated-history', { symbol: 'BTC', interval: '1d', limit: 100000 });
  await new Promise(r => setTimeout(r, 400));
  await probe('agg-history 1d (+exlist)', '/futures/open-interest/aggregated-history', { symbol: 'BTC', interval: '1d', exchange_list: EX, limit: 100000 });
  await new Promise(r => setTimeout(r, 400));
  await probe('coin-margin 1d', '/futures/open-interest/aggregated-coin-margin-history', { symbol: 'BTC', interval: '1d', exchange_list: EX, limit: 100000 });
  await new Promise(r => setTimeout(r, 400));
  await probe('stablecoin-OI 1d (BTC units)', '/futures/open-interest/aggregated-stablecoin-history', { symbol: 'BTC', interval: '1d', exchange_list: EX, limit: 100000 });
  await new Promise(r => setTimeout(r, 400));

  console.log('\n=== Stablecoin marketcap data_list shape ===');
  const sc = await cgGet<any>('/index/stableCoin-marketCap-history', {});
  const dl = sc.data.data_list, tl = sc.data.time_list, pl = sc.data.price_list;
  console.log(`time_list n=${tl.length} first=${new Date(Number(tl[0])).toISOString().slice(0,10)} last=${new Date(Number(tl[tl.length-1])).toISOString().slice(0,10)}`);
  console.log(`data_list[0]  = ${JSON.stringify(dl[0])}`);
  console.log(`data_list[mid]= ${JSON.stringify(dl[Math.floor(dl.length/2)])}`);
  console.log(`data_list[last]=${JSON.stringify(dl[dl.length-1])}`);
  // union of keys across a few recent rows to see if it's multi-coin near the end
  const keyset = new Set<string>();
  for (let i = Math.max(0, dl.length - 5); i < dl.length; i++) Object.keys(dl[i] || {}).forEach(k => keyset.add(k));
  console.log(`recent data_list keys (union of last 5) = ${JSON.stringify([...keyset])}`);
  console.log(`price_list[last] = ${pl[pl.length-1]} (BTC price embedded)`);
}
main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
