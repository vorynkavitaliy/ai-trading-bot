import { cgGet } from '../../core/coinglass';

async function main() {
  for (const path of [
    '/futures/global-long-short-account-ratio/history',
    '/futures/top-long-short-account-ratio/history',
    '/futures/top-long-short-position-ratio/history',
  ]) {
    const r = await cgGet<any[]>(path, { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 1 });
    console.log(path, '→', JSON.stringify(r.data?.[0]));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
