import { cgGet } from '../lib/coinglass';
import { query } from '../lib/db';
import { log } from '../lib/logger';

// Hobbyist plan: strict 30 req/min. Pace 2.2s between calls (≈27 req/min) for safety.
const PACE_MS = 2200;

// Coinglass interval string for 4h
const TF = '4h';
// 4h × 540 = 90 days
const HISTORY_LIMIT = 540;

// Pair to use for per-exchange Coinglass series. We use Binance because
// it has the deepest data and is consistently available.
const REF_EXCHANGE = 'Binance';

const SYMBOLS_COIN = ['BTC', 'ETH', 'SOL', 'BNB', 'OP', 'NEAR', 'AVAX', 'SUI', 'XLM', 'TAO'];
const PAIRS = [
  { symbol: 'BTC',  pair: 'BTCUSDT'  },
  { symbol: 'ETH',  pair: 'ETHUSDT'  },
  { symbol: 'SOL',  pair: 'SOLUSDT'  },
  { symbol: 'BNB',  pair: 'BNBUSDT'  },
  { symbol: 'OP',   pair: 'OPUSDT'   },
  { symbol: 'NEAR', pair: 'NEARUSDT' },
  { symbol: 'AVAX', pair: 'AVAXUSDT' },
  { symbol: 'SUI',  pair: 'SUIUSDT'  },
  { symbol: 'XLM',  pair: 'XLMUSDT'  },
  { symbol: 'TAO',  pair: 'TAOUSDT'  },
];

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function bulkInsert(
  table: string,
  cols: string[],
  rows: any[][]
): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vals: string[] = [];
    const params: any[] = [];
    slice.forEach((row, idx) => {
      const base = idx * cols.length;
      vals.push('(' + cols.map((_, k) => `$${base + k + 1}`).join(', ') + ')');
      params.push(...row);
    });
    const sql = `INSERT INTO ${table} (${cols.join(', ')})
                 VALUES ${vals.join(', ')}
                 ON CONFLICT DO NOTHING`;
    const r = await query(sql, params);
    inserted += r.rowCount;
  }
  return inserted;
}

async function backfillOiAggregated() {
  for (const sym of SYMBOLS_COIN) {
    const r = await cgGet<any[]>('/futures/open-interest/aggregated-history', {
      symbol: sym, interval: TF, limit: HISTORY_LIMIT,
    });
    const rows = (r.data ?? []).map((d: any) => [
      sym, d.time, d.open, d.high, d.low, d.close,
    ]);
    const n = await bulkInsert('cg_oi_aggregated',
      ['symbol', 'ts', 'oi_open', 'oi_high', 'oi_low', 'oi_close'], rows);
    log.info('cg oi-aggregated backfilled', { symbol: sym, fetched: rows.length, inserted: n });
    await delay(PACE_MS);
  }
}

async function backfillFundingWeighted() {
  for (const sym of SYMBOLS_COIN) {
    const oiR = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', {
      symbol: sym, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_funding_oi_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (oiR.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]));
    log.info('cg funding-oi-weight backfilled', { symbol: sym, n: (oiR.data ?? []).length });
    await delay(PACE_MS);

    const volR = await cgGet<any[]>('/futures/funding-rate/vol-weight-history', {
      symbol: sym, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_funding_vol_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (volR.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]));
    log.info('cg funding-vol-weight backfilled', { symbol: sym, n: (volR.data ?? []).length });
    await delay(PACE_MS);
  }
}

async function backfillLongShort() {
  for (const { pair } of PAIRS) {
    // global account-based
    const ga = await cgGet<any[]>('/futures/global-long-short-account-ratio/history', {
      exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_ls_global_account',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (ga.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.global_account_long_percent, d.global_account_short_percent,
        d.global_account_long_short_ratio,
      ]));
    log.info('cg ls-global-account backfilled', { pair, n: (ga.data ?? []).length });
    await delay(PACE_MS);

    // top trader account
    const ta = await cgGet<any[]>('/futures/top-long-short-account-ratio/history', {
      exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_ls_top_account',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (ta.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.top_account_long_percent, d.top_account_short_percent,
        d.top_account_long_short_ratio,
      ]));
    log.info('cg ls-top-account backfilled', { pair, n: (ta.data ?? []).length });
    await delay(PACE_MS);

    // top trader position
    const tp = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', {
      exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_ls_top_position',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (tp.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.top_position_long_percent, d.top_position_short_percent,
        d.top_position_long_short_ratio,
      ]));
    log.info('cg ls-top-position backfilled', { pair, n: (tp.data ?? []).length });
    await delay(PACE_MS);
  }
}

async function backfillTaker() {
  for (const { pair } of PAIRS) {
    const r = await cgGet<any[]>('/futures/taker-buy-sell-volume/history', {
      exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_taker_pair',
      ['exchange', 'pair', 'ts', 'buy_usd', 'sell_usd'],
      (r.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.taker_buy_volume_usd, d.taker_sell_volume_usd,
      ]));
    log.info('cg taker backfilled', { pair, n: (r.data ?? []).length });
    await delay(PACE_MS);
  }
}

async function backfillLiqPair() {
  for (const { pair } of PAIRS) {
    const r = await cgGet<any[]>('/futures/liquidation/history', {
      exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_liq_pair',
      ['exchange', 'pair', 'ts', 'long_liq_usd', 'short_liq_usd'],
      (r.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.long_liquidation_usd, d.short_liquidation_usd,
      ]));
    log.info('cg liq-pair backfilled', { pair, n: (r.data ?? []).length });
    await delay(PACE_MS);
  }
}

