/**
 * Step 2 of BTC WR-uplift research (2026-05-24).
 *
 * Reads /tmp/btc-trades.json (from btc-extract-trades.ts) and enriches each
 * trade with all available Coinglass features at entryTs.
 *
 * ANTI-LOOK-AHEAD DISCIPLINE:
 *   - All queries use `ts < entryTs` (strict less-than) — does NOT include the
 *     4H bar whose open == entryTs. Decision was taken at entryTs based on the
 *     PREVIOUSLY CLOSED 4H bar, so we use the freshest CG data that finalised
 *     before entryTs.
 *   - For ETF flow (1d), we use ts <= entryTs - 24h to be doubly safe: ETF
 *     flows are reported ~6h after market close, so today's flow is not really
 *     known until tomorrow.
 *
 * Features added per trade:
 *   - cb_premium_rate (-/+)
 *   - cb_premium_pct: percentile over last 180 4H bars (~30d)
 *   - etf_flow_5d_usd: 5-day cumulative net flow
 *   - etf_flow_5d_sign: +1/0/-1
 *   - agg_taker_delta_pct: (buy-sell)/(buy+sell) at last 4H
 *   - agg_taker_delta_24h_pct: aggregated over 6 bars (24h)
 *   - agg_liq_squeeze_24h: short_liq / (short_liq + long_liq) over 24h
 *   - ob_imbalance: (bids-asks)/(bids+asks) at last 4H
 *   - funding_oi_pct: percentile of funding over 180 bars
 *   - funding_oi: raw
 *   - ls_top_account_pct: percentile
 *   - ls_global_account_pct: percentile (retail proxy)
 *   - oi_pct_chg_24h: same as live runtime
 *
 * Output: /tmp/btc-trades-enriched.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { query, close as closePg } from '../../core/db';

const COIN = 'BTC';
const PAIR = 'BTCUSDT';
const MS_4H = 4 * 3600_000;
const MS_24H = 24 * 3600_000;
const MS_5D = 5 * MS_24H;
const HIST_BARS = 180; // ~30d at 4H

function percentile(arr: number[], v: number): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  let count = 0;
  for (const x of sorted) if (x <= v) count++;
  return count / sorted.length;
}

async function enrichOne(entryTs: number) {
  // CB Premium current + percentile (use premium_rate, normalized vs price).
  const cbCur = await query<{ premium_rate: string; ts: string }>(
    `SELECT premium_rate::text, ts::text FROM cg_cb_premium
     WHERE ts < $1 ORDER BY ts DESC LIMIT 1`, [entryTs]
  );
  const cbHist = await query<{ premium_rate: string }>(
    `SELECT premium_rate::text FROM cg_cb_premium
     WHERE ts < $1 ORDER BY ts DESC LIMIT $2`, [entryTs, HIST_BARS]
  );
  const cbRate = cbCur.rows[0] ? parseFloat(cbCur.rows[0].premium_rate) : null;
  const cbHistArr = cbHist.rows.map(r => parseFloat(r.premium_rate));
  const cbPct = cbRate != null ? percentile(cbHistArr, cbRate) : null;

  // ETF flow: 5d cumulative ending at (entryTs - 24h) to avoid same-day disclosure lag.
  const etfRows = await query<{ flow_usd: string }>(
    `SELECT flow_usd::text FROM cg_btc_etf_flow
     WHERE ts < $1 AND ts >= $2`, [entryTs - MS_24H, entryTs - MS_24H - MS_5D]
  );
  const etfSum = etfRows.rows.reduce((s, r) => s + parseFloat(r.flow_usd), 0);
  const etfSign = etfSum > 1e7 ? 1 : etfSum < -1e7 ? -1 : 0; // ±$10M deadband

  // Agg taker — last 4H bar
  const takerCur = await query<{ agg_buy_usd: string; agg_sell_usd: string }>(
    `SELECT agg_buy_usd::text, agg_sell_usd::text FROM cg_agg_taker_coin
     WHERE symbol=$1 AND ts < $2 ORDER BY ts DESC LIMIT 1`, [COIN, entryTs]
  );
  const tBuy = takerCur.rows[0] ? parseFloat(takerCur.rows[0].agg_buy_usd) : 0;
  const tSell = takerCur.rows[0] ? parseFloat(takerCur.rows[0].agg_sell_usd) : 0;
  const aggTakerDeltaPct = (tBuy + tSell) > 0 ? (tBuy - tSell) / (tBuy + tSell) : null;

  // Agg taker — 24h aggregated (6 × 4H bars)
  const takerRows = await query<{ agg_buy_usd: string; agg_sell_usd: string }>(
    `SELECT agg_buy_usd::text, agg_sell_usd::text FROM cg_agg_taker_coin
     WHERE symbol=$1 AND ts < $2 AND ts >= $3
     ORDER BY ts DESC`, [COIN, entryTs, entryTs - MS_24H]
  );
  const t24Buy = takerRows.rows.reduce((s, r) => s + parseFloat(r.agg_buy_usd), 0);
  const t24Sell = takerRows.rows.reduce((s, r) => s + parseFloat(r.agg_sell_usd), 0);
  const aggTakerDelta24hPct = (t24Buy + t24Sell) > 0 ? (t24Buy - t24Sell) / (t24Buy + t24Sell) : null;

  // Agg liq — 24h squeeze ratio
  const liqRows = await query<{ agg_long_liq_usd: string; agg_short_liq_usd: string }>(
    `SELECT agg_long_liq_usd::text, agg_short_liq_usd::text FROM cg_agg_liq_coin
     WHERE symbol=$1 AND ts < $2 AND ts >= $3
     ORDER BY ts DESC`, [COIN, entryTs, entryTs - MS_24H]
  );
  const longLiq = liqRows.rows.reduce((s, r) => s + parseFloat(r.agg_long_liq_usd), 0);
  const shortLiq = liqRows.rows.reduce((s, r) => s + parseFloat(r.agg_short_liq_usd), 0);
  const liqSqueeze24h = (longLiq + shortLiq) > 0 ? shortLiq / (longLiq + shortLiq) : null;
  const liqTotal24h = longLiq + shortLiq;

  // Orderbook imbalance at last 4H
  const obCur = await query<{ bids_usd: string; asks_usd: string }>(
    `SELECT bids_usd::text, asks_usd::text FROM cg_orderbook_pair
     WHERE pair=$1 AND exchange='Binance' AND ts < $2 ORDER BY ts DESC LIMIT 1`, [PAIR, entryTs]
  );
  const bids = obCur.rows[0] ? parseFloat(obCur.rows[0].bids_usd) : 0;
  const asks = obCur.rows[0] ? parseFloat(obCur.rows[0].asks_usd) : 0;
  const obImbalance = (bids + asks) > 0 ? (bids - asks) / (bids + asks) : null;

  // Funding OI weighted + percentile
  const fundCur = await query<{ fr_close: string }>(
    `SELECT fr_close::text FROM cg_funding_oi_weighted
     WHERE symbol=$1 AND ts < $2 ORDER BY ts DESC LIMIT 1`, [COIN, entryTs]
  );
  const fundHist = await query<{ fr_close: string }>(
    `SELECT fr_close::text FROM cg_funding_oi_weighted
     WHERE symbol=$1 AND ts < $2 ORDER BY ts DESC LIMIT $3`, [COIN, entryTs, HIST_BARS]
  );
  const fund = fundCur.rows[0] ? parseFloat(fundCur.rows[0].fr_close) : null;
  const fundHistArr = fundHist.rows.map(r => parseFloat(r.fr_close));
  const fundPct = fund != null ? percentile(fundHistArr, fund) : null;

  // L/S Top Account + Global Account percentiles
  const lsTopAccHist = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_top_account
     WHERE pair=$1 AND exchange='Binance' AND ts < $2 ORDER BY ts DESC LIMIT $3`, [PAIR, entryTs, HIST_BARS]
  );
  const lsTopAccCur = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_top_account
     WHERE pair=$1 AND exchange='Binance' AND ts < $2 ORDER BY ts DESC LIMIT 1`, [PAIR, entryTs]
  );
  const lsTopAccR = lsTopAccCur.rows[0] ? parseFloat(lsTopAccCur.rows[0].ratio) : null;
  const lsTopAccArr = lsTopAccHist.rows.map(r => parseFloat(r.ratio));
  const lsTopAccPct = lsTopAccR != null ? percentile(lsTopAccArr, lsTopAccR) : null;

  const lsGlobalHist = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_global_account
     WHERE pair=$1 AND exchange='Binance' AND ts < $2 ORDER BY ts DESC LIMIT $3`, [PAIR, entryTs, HIST_BARS]
  );
  const lsGlobalCur = await query<{ ratio: string }>(
    `SELECT ratio::text FROM cg_ls_global_account
     WHERE pair=$1 AND exchange='Binance' AND ts < $2 ORDER BY ts DESC LIMIT 1`, [PAIR, entryTs]
  );
  const lsGlobalR = lsGlobalCur.rows[0] ? parseFloat(lsGlobalCur.rows[0].ratio) : null;
  const lsGlobalArr = lsGlobalHist.rows.map(r => parseFloat(r.ratio));
  const lsGlobalPct = lsGlobalR != null ? percentile(lsGlobalArr, lsGlobalR) : null;

  // OI 24h % change
  const oiNow = await query<{ oi_close: string }>(
    `SELECT oi_close::text FROM cg_oi_aggregated
     WHERE symbol=$1 AND ts < $2 ORDER BY ts DESC LIMIT 1`, [COIN, entryTs]
  );
  const oi24Ago = await query<{ oi_close: string }>(
    `SELECT oi_close::text FROM cg_oi_aggregated
     WHERE symbol=$1 AND ts < $2 ORDER BY ts DESC LIMIT 1`, [COIN, entryTs - MS_24H]
  );
  const oiNowV = oiNow.rows[0] ? parseFloat(oiNow.rows[0].oi_close) : null;
  const oi24V = oi24Ago.rows[0] ? parseFloat(oi24Ago.rows[0].oi_close) : null;
  const oiPctChg24h = oiNowV != null && oi24V != null && oi24V > 0 ? (oiNowV - oi24V) / oi24V * 100 : null;

  return {
    cb_premium_rate: cbRate,
    cb_premium_pct: cbPct,
    etf_flow_5d_usd: Math.round(etfSum),
    etf_flow_5d_sign: etfSign,
    agg_taker_delta_pct: aggTakerDeltaPct != null ? +aggTakerDeltaPct.toFixed(4) : null,
    agg_taker_delta_24h_pct: aggTakerDelta24hPct != null ? +aggTakerDelta24hPct.toFixed(4) : null,
    agg_liq_squeeze_24h: liqSqueeze24h != null ? +liqSqueeze24h.toFixed(3) : null,
    agg_liq_total_24h_usd: Math.round(liqTotal24h),
    ob_imbalance: obImbalance != null ? +obImbalance.toFixed(4) : null,
    funding_oi: fund,
    funding_oi_pct: fundPct,
    ls_top_account_ratio: lsTopAccR,
    ls_top_account_pct: lsTopAccPct,
    ls_global_account_ratio: lsGlobalR,
    ls_global_account_pct: lsGlobalPct,
    oi_pct_chg_24h: oiPctChg24h != null ? +oiPctChg24h.toFixed(2) : null,
  };
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades.json', 'utf8'));
  console.log(`enriching ${raw.trades.length} BTC trades…`);

  const enriched: any[] = [];
  for (let i = 0; i < raw.trades.length; i++) {
    const t = raw.trades[i];
    const f = await enrichOne(t.entryTs);
    enriched.push({ ...t, features: f });
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${raw.trades.length}`);
  }

  const out = { meta: raw.meta, metrics: raw.metrics, trades: enriched };
  writeFileSync('/tmp/btc-trades-enriched.json', JSON.stringify(out, null, 2));
  console.log(`wrote /tmp/btc-trades-enriched.json (${enriched.length} trades)`);

  // Coverage report — how many trades have non-null for each feature
  const fkeys = Object.keys(enriched[0].features);
  console.log('\n=== FEATURE COVERAGE ===');
  for (const k of fkeys) {
    const nonNull = enriched.filter(t => t.features[k] != null).length;
    console.log(`  ${k.padEnd(28)} ${nonNull}/${enriched.length}`);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
