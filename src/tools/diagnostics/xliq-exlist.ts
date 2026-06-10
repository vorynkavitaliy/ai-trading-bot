/**
 * xliq-exlist — discover the valid exchange_list values + max history span for the
 * aggregated liquidation & taker endpoints. Read-only.
 */
import { cgGet } from '../../core/coinglass';

async function show(label: string, path: string, params: Record<string, string | number>) {
  try {
    const r = await cgGet<any>(path, params);
    const data: any = r.data;
    if (Array.isArray(data)) {
      console.log(`  [${label}] OK array rows=${data.length} sample=${JSON.stringify(data.slice(0, 8))}`);
    } else {
      console.log(`  [${label}] OK obj keys=${JSON.stringify(Object.keys(data || {}))}`);
    }
  } catch (e: any) {
    console.log(`  [${label}] ERR ${e?.message ?? String(e)}`);
  }
}

async function spanOf(label: string, path: string, exList: string) {
  try {
    const r = await cgGet<any[]>(path, { symbol: 'BTC', exchange_list: exList, interval: '4h', limit: 100000 });
    const data = r.data || [];
    if (!data.length) { console.log(`  [${label}] 0 rows`); return; }
    const first = data[0].time, last = data[data.length - 1].time;
    console.log(`  [${label}] rows=${data.length}  ${new Date(first).toISOString()} -> ${new Date(last).toISOString()}`);
  } catch (e: any) {
    console.log(`  [${label}] ERR ${e?.message ?? String(e)}`);
  }
}

async function main() {
  console.log('=== exchange lists ===');
  await show('liq-exchange-list', '/futures/liquidation/exchange-list', { range: '24h' });
  await show('taker-support', '/futures/supported-exchange-pairs', {});
  await show('liq-support-pairs', '/futures/supported-coins', {});

  console.log('\n=== max span, liq-agg, broad exchange CSV ===');
  const broad = 'Binance,OKX,Bybit,Bitget,Hyperliquid,dYdX,Gate,Huobi,Deribit,Kraken,Bitmex,CoinEx';
  await spanOf('liq broad', '/futures/liquidation/aggregated-history', broad);
  await spanOf('liq Binance,OKX,Bybit', '/futures/liquidation/aggregated-history', 'Binance,OKX,Bybit');

  console.log('\n=== max span, taker-agg, broad exchange CSV ===');
  await spanOf('taker broad', '/futures/aggregated-taker-buy-sell-volume/history', broad);
  await spanOf('taker Binance,OKX,Bybit', '/futures/aggregated-taker-buy-sell-volume/history', 'Binance,OKX,Bybit');
  await spanOf('taker Binance', '/futures/aggregated-taker-buy-sell-volume/history', 'Binance');

  // taker sample shape
  console.log('\n=== taker shape (Binance,OKX,Bybit) ===');
  await show('taker shape', '/futures/aggregated-taker-buy-sell-volume/history', { symbol: 'BTC', exchange_list: 'Binance,OKX,Bybit', interval: '4h', limit: 3 });
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