async function snapshotLiquidations() {
  // Real-time coin list snapshot
  const coinList = await cgGet<any[]>('/futures/liquidation/coin-list', {});
  const ts = Date.now();
  const onlyTracked = (coinList.data ?? []).filter((d: any) =>
    SYMBOLS_COIN.includes(d.symbol)
  );
  await bulkInsert('cg_liq_coin_snapshot',
    ['ts', 'symbol',
     'liq_24h', 'long_liq_24h', 'short_liq_24h',
     'liq_12h', 'long_liq_12h', 'short_liq_12h',
     'liq_4h', 'long_liq_4h', 'short_liq_4h',
     'liq_1h', 'long_liq_1h', 'short_liq_1h'],
    onlyTracked.map((d: any) => [
      ts, d.symbol,
      d.liquidation_usd_24h ?? null, d.long_liquidation_usd_24h ?? null, d.short_liquidation_usd_24h ?? null,
      d.liquidation_usd_12h ?? null, d.long_liquidation_usd_12h ?? null, d.short_liquidation_usd_12h ?? null,
      d.liquidation_usd_4h ?? null, d.long_liquidation_usd_4h ?? null, d.short_liquidation_usd_4h ?? null,
      d.liquidation_usd_1h ?? null, d.long_liquidation_usd_1h ?? null, d.short_liquidation_usd_1h ?? null,
    ]));
  log.info('cg liq-coin-snapshot captured', { tracked: onlyTracked.length });
  await delay(PACE_MS);

  // Per-exchange snapshot — Hobbyist allows 4h+ ranges only
  for (const range of ['4h', '12h', '24h']) {
    const exList = await cgGet<any[]>('/futures/liquidation/exchange-list', { range });
    await bulkInsert('cg_liq_exchange_snapshot',
      ['ts', 'range_label', 'exchange', 'liq_usd', 'long_liq_usd', 'short_liq_usd'],
      (exList.data ?? []).map((d: any) => [
        ts, range, d.exchange,
        d.liquidation_usd, d.longLiquidation_usd, d.shortLiquidation_usd,
      ]));
    log.info('cg liq-exchange-snapshot captured', { range, n: (exList.data ?? []).length });
    await delay(PACE_MS);
  }
}

export async function runCgBackfill(): Promise<void> {
  const start = Date.now();
  log.info('=== coinglass backfill start (90d, 4h granularity) ===');
  await backfillOiAggregated();
  await backfillFundingWeighted();
  await backfillLongShort();
  await backfillTaker();
  await backfillLiqPair();
  await snapshotLiquidations();

  // Print summary stats
  const tables = [
    'cg_oi_aggregated',
    'cg_funding_oi_weighted',
    'cg_funding_vol_weighted',
    'cg_ls_global_account',
    'cg_ls_top_account',
    'cg_ls_top_position',
    'cg_taker_pair',
    'cg_liq_pair',
    'cg_liq_coin_snapshot',
    'cg_liq_exchange_snapshot',
  ];
  for (const t of tables) {
    const r = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${t}`);
    log.info('table count', { table: t, count: r.rows[0].c });
  }
  log.info('=== coinglass backfill done ===', { elapsed_ms: Date.now() - start });
}

export async function runCgIncremental(): Promise<void> {
  // For history endpoints, simply re-fetch most recent N=5 bars (covers latest 4h close)
  // and rely on ON CONFLICT DO NOTHING. For snapshot endpoints, capture fresh.
  log.info('=== coinglass incremental start ===');
  const SMALL = 5;

  for (const sym of SYMBOLS_COIN) {
    const r = await cgGet<any[]>('/futures/open-interest/aggregated-history',
      { symbol: sym, interval: TF, limit: SMALL });
    await bulkInsert('cg_oi_aggregated',
      ['symbol', 'ts', 'oi_open', 'oi_high', 'oi_low', 'oi_close'],
      (r.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]));
    await delay(PACE_MS);

    const f1 = await cgGet<any[]>('/futures/funding-rate/oi-weight-history',
      { symbol: sym, interval: TF, limit: SMALL });
    await bulkInsert('cg_funding_oi_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (f1.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]));
    await delay(PACE_MS);

    const f2 = await cgGet<any[]>('/futures/funding-rate/vol-weight-history',
      { symbol: sym, interval: TF, limit: SMALL });
    await bulkInsert('cg_funding_vol_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (f2.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]));
    await delay(PACE_MS);
  }

  for (const { pair } of PAIRS) {
    const ga = await cgGet<any[]>('/futures/global-long-short-account-ratio/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_ls_global_account',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (ga.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.global_account_long_percent, d.global_account_short_percent, d.global_account_long_short_ratio,
      ]));
    await delay(PACE_MS);

    const ta = await cgGet<any[]>('/futures/top-long-short-account-ratio/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_ls_top_account',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (ta.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.top_account_long_percent, d.top_account_short_percent, d.top_account_long_short_ratio,
      ]));
    await delay(PACE_MS);

    const tp = await cgGet<any[]>('/futures/top-long-short-position-ratio/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_ls_top_position',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (tp.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.top_position_long_percent, d.top_position_short_percent, d.top_position_long_short_ratio,
      ]));
    await delay(PACE_MS);

    const tk = await cgGet<any[]>('/futures/taker-buy-sell-volume/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_taker_pair',
      ['exchange', 'pair', 'ts', 'buy_usd', 'sell_usd'],
      (tk.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time, d.taker_buy_volume_usd, d.taker_sell_volume_usd,
      ]));
    await delay(PACE_MS);

    const lq = await cgGet<any[]>('/futures/liquidation/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_liq_pair',
      ['exchange', 'pair', 'ts', 'long_liq_usd', 'short_liq_usd'],
      (lq.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time, d.long_liquidation_usd, d.short_liquidation_usd,
      ]));
    await delay(PACE_MS);
  }

  await snapshotLiquidations();
  log.info('=== coinglass incremental done ===');
}
