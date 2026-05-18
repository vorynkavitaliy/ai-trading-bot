// Backfill 5m CG data for top correlation features (15d coverage on Standard).
import { cgGet } from '../../core/coinglass';
import { runMigrations, query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const PAIRS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','DOGEUSDT','TONUSDT','APTUSDT','ARBUSDT','INJUSDT','TAOUSDT','HYPEUSDT'];
const COINS = ['BTC','ETH','SOL','XRP','BNB','LTC','ATOM','DOGE','TON','APT','ARB','INJ','TAO','HYPE'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function bulk(table: string, cols: string[], rows: any[][]) {
  if (rows.length === 0) return;
  const ph: string[] = []; const flat: any[] = []; let p = 1;
  for (const row of rows) { ph.push(`(${row.map(() => '$' + (p++)).join(',')})`); flat.push(...row); }
  await query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph.join(',')} ON CONFLICT DO NOTHING`, flat);
}

async function main() {
  await runMigrations();

  for (const coin of COINS) {
    const oi = await cgGet<any[]>('/futures/open-interest/aggregated-history', { symbol: coin, interval: '5m', limit: 4500 });
    await bulk('cg_oi_aggregated_5m', ['symbol','ts','oi_open','oi_high','oi_low','oi_close'],
      (oi.data ?? []).map((d:any) => [coin, d.time, d.open, d.high, d.low, d.close]));
    await sleep(220);
    const fo = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', { symbol: coin, interval: '5m', limit: 4500 });
    await bulk('cg_funding_oi_5m', ['symbol','ts','fr_open','fr_high','fr_low','fr_close'],
      (fo.data ?? []).map((d:any) => [coin, d.time, d.open, d.high, d.low, d.close]));
    await sleep(220);
    log.info('coin 5m done', { coin });
  }

  for (const pair of PAIRS) {
    const lsP = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', { exchange: 'Binance', symbol: pair, interval: '5m', limit: 4500 });
    await bulk('cg_ls_top_position_5m', ['exchange','pair','ts','long_pct','short_pct','ratio'],
      (lsP.data ?? []).map((d:any) => ['Binance', pair, d.time, d.top_position_long_percent, d.top_position_short_percent, d.top_position_long_short_ratio]));
    await sleep(220);
    const tk = await cgGet<any[]>('/futures/taker-buy-sell-volume/history', { exchange: 'Binance', symbol: pair, interval: '5m', limit: 4500 });
    await bulk('cg_taker_pair_5m', ['exchange','pair','ts','buy_usd','sell_usd'],
      (tk.data ?? []).map((d:any) => ['Binance', pair, d.time, d.taker_buy_volume_usd, d.taker_sell_volume_usd]));
    await sleep(220);
    const lq = await cgGet<any[]>('/futures/liquidation/history', { exchange: 'Binance', symbol: pair, interval: '5m', limit: 4500 });
    await bulk('cg_liq_pair_5m', ['exchange','pair','ts','long_liq_usd','short_liq_usd'],
      (lq.data ?? []).map((d:any) => ['Binance', pair, d.time, d.long_liquidation_usd, d.short_liquidation_usd]));
    await sleep(220);
    log.info('pair 5m done', { pair });
  }

  for (const t of ['cg_oi_aggregated_5m','cg_funding_oi_5m','cg_ls_top_position_5m','cg_taker_pair_5m','cg_liq_pair_5m']) {
    const r = await query<{c: string}>(`SELECT COUNT(*)::text AS c FROM ${t}`);
    log.info('table 5m', { table: t, count: r.rows[0].c });
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
