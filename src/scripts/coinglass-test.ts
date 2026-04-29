import { cgGet } from '../lib/coinglass';
import { log } from '../lib/logger';

// Minimal auth probe: hit /futures/supported-coins. If our key works,
// we get a JSON list of supported coin symbols. Then probe one data
// endpoint each from the categories we plan to use, and dump the
// shape of the first row so we can model the DB schema correctly.

const probes: Array<[string, string, Record<string, any>]> = [
  ['supported-coins', '/futures/supported-coins', {}],
  ['supported-pairs', '/futures/supported-exchange-pairs', {}],
  ['oi-aggregated', '/futures/open-interest/aggregated-history', {
    symbol: 'BTC', interval: '4h', limit: 5,
  }],
  ['funding-oi-weight', '/futures/funding-rate/oi-weight-history', {
    symbol: 'BTC', interval: '4h', limit: 5,
  }],
  ['ls-global-acc', '/futures/global-long-short-account-ratio/history', {
    exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5,
  }],
  ['ls-top-acc', '/futures/top-long-short-account-ratio/history', {
    exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5,
  }],
  ['ls-top-pos', '/futures/top-long-short-position-ratio/history', {
    exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5,
  }],
  ['taker-pair', '/futures/taker-buy-sell-volume/history', {
    exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5,
  }],
  ['taker-aggregated', '/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: 'BTC', interval: '4h', limit: 5,
  }],
  ['liq-history', '/futures/liquidation/history', {
    exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 5,
  }],
  ['liq-aggregated-history', '/futures/liquidation/aggregated-history', {
    symbol: 'BTC', interval: '4h', limit: 5,
  }],
  ['liq-coin-list', '/futures/liquidation/coin-list', { range: '24h' }],
  ['liq-exchange-list', '/futures/liquidation/exchange-list', { range: '24h' }],
  ['liq-heatmap', '/futures/liquidation/heatmap/model1', {
    exchange: 'Binance', symbol: 'BTCUSDT', range: '24h',
  }],
];

async function main() {
  const startTs = Date.now();
  for (const [name, path, params] of probes) {
    try {
      const r = await cgGet(path, params);
      const data = (r as any).data;
      let preview: any;
      if (Array.isArray(data)) {
        preview = { isArray: true, length: data.length, first: data[0] ?? null };
      } else if (typeof data === 'object' && data !== null) {
        const keys = Object.keys(data);
        preview = { keys: keys.slice(0, 12), first_key_sample: keys[0] ? data[keys[0]] : null };
        // If looks like { ts: [...], values: [...] }, sample the arrays
        if (Array.isArray((data as any)?.list)) {
          preview.list_length = (data as any).list.length;
          preview.list_first = (data as any).list[0] ?? null;
        }
      } else {
        preview = data;
      }
      console.log(`OK  ${name.padEnd(24)} ${path}`);
      console.log(`    ${JSON.stringify(preview).slice(0, 600)}`);
    } catch (e: any) {
      console.log(`FAIL ${name.padEnd(24)} ${path}`);
      console.log(`    ${e?.message ?? String(e)}`);
    }
    // Hobbyist limit 30 req/min → 500 ms between probes is safe
    await new Promise(r => setTimeout(r, 500));
  }
  log.info('coinglass-test complete', { elapsed_ms: Date.now() - startTs });
}

main().catch(e => {
  log.error('coinglass-test crashed', { err: e?.message ?? String(e) });
  process.exit(1);
});
