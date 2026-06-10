import { cgGet } from '../core/coinglass';
import { query } from '../core/db';
import { log } from '../core/logger';

// Standard plan: 300 req/min. Pace 220ms between calls (≈270 req/min) for safety.
// Upgraded from Hobbyist (30 req/min, 2200ms pace) on 2026-05-18 — operator wanted
// to unlock HYPE/ARB/INJ/TAO CG coverage and probe new endpoints (large orderbook,
// hyperliquid whale positions, etc.).
const PACE_MS = 220;

// Coinglass interval string for 4h
const TF = '4h';
// 4h × 2160 = 360 days (the plan's max history; probed 2026-06-03). Was 540 (90d) —
// raised to pull full backtest-grade history for newly-added coins (LINK/ADA).
const HISTORY_LIMIT = 2160;

// Pair to use for per-exchange Coinglass series. We use Binance because
// it has the deepest data and is consistently available.
const REF_EXCHANGE = 'Binance';

// v3 universe (post 2026-05-18, Standard plan): 14 pairs incl. HYPE.
// Standard plan removes the 10-symbol cap of Hobbyist — full universe now covered.
// 2026-06-03: added LINK + ADA for standalone-strategy research (operator). Adding here
// also keeps them fresh via the cron incremental. Does NOT add them to the trading
// universe (that's TIER1_PORTFOLIO in pair-strategies.ts) — ingestion only.
const SYMBOLS_COIN = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'LTC', 'ATOM', 'DOGE', 'TON', 'APT', 'ARB', 'INJ', 'TAO', 'HYPE', 'ZEC', 'LINK', 'ADA'];
const PAIRS = [
  { symbol: 'BTC',  pair: 'BTCUSDT'  },
  { symbol: 'ETH',  pair: 'ETHUSDT'  },
  { symbol: 'SOL',  pair: 'SOLUSDT'  },
  { symbol: 'XRP',  pair: 'XRPUSDT'  },
  { symbol: 'BNB',  pair: 'BNBUSDT'  },
  { symbol: 'LTC',  pair: 'LTCUSDT'  },
  { symbol: 'ATOM', pair: 'ATOMUSDT' },
  { symbol: 'DOGE', pair: 'DOGEUSDT' },
  { symbol: 'TON',  pair: 'TONUSDT'  },
  { symbol: 'APT',  pair: 'APTUSDT'  },
  { symbol: 'ARB',  pair: 'ARBUSDT'  },
  { symbol: 'INJ',  pair: 'INJUSDT'  },
  { symbol: 'TAO',  pair: 'TAOUSDT'  },
  { symbol: 'HYPE', pair: 'HYPEUSDT' },
  { symbol: 'ZEC',  pair: 'ZECUSDT'  },
  { symbol: 'LINK', pair: 'LINKUSDT' },
  { symbol: 'ADA',  pair: 'ADAUSDT'  },
];

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// History series MUST upsert (ON CONFLICT DO UPDATE), never DO NOTHING.
// 2026-06-10 discovery (v5 migration audit): DO NOTHING froze every 4H bucket at
// its FIRST insert — the hourly incremental fetches the still-forming bucket
// minutes after open, so the stored value was a bar-open snapshot, never the
// close. Liquidation sums were the worst case: frozen at ~$0 (accumulator just
// reset), which killed the liq-cascade signal and was drifting toward a
// permanent false-fire once the percentile window filled with zeros. Same class
// of bug as the candles ON CONFLICT DO NOTHING look-ahead saga (2026-05-23),
// opposite direction. The Coinglass API is the source of truth: closed buckets
// re-fetch as final values, the open bucket keeps refreshing until the first
// fetch after its close finalizes it.
//
// `conflictKeys` = the table's PK columns. Omit ONLY for append-only snapshot
// tables (cg_liq_coin_snapshot, cg_liq_exchange_snapshot) where ts is capture
// time and rows are immutable by construction.
async function bulkInsert(
  table: string,
  cols: string[],
  rows: any[][],
  conflictKeys?: string[]
): Promise<number> {
  if (rows.length === 0) return 0;
  if (conflictKeys && conflictKeys.length > 0) {
    // ON CONFLICT DO UPDATE throws "cannot affect row a second time" if one INSERT
    // carries duplicate keys (CG API occasionally repeats a timestamp). Keep the LAST
    // occurrence — the freshest value for that bucket.
    const keyIdx = conflictKeys.map((k) => cols.indexOf(k));
    const byKey = new Map<string, any[]>();
    for (const row of rows) byKey.set(keyIdx.map((i) => String(row[i])).join('|'), row);
    rows = Array.from(byKey.values());
  }
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
    let conflictClause = 'ON CONFLICT DO NOTHING';
    if (conflictKeys && conflictKeys.length > 0) {
      const updates = cols
        .filter((c) => !conflictKeys.includes(c))
        .map((c) => `${c} = EXCLUDED.${c}`);
      conflictClause = `ON CONFLICT (${conflictKeys.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
    }
    const sql = `INSERT INTO ${table} (${cols.join(', ')})
                 VALUES ${vals.join(', ')}
                 ${conflictClause}`;
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
      ['symbol', 'ts', 'oi_open', 'oi_high', 'oi_low', 'oi_close'], rows,
      ['symbol', 'ts']);
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
      (oiR.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]),
      ['symbol', 'ts']);
    log.info('cg funding-oi-weight backfilled', { symbol: sym, n: (oiR.data ?? []).length });
    await delay(PACE_MS);

    const volR = await cgGet<any[]>('/futures/funding-rate/vol-weight-history', {
      symbol: sym, interval: TF, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_funding_vol_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (volR.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]),
      ['symbol', 'ts']);
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
      ]),
      ['exchange', 'pair', 'ts']);
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
      ]),
      ['exchange', 'pair', 'ts']);
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
      ]),
      ['exchange', 'pair', 'ts']);
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
      ]),
      ['exchange', 'pair', 'ts']);
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
      ]),
      ['exchange', 'pair', 'ts']);
    log.info('cg liq-pair backfilled', { pair, n: (r.data ?? []).length });
    await delay(PACE_MS);
  }
}

// Orderbook depth (Standard plan): bids/asks within ±5% of market price.
// 4h interval, 360d coverage. Used to compute imbalance ratios for entry-quality research.
async function backfillOrderbook() {
  for (const { pair } of PAIRS) {
    const r = await cgGet<any[]>('/futures/orderbook/ask-bids-history', {
      exchange: REF_EXCHANGE, symbol: pair, interval: TF, range: 5, limit: HISTORY_LIMIT,
    });
    await bulkInsert('cg_orderbook_pair',
      ['exchange', 'pair', 'ts', 'bids_usd', 'asks_usd', 'bids_qty', 'asks_qty'],
      (r.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.bids_usd, d.asks_usd, d.bids_quantity, d.asks_quantity,
      ]),
      ['exchange', 'pair', 'ts']);
    log.info('cg orderbook backfilled', { pair, n: (r.data ?? []).length });
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
  await backfillOrderbook();
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
    'cg_orderbook_pair',
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
  // For history endpoints, re-fetch most recent N=5 bars (covers latest 4h close)
  // and UPSERT — the open bucket keeps refreshing every hour and finalizes on the
  // first fetch after its close (see bulkInsert header). Snapshot endpoints capture fresh.
  log.info('=== coinglass incremental start ===');
  const SMALL = 5;

  for (const sym of SYMBOLS_COIN) {
    const r = await cgGet<any[]>('/futures/open-interest/aggregated-history',
      { symbol: sym, interval: TF, limit: SMALL });
    await bulkInsert('cg_oi_aggregated',
      ['symbol', 'ts', 'oi_open', 'oi_high', 'oi_low', 'oi_close'],
      (r.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]),
      ['symbol', 'ts']);
    await delay(PACE_MS);

    const f1 = await cgGet<any[]>('/futures/funding-rate/oi-weight-history',
      { symbol: sym, interval: TF, limit: SMALL });
    await bulkInsert('cg_funding_oi_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (f1.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]),
      ['symbol', 'ts']);
    await delay(PACE_MS);

    const f2 = await cgGet<any[]>('/futures/funding-rate/vol-weight-history',
      { symbol: sym, interval: TF, limit: SMALL });
    await bulkInsert('cg_funding_vol_weighted',
      ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
      (f2.data ?? []).map((d: any) => [sym, d.time, d.open, d.high, d.low, d.close]),
      ['symbol', 'ts']);
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
      ]),
      ['exchange', 'pair', 'ts']);
    await delay(PACE_MS);

    const ta = await cgGet<any[]>('/futures/top-long-short-account-ratio/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_ls_top_account',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (ta.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.top_account_long_percent, d.top_account_short_percent, d.top_account_long_short_ratio,
      ]),
      ['exchange', 'pair', 'ts']);
    await delay(PACE_MS);

    const tp = await cgGet<any[]>('/futures/top-long-short-position-ratio/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_ls_top_position',
      ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
      (tp.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time,
        d.top_position_long_percent, d.top_position_short_percent, d.top_position_long_short_ratio,
      ]),
      ['exchange', 'pair', 'ts']);
    await delay(PACE_MS);

    const tk = await cgGet<any[]>('/futures/taker-buy-sell-volume/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_taker_pair',
      ['exchange', 'pair', 'ts', 'buy_usd', 'sell_usd'],
      (tk.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time, d.taker_buy_volume_usd, d.taker_sell_volume_usd,
      ]),
      ['exchange', 'pair', 'ts']);
    await delay(PACE_MS);

    const lq = await cgGet<any[]>('/futures/liquidation/history',
      { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: SMALL });
    await bulkInsert('cg_liq_pair',
      ['exchange', 'pair', 'ts', 'long_liq_usd', 'short_liq_usd'],
      (lq.data ?? []).map((d: any) => [
        REF_EXCHANGE, pair, d.time, d.long_liquidation_usd, d.short_liquidation_usd,
      ]),
      ['exchange', 'pair', 'ts']);
    await delay(PACE_MS);
  }

  await snapshotLiquidations();
  log.info('=== coinglass incremental done ===');
}
