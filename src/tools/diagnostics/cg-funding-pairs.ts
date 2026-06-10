/**
 * cg-funding-pairs — discover per-exchange instrument symbols and probe funding history
 * with the correct pair string per exchange. Tries CG supported-pairs endpoints, then
 * probes a few common symbol conventions per exchange for funding-rate/history.
 *
 * Run: npx tsx src/tools/diagnostics/cg-funding-pairs.ts [BTC]
 */
import { cgGet } from '../../core/coinglass';

const PACE_MS = 300;
const coin = process.argv[2] ?? 'BTC';

async function tryPath(name: string, path: string, params: Record<string, any>) {
  try {
    const r = await cgGet<any>(path, params);
    const d = (r as any).data;
    let summary: string;
    if (Array.isArray(d)) summary = `array len=${d.length} first=${JSON.stringify(d[0]).slice(0, 400)}`;
    else summary = `obj keys=[${Object.keys(d ?? {}).join(',')}] ${JSON.stringify(d).slice(0, 400)}`;
    console.log(`OK   ${name} ${path}\n     ${summary}\n`);
    return d;
  } catch (e: any) {
    console.log(`ERR  ${name} ${path} :: ${String(e?.message ?? e).slice(0, 160)}\n`);
    return null;
  }
}

async function main() {
  console.log(`\n=== discover supported pairs for funding history (${coin}) ===\n`);
  await tryPath('supported-coins',  '/futures/supported-coins', {});
  await new Promise(r => setTimeout(r, PACE_MS));
  await tryPath('supported-pairs',  '/futures/supported-exchange-pairs', {});
  await new Promise(r => setTimeout(r, PACE_MS));

  // Per-exchange symbol convention guesses
  const tests: { ex: string; sym: string }[] = [
    { ex: 'OKX', sym: 'BTC-USDT-SWAP' },
    { ex: 'OKX', sym: 'BTC-USDT' },
    { ex: 'Bitget', sym: 'BTCUSDT_UMCBL' },
    { ex: 'Bitget', sym: 'BTCUSDT' },
    { ex: 'Gate', sym: 'BTC_USDT' },
    { ex: 'HTX', sym: 'BTC-USDT' },
    { ex: 'Kraken', sym: 'PF_XBTUSD' },
    { ex: 'KuCoin', sym: 'XBTUSDTM' },
    { ex: 'MEXC', sym: 'BTC_USDT' },
    { ex: 'Hyperliquid', sym: 'BTC' },
    { ex: 'dYdX', sym: 'BTC-USD' },
    { ex: 'Bitmex', sym: 'XBTUSDT' },
  ];
  for (const t of tests) {
    await tryPath(`hist-${t.ex}-${t.sym}`, '/futures/funding-rate/history', { exchange: t.ex, symbol: t.sym, interval: '4h', limit: 3 });
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
