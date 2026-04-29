import { query } from '../lib/db';

// Cross-exchange aggregates from Coinglass at-or-before atTs.
// All queries enforce ts <= atTs to prevent lookahead bias.
// Returns null fields when Coinglass data has not yet been backfilled at that ts.
export interface CoinglassFeatures {
  oi_close: number | null;
  oi_delta_24h: number | null;
  oi_pct_chg_24h: number | null;
  funding_oi_weighted: number | null;
  funding_vol_weighted: number | null;
  ls_global_account: number | null;
  ls_top_account: number | null;
  ls_top_position: number | null;
  liq_long_24h_usd: number | null;
  liq_short_24h_usd: number | null;
  taker_buy_24h_usd: number | null;
  taker_sell_24h_usd: number | null;
  taker_delta_24h_usd: number | null;
}

export const EMPTY_CG_FEATURES: CoinglassFeatures = {
  oi_close: null, oi_delta_24h: null, oi_pct_chg_24h: null,
  funding_oi_weighted: null, funding_vol_weighted: null,
  ls_global_account: null, ls_top_account: null, ls_top_position: null,
  liq_long_24h_usd: null, liq_short_24h_usd: null,
  taker_buy_24h_usd: null, taker_sell_24h_usd: null, taker_delta_24h_usd: null,
};

const MS_24H = 24 * 3600_000;

export async function loadCoinglassAt(coin: string, pair: string, atTs: number): Promise<CoinglassFeatures> {
  const oiNow = await query<{ oi_close: string }>(
    `SELECT oi_close::text FROM cg_oi_aggregated
     WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs]
  );
  const oi24 = await query<{ oi_close: string }>(
    `SELECT oi_close::text FROM cg_oi_aggregated
     WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs - MS_24H]
  );
  const oiClose = oiNow.rows[0] ? parseFloat(oiNow.rows[0].oi_close) : null;
  const oi24Close = oi24.rows[0] ? parseFloat(oi24.rows[0].oi_close) : null;
  const oiDelta = oiClose != null && oi24Close != null ? oiClose - oi24Close : null;
  const oiPct = oiDelta != null && oi24Close != null && oi24Close > 0 ? (oiDelta / oi24Close) * 100 : null;

  const fOi = await query<{ fr_close: string }>(
    `SELECT fr_close::text FROM cg_funding_oi_weighted WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs]
  );
  const fVol = await query<{ fr_close: string }>(
    `SELECT fr_close::text FROM cg_funding_vol_weighted WHERE symbol = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [coin, atTs]
  );
  const lsGlobal = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_global_account WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [pair, atTs]
  );
  const lsTopAcc = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_top_account WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [pair, atTs]
  );
  const lsTopPos = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_top_position WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
    [pair, atTs]
  );
  const liqRows = await query<{ long_liq_usd: string; short_liq_usd: string }>(
    `SELECT long_liq_usd::text, short_liq_usd::text FROM cg_liq_pair
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 AND ts > $3
     ORDER BY ts DESC`,
    [pair, atTs, atTs - MS_24H]
  );
  const liqLong = liqRows.rows.reduce((s, r) => s + parseFloat(r.long_liq_usd), 0);
  const liqShort = liqRows.rows.reduce((s, r) => s + parseFloat(r.short_liq_usd), 0);
  const takerRows = await query<{ buy_usd: string; sell_usd: string }>(
    `SELECT buy_usd::text, sell_usd::text FROM cg_taker_pair
     WHERE pair = $1 AND exchange = 'Binance' AND ts <= $2 AND ts > $3
     ORDER BY ts DESC`,
    [pair, atTs, atTs - MS_24H]
  );
  const takerBuy = takerRows.rows.reduce((s, r) => s + parseFloat(r.buy_usd), 0);
  const takerSell = takerRows.rows.reduce((s, r) => s + parseFloat(r.sell_usd), 0);

  return {
    oi_close: oiClose,
    oi_delta_24h: oiDelta,
    oi_pct_chg_24h: oiPct,
    funding_oi_weighted: fOi.rows[0] ? parseFloat(fOi.rows[0].fr_close) : null,
    funding_vol_weighted: fVol.rows[0] ? parseFloat(fVol.rows[0].fr_close) : null,
    ls_global_account: lsGlobal.rows[0] ? parseFloat(lsGlobal.rows[0].ratio) : null,
    ls_top_account: lsTopAcc.rows[0] ? parseFloat(lsTopAcc.rows[0].ratio) : null,
    ls_top_position: lsTopPos.rows[0] ? parseFloat(lsTopPos.rows[0].ratio) : null,
    liq_long_24h_usd: liqLong > 0 ? Math.round(liqLong) : null,
    liq_short_24h_usd: liqShort > 0 ? Math.round(liqShort) : null,
    taker_buy_24h_usd: takerBuy > 0 ? Math.round(takerBuy) : null,
    taker_sell_24h_usd: takerSell > 0 ? Math.round(takerSell) : null,
    taker_delta_24h_usd: takerBuy + takerSell > 0 ? Math.round(takerBuy - takerSell) : null,
  };
}
