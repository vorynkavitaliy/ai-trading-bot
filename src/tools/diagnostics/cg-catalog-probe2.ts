/**
 * cg-catalog-probe2 — second-pass path-verification for the high-value 404s from
 * cg-catalog-probe (indicator history variants, on-chain cycle indices, account tier,
 * netflow/footprint, delisted, heatmap). Tries alternate v4 slug shapes ONCE each.
 * Read-only. Run: npx tsx src/tools/diagnostics/cg-catalog-probe2.ts
 */
import { cgGet } from '../../core/coinglass';

const T = 12_000;
const PACE = 320;
const EX = 'Binance', PAIR = 'BTCUSDT', SYM = 'BTC';

interface P { name: string; path: string; params: Record<string, string | number>; }

const probes: P[] = [
  // indicator histories — many alt slug shapes
  { name: 'ma-1',  path: '/futures/indicator/ma/history',  params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'ma-2',  path: '/indic/futures/ma',              params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'rsi-h', path: '/futures/rsi/history',           params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'ema-h', path: '/futures/ema/history',           params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'boll-h',path: '/futures/boll/history',          params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'macd-h',path: '/futures/macd/history',          params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'atr-h', path: '/futures/atr/history',           params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  { name: 'td-h',  path: '/futures/td/history',            params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  // whale-index with exchange param (400 said exchange required)
  { name: 'whale-idx', path: '/futures/whale-index/history', params: { exchange: EX, symbol: PAIR, interval: '4h', limit: 5 } },
  // on-chain cycle indices — bitcoin- prefix vs none, /index vs root
  { name: 'sopr-1',     path: '/index/bitcoin-sth-sopr',       params: {} },
  { name: 'sopr-2',     path: '/bitcoin-sth-sopr',             params: {} },
  { name: 'realized-1', path: '/index/bitcoin-realized-price', params: {} },
  { name: 'rainbow-2',  path: '/index/bitcoin-rainbow',        params: {} },
  { name: 'rhodl-2',    path: '/index/bitcoin-rhodl-ratio',    params: {} },
  { name: 'nupl-2',     path: '/index/bitcoin-nupl',           params: {} },
  { name: 'profdays-2', path: '/index/bitcoin-days-of-profit', params: {} },
  // netflow / footprint alt shapes
  { name: 'netflow-1', path: '/futures/taker-buy-sell-volume/netflow', params: { symbol: SYM } },
  { name: 'spot-netflow-1', path: '/spot/netflow/history', params: { symbol: SYM, interval: '4h', limit: 5 } },
  // delisted
  { name: 'delisted-1', path: '/futures/instruments/delisted', params: {} },
  // heatmap (correct model path is liquidation, ob-heatmap may not exist; try liq heatmap model3 already known tier-locked — skip)
  // account / tier — try common shapes
  { name: 'acct-1', path: '/account/subscription-info', params: {} },
  { name: 'acct-2', path: '/user/info',                 params: {} },
  { name: 'acct-3', path: '/api-usage',                 params: {} },
  // erc20 / whale transfer
  { name: 'erc20-1', path: '/exchange/chain/erc20/transfer', params: { symbol: SYM } },
];

function withTimeout<T2>(p: Promise<T2>, ms: number, l: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${l})`)), ms))]);
}

function shape(data: any): string {
  if (data == null) return 'null';
  if (Array.isArray(data)) {
    const f = data[0];
    const k = f && typeof f === 'object' && !Array.isArray(f) ? Object.keys(f).join(',') : Array.isArray(f) ? '<tuple>' : typeof f;
    return `array n=${data.length} keys=[${k}]`.slice(0, 220);
  }
  if (typeof data === 'object') return `obj keys=[${Object.keys(data).join(',')}]`.slice(0, 220);
  return `scalar ${String(data)}`.slice(0, 120);
}

async function main() {
  console.log('=== cg-catalog-probe2 (alt-path retries) ===\n');
  for (const p of probes) {
    try {
      const r: any = await withTimeout(cgGet<any>(p.path, p.params), T, p.name);
      console.log(`OK   ${p.name.padEnd(13)} ${p.path}`);
      console.log(`     ${shape(r.data)}`);
    } catch (e: any) {
      const m = (e?.message ?? String(e));
      const code = m.match(/code=([^\s]+)/)?.[1] ?? '?';
      console.log(`${code === '404' ? 'PATH' : code === '401' || code === '403' ? 'LOCK' : code === '400' ? 'BADP' : 'ERR '} ${p.name.padEnd(13)} ${p.path}  code=${code}`);
      if (code !== '404') console.log(`     ${m.slice(0, 160)}`);
    }
    await new Promise(r => setTimeout(r, PACE));
  }
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
