// Backfill new CG endpoints for BTC research:
//   Coinbase Premium, BTC ETF flows, aggregated taker, aggregated liquidations
import { cgGet } from '../../core/coinglass';
import { runMigrations, query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const EX_LIST = 'Binance,OKX,Bybit,Bitget,Bitmex,Bitfinex,KuCoin';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function bulk<T>(table: string, cols: string[], rows: T[][]) {
  if (rows.length === 0) return;
  const placeholders: string[] = [];
  const flat: any[] = [];
  let p = 1;
  for (const row of rows) {
    placeholders.push(`(${row.map(() => '$' + (p++)).join(',')})`);
    flat.push(...row);
  }
  await query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
    flat
  );
}

async function backfillCbPremium() {
  // 1d granularity gives us 2017+ depth. For research a 4h cadence is more useful
  // since our backtest is at 1H decision but features at 4H are sufficient for slow signals like premium.
  const r = await cgGet<any[]>('/coinbase-premium-index', { interval: '4h', limit: 4500 });
  const rows = (r.data ?? []).map((d: any) => [
    Number(d.time) * (d.time < 1e12 ? 1000 : 1),
    d.premium, d.premium_rate, d.coinbase_price,
  ]);
  await bulk('cg_cb_premium', ['ts', 'premium', 'premium_rate', 'coinbase_price'], rows);
  log.info('cb premium backfilled', { rows: rows.length });
}

async function backfillEtfFlow() {
  const r = await cgGet<any[]>('/etf/bitcoin/flow-history', {});
  const rows = (r.data ?? []).map((d: any) => [
    Number(d.timestamp), d.flow_usd, d.price_usd,
  ]);
  await bulk('cg_btc_etf_flow', ['ts', 'flow_usd', 'price_usd'], rows);
  log.info('btc etf flow backfilled', { rows: rows.length });
}

async function backfillAggTaker(coin: string) {
  const r = await cgGet<any[]>('/futures/aggregated-taker-buy-sell-volume/history', {
    symbol: coin, interval: '4h', limit: 4500, exchange_list: EX_LIST,
  });
  const rows = (r.data ?? []).map((d: any) => [
    coin, d.time, d.aggregated_buy_volume_usd, d.aggregated_sell_volume_usd,
  ]);
  await bulk('cg_agg_taker_coin', ['symbol', 'ts', 'agg_buy_usd', 'agg_sell_usd'], rows);
  log.info('agg taker backfilled', { coin, rows: rows.length });
}

async function backfillAggLiq(coin: string) {
  const r = await cgGet<any[]>('/futures/liquidation/aggregated-history', {
    symbol: coin, interval: '4h', limit: 4500, exchange_list: EX_LIST,
  });
  const rows = (r.data ?? []).map((d: any) => [
    coin, d.time, d.aggregated_long_liquidation_usd, d.aggregated_short_liquidation_usd,
  ]);
  await bulk('cg_agg_liq_coin', ['symbol', 'ts', 'agg_long_liq_usd', 'agg_short_liq_usd'], rows);
  log.info('agg liq backfilled', { coin, rows: rows.length });
}

async function main() {
  await runMigrations();

  await backfillCbPremium();          await sleep(220);
  await backfillEtfFlow();            await sleep(220);
  await backfillAggTaker('BTC');      await sleep(220);
  await backfillAggLiq('BTC');        await sleep(220);

  // Counts
  for (const t of ['cg_cb_premium', 'cg_btc_etf_flow', 'cg_agg_taker_coin', 'cg_agg_liq_coin']) {
    const r = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${t}`);
    log.info('table', { table: t, count: r.rows[0].c });
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
