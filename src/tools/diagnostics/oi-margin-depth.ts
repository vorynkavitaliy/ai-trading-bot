/**
 * oi-margin-depth — find max available history across intervals for the two
 * margin-OI endpoints, and confirm units. Read-only.
 * Run: npx tsx src/tools/diagnostics/oi-margin-depth.ts
 */
import { cgGet } from '../../core/coinglass';

const EX = 'Binance,OKX,Bybit,Bitget,Gate,Huobi,Deribit,dYdX,Bitmex,CoinEx';
const COIN = '/futures/open-interest/aggregated-coin-margin-history';
const STABLE = '/futures/open-interest/aggregated-stablecoin-history';

async function probe(path: string, interval: string) {
  try {
    const r = await cgGet<any>(path, { symbol: 'BTC', interval, exchange_list: EX, limit: 100000 });
    const d = r.data as any[];
    if (!Array.isArray(d) || d.length === 0) return `${interval}: empty`;
    const f = d[0], l = d[d.length - 1];
    const iso = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 16);
    const days = (Number(l.time) - Number(f.time)) / 86400000;
    return `${interval}: n=${d.length}  ${iso(f.time)} → ${iso(l.time)}  (~${days.toFixed(0)}d)  closeRange=[${Math.min(...d.map((x:any)=>x.close)).toExponential(3)}..${Math.max(...d.map((x:any)=>x.close)).toExponential(3)}]`;
  } catch (e: any) {
    return `${interval}: ERR ${(e?.message ?? String(e)).slice(0, 100)}`;
  }
}

async function main() {
  for (const [label, path] of [['COIN', COIN], ['STABLE', STABLE]] as const) {
    console.log(`\n=== ${label}  ${path}`);
    for (const iv of ['4h', '12h', '1d', '1w']) {
      console.log('  ' + await probe(path, iv));
      await new Promise(r => setTimeout(r, 350));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
