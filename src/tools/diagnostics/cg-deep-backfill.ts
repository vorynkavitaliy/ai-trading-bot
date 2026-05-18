// Re-backfill all CG history tables with deeper coverage (360d via limit=4500 vs old 90d via limit=540).
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';
import { log } from '../../core/logger';

const PAIRS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','DOGEUSDT','TONUSDT','APTUSDT','ARBUSDT','INJUSDT','TAOUSDT','HYPEUSDT'];
const COINS = ['BTC','ETH','SOL','XRP','BNB','LTC','ATOM','DOGE','TON','APT','ARB','INJ','TAO','HYPE'];
const REF_EX = 'Binance';
const TF = '4h';
const LIMIT = 4500;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function bulk(table: string, cols: string[], rows: any[][]) {
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

async function main() {
  for (const coin of COINS) {
    const oi = await cgGet<any[]>('/futures/open-interest/aggregated-history', { symbol: coin, interval: TF, limit: LIMIT });
    await bulk('cg_oi_aggregated', ['symbol','ts','oi_open','oi_high','oi_low','oi_close'],
      (oi.data ?? []).map((d: any) => [coin, d.time, d.open, d.high, d.low, d.close]));
    await sleep(220);
    const fo = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', { symbol: coin, interval: TF, limit: LIMIT });
    await bulk('cg_funding_oi_weighted', ['symbol','ts','fr_open','fr_high','fr_low','fr_close'],
      (fo.data ?? []).map((d: any) => [coin, d.time, d.open, d.high, d.low, d.close]));
    await sleep(220);
    const fv = await cgGet<any[]>('/futures/funding-rate/vol-weight-history', { symbol: coin, interval: TF, limit: LIMIT });
    await bulk('cg_funding_vol_weighted', ['symbol','ts','fr_open','fr_high','fr_low','fr_close'],
      (fv.data ?? []).map((d: any) => [coin, d.time, d.open, d.high, d.low, d.close]));
    await sleep(220);
    log.info('coin done', { coin });
  }

  for (const pair of PAIRS) {
    const ga = await cgGet<any[]>('/futures/global-long-short-account-ratio/history', { exchange: REF_EX, symbol: pair, interval: TF, limit: LIMIT });
    await bulk('cg_ls_global_account', ['exchange','pair','ts','long_pct','short_pct','ratio'],
      (ga.data ?? []).map((d: any) => [REF_EX, pair, d.time, d.global_account_long_percent, d.global_account_short_percent, d.global_account_long_short_ratio]));
    await sleep(220);
    const ta = await cgGet<any[]>('/futures/top-long-short-account-ratio/history', { exchange: REF_EX, symbol: pair, interval: TF, limit: LIMIT });
    await bulk('cg_ls_top_account', ['exchange','pair','ts','long_pct','short_pct','ratio'],
      (ta.data ?? []).map((d: any) => [REF_EX, pair, d.time, d.top_account_long_percent, d.top_account_short_percent, d.top_account_long_short_ratio]));
    await sleep(220);
    const tp = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', { exchange: REF_EX, symbol: pair, interval: TF, limit: LIMIT });
    await bulk('cg_ls_top_position', ['exchange','pair','ts','long_pct','short_pct','ratio'],
      (tp.data ?? []).map((d: any) => [REF_EX, pair, d.time, d.top_position_long_percent, d.top_position_short_percent, d.top_position_long_short_ratio]));
    await sleep(220);
    const tk = await cgGet<any[]>('/futures/taker-buy-sell-volume/history', { exchange: REF_EX, symbol: pair, interval: TF, limit: LIMIT });
    await bulk('cg_taker_pair', ['exchange','pair','ts','buy_usd','sell_usd'],
      (tk.data ?? []).map((d: any) => [REF_EX, pair, d.time, d.taker_buy_volume_usd, d.taker_sell_volume_usd]));
    await sleep(220);
    const lq = await cgGet<any[]>('/futures/liquidation/history', { exchange: REF_EX, symbol: pair, interval: TF, limit: LIMIT });
    await bulk('cg_liq_pair', ['exchange','pair','ts','long_liq_usd','short_liq_usd'],
      (lq.data ?? []).map((d: any) => [REF_EX, pair, d.time, d.long_liquidation_usd, d.short_liquidation_usd]));
    await sleep(220);
    log.info('pair done', { pair });
  }

  for (const t of ['cg_oi_aggregated','cg_funding_oi_weighted','cg_funding_vol_weighted','cg_ls_global_account','cg_ls_top_account','cg_ls_top_position','cg_taker_pair','cg_liq_pair']) {
    const r = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${t}`);
    log.info('table', { table: t, count: r.rows[0].c });
  }
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
