# Coinglass API — Project Reference

**Single source of truth** for what Coinglass offers, what our Standard-plan key can reach,
what the live cron ingests, and what we have already tested for tradeable edge — so we stop
re-probing the API and re-testing dead signals.

All facts below were verified against source (`file:line`) and by live calls to the API / live
DB on **2026-06-09** (Postgres `trading` @ `localhost:5433`). Where a row is carried over from a
prior probe without re-hitting, it is marked *(prior)*.

---

## Table of Contents

1. [Quick facts](#1-quick-facts)
2. [What we ingest LIVE](#2-what-we-ingest-live)
   - 2.1 [Ingestion inventory](#21-ingestion-inventory)
   - 2.2 [Computed `CoinglassFeatures` fields](#22-computed-coinglassfeatures-fields)
3. [Full endpoint access map](#3-full-endpoint-access-map)
4. [Research verdicts — what's been tested and the result](#4-research-verdicts)
5. [Quirks & gotchas](#5-quirks--gotchas)
6. [Gaps / not yet verified + how to extend ingestion](#6-gaps--not-yet-verified--how-to-extend-ingestion)

---

## 1. Quick facts

| Aspect | Value | Source |
|---|---|---|
| Base URL | `https://open-api-v4.coinglass.com/api` | `src/core/coinglass.ts:3` |
| Client | `cgGet<T>(path, params)` — returns `{ code, msg, data }`; throws on CG error code or non-JSON | `src/core/coinglass.ts:20-44` |
| Auth | header `CG-API-KEY`, value from env `COINGLASS_API_KEY` (process exits if missing) | `src/core/coinglass.ts:5-12`, `:29` |
| Plan | **Standard, 300 req/min** (live pacing ~270 req/min) | `src/data/coinglass-backfill.ts:5-9` |
| Success codes | `'0'`, `0`, `'00000'`; anything else throws `coinglass <path> error code=… msg=…` | `src/core/coinglass.ts:40-42` |
| Retry/backoff | `withCgRetry()` wraps `cgGet` via `CoinglassRetryPolicy` (3 attempts, base 1500ms, linear `baseDelay*(attempt+1)`). **Retryable only when error msg matches `/rate\|limit\|429\|busy/i`** — HTTP/transport errors are NOT retried | `src/core/coinglass.ts:46-53`; `src/core/retry-policy.ts:33-51`, `:60-65` |
| Inter-call pacing | `PACE_MS = 220` in backfill/incremental; `300ms` in the probe | `src/data/coinglass-backfill.ts:9`; `src/tools/diagnostics/cg-tier-probe.ts:18` |

**How to call** (verified pattern, `src/tools/diagnostics/cg-tier-probe.ts:15`, `:136`):

```ts
import { cgGet } from '../../core/coinglass';
const r = await cgGet<any[]>('/futures/open-interest/aggregated-history',
                             { symbol: 'BTC', interval: '4h', limit: 2160 });
// r.code === '0', r.data is the array. Throws on CG error code or non-JSON.
```

### History caps — two distinct limits (empirically probed 2026-06-09)

1. **Per-request `limit` ceiling = 4500.** `limit=5000` → `code=400 msg=limit must be greater than 0 and less than or equal to 4500`. The code's `HISTORY_LIMIT = 2160` (`coinglass-backfill.ts:15`) is *below* this ceiling — chosen to match the 4h availability window, not a hard cap.
2. **Per-interval data availability (real history depth on this plan), probed with `limit=4500`:**
   - `interval=4h` → **2160 rows = ~360 days**
   - `interval=1h` → **4500 rows = ~187.5 days**
   - `interval=5m` → **4500 rows = ~15.6 days** (confirms `migrations/009_cg_5m.sql:1` "15-day coverage")

> Live DB shows up to **2291** rows/symbol on 4h tables (> 2160): that is accumulation (the 360d
> backfill plus ongoing 4h incremental bars), not a higher API cap.

---

## 2. What we ingest LIVE

The live cron path is `scripts/cycle.sh:103` → `src/data/cli/cg-incremental.ts` →
`runCgIncremental()` (`coinglass-backfill.ts:279`). Initial seed is `runCgBackfill()` (`:247`,
manual, via `src/data/cli/coinglass-backfill-run.ts` / `cg-backfill.ts`). All history endpoints use
interval `4h` (`TF`, `:12`), exchange `Binance` (`REF_EXCHANGE`, `:19`). Incremental re-fetches only
the latest 5 bars (`SMALL = 5`, `:283`) and relies on `ON CONFLICT DO NOTHING` (`:70`).

**Universe:** `SYMBOLS_COIN` = 17 coins (`coinglass-backfill.ts:26`): BTC, ETH, SOL, XRP, BNB, LTC,
ATOM, DOGE, TON, APT, ARB, INJ, TAO, HYPE, ZEC, LINK, ADA. `PAIRS` = the same 17 as `<COIN>USDT`
(`:27-45`). (DB also holds legacy coins AVAX/NEAR/OP/SUI/XLM/DOT from earlier universes — no longer
in the live arrays, so frozen.)

### 2.1 Ingestion inventory

| CG endpoint path | `cg_` table | Gran. | Keyed by | History depth (live DB) | Backfill / Incremental |
|---|---|---|---|---|---|
| `/futures/open-interest/aggregated-history` | `cg_oi_aggregated` (OHLC) | 4h | symbol | 17 coins, ~360–382d (2291 rows max) | both (`:79`, `:286`) |
| `/futures/funding-rate/oi-weight-history` | `cg_funding_oi_weighted` (OHLC) | 4h | symbol | 17 coins, ~382d | both (`:94`, `:293`) |
| `/futures/funding-rate/vol-weight-history` | `cg_funding_vol_weighted` (OHLC) | 4h | symbol | 17 coins, ~382d | backfill (`:103`) + incremental (`:300`) |
| `/futures/global-long-short-account-ratio/history` | `cg_ls_global_account` | 4h | exchange+pair | 17 pairs (Binance) | both (`:117`, `:309`) |
| `/futures/top-long-short-account-ratio/history` | `cg_ls_top_account` | 4h | exchange+pair | 17 pairs (Binance) | both (`:131`, `:319`) |
| `/futures/top-long-short-position-ratio/history` | `cg_ls_top_position` | 4h | exchange+pair | 17 pairs (Binance) | both (`:145`, `:329`) |
| `/futures/taker-buy-sell-volume/history` | `cg_taker_pair` (buy/sell USD) | 4h | exchange+pair | 17 pairs (Binance) | both (`:162`, `:339`) |
| `/futures/liquidation/history` | `cg_liq_pair` (long/short liq USD) | 4h | exchange+pair | 17 pairs (Binance) | both (`:178`, `:348`) |
| `/futures/orderbook/ask-bids-history` (`range=5`, ±5%) | `cg_orderbook_pair` (bids/asks USD+qty) | 4h | exchange+pair | **17 pairs** (LINK/ADA + 15) | **backfill only** (`:196`) — NOT in incremental |
| `/futures/liquidation/coin-list` (real-time) | `cg_liq_coin_snapshot` (24h/12h/4h/1h) | snapshot/cycle | ts+symbol | 957 snapshots | both via `snapshotLiquidations()` (`:212`, called `:256`, `:358`) |
| `/futures/liquidation/exchange-list` (`range`∈4h/12h/24h) | `cg_liq_exchange_snapshot` | snapshot/cycle | ts+range+exchange | 937 snapshots | both via `snapshotLiquidations()` (`:235`) |

**Schemas:** `migrations/002_coinglass.sql` (8 history/snapshot tables + `cg_heatmap_snapshot`),
`migrations/007_cg_orderbook.sql` (`cg_orderbook_pair`), `migrations/004_cg_liq_nullable.sql` (drops
NOT NULL on exchange-snapshot liq cols — a real outage fix). PKs are `(symbol, ts)` for coin tables,
`(exchange, pair, ts)` for pair tables.

**Two ingestion gaps worth flagging (verified):**

- `cg_orderbook_pair` is written by `runCgBackfill` but is **absent from `runCgIncremental`** — so
  orderbook depth goes stale unless backfill is re-run. (`cg_funding_vol_weighted` IS in incremental
  at `:300`, no staleness there.)
- **Tables defined in migrations but NOT written by the live cron** (grep of `src/` confirms no
  live-path writer; populated only by one-off research/diagnostic CLIs):
  `cg_cb_premium` (2160 rows, by `cbp-*`/`cg-etf-premium-probe`), `cg_btc_etf_flow` (606 rows, by
  `etf-flow-*`), `cg_agg_taker_coin` / `cg_agg_liq_coin` (2160 rows each), the five `*_5m` tables
  (`migrations/009`, ~63k rows each, median gap **300000ms = 5min confirmed**, span 15.6d), and
  `cg_heatmap_snapshot` (0 rows, unused). These are **research data, not part of the live ingestion
  contract.**

### 2.2 Computed `CoinglassFeatures` fields

Interface at `src/data/coinglass-features.ts:6-25`, populated by `loadCoinglassAt(coin, pair, atTs)`
(`:40`). Every query enforces `ts <= atTs` (no look-ahead) and reads `exchange = 'Binance'` for pair
tables. `MS_24H = 24*3600_000` (`:38`).

Scalar fields (latest value ≤ `atTs` unless noted):

| Field | Type | Source / computation | line |
|---|---|---|---|
| `oi_close` | number\|null | latest `cg_oi_aggregated.oi_close` | `:41`, `:116` |
| `oi_delta_24h` | number\|null | `oi_close − oi_close(atTs−24h)` | `:46-53`, `:117` |
| `oi_pct_chg_24h` | number\|null | `oiDelta / oi24Close × 100` (when oi24>0) | `:54`, `:118` |
| `funding_oi_weighted` | number\|null | latest `cg_funding_oi_weighted.fr_close` | `:56`, `:119` |
| `funding_vol_weighted` | number\|null | latest `cg_funding_vol_weighted.fr_close` | `:60`, `:120` |
| `ls_global_account` | number\|null | latest `cg_ls_global_account.ratio` | `:64`, `:121` |
| `ls_top_account` | number\|null | latest `cg_ls_top_account.ratio` | `:68`, `:122` |
| `ls_top_position` | number\|null | latest `cg_ls_top_position.ratio` | `:72`, `:123` |
| `liq_long_24h_usd` | number\|null | Σ `long_liq_usd` over `cg_liq_pair`, (atTs−24h, atTs]; null if 0 | `:76-83`, `:124` |
| `liq_short_24h_usd` | number\|null | Σ `short_liq_usd`, same window | `:82`, `:125` |
| `taker_buy_24h_usd` | number\|null | Σ `buy_usd` over `cg_taker_pair`, 24h window | `:84-91`, `:126` |
| `taker_sell_24h_usd` | number\|null | Σ `sell_usd`, same window | `:91`, `:127` |
| `taker_delta_24h_usd` | number\|null | `takerBuy − takerSell` (when buy+sell>0) | `:128` |

History arrays — last **200** 4H points ≤ `atTs` (`HIST_LIMIT = 200`, `:95`), fetched DESC then
`.reverse()` to ascending; strategies use a 180-bar (30d) window for percentile:

| Field | Source column | line |
|---|---|---|
| `ls_top_position_history: number[]` | `cg_ls_top_position.ratio` | `:96-101`, `:130` |
| `ls_top_account_history: number[]` | `cg_ls_top_account.ratio` | `:102-107`, `:131` |
| `funding_oi_weighted_history: number[]` | `cg_funding_oi_weighted.fr_close` | `:108-113`, `:132` |

`EMPTY_CG_FEATURES` (`:27-36`) supplies the all-null / empty-array default when CG has no data at `atTs`.

---

## 3. Full endpoint access map

**Probe basis.** Verified empirically on 2026-06-09 against `https://open-api-v4.coinglass.com/api`
with the live Standard-plan key via `cgGet`. New probes written for this map:
- `src/tools/diagnostics/cg-catalog-probe.ts` — 114 endpoints across all families (out: `/tmp/cg-catalog.out`).
- `src/tools/diagnostics/cg-catalog-probe2.ts` — alt-path retries for high-value 404s (out: `/tmp/cg-catalog2.out`).
- `src/tools/diagnostics/cg-catalog-probe3.ts` — `/index/bitcoin-*` cycle-index family sweep (out: `/tmp/cg-catalog3.out`).

Carried-over verified status (not re-hit): `src/tools/diagnostics/cg-tier-probe.ts`,
`cg-large-ob-probe.ts` (`/tmp/cg-largeob.out`); ingest paths confirmed in `src/data/coinglass-backfill.ts`.

### Legend
- **ACCESSIBLE** — returned `code=0` with data on the Standard key.
- **TIER-LOCKED** — `code=401 "Upgrade plan"` (key valid, plan insufficient).
- **NEEDS-PATH-CHECK** — `code=404 Endpoint not found` after 1–2 slug attempts; may exist under another slug or not at all. NOT a permission verdict.
- **BAD-PARAMS** — `code=400` (path valid + key accepted; just needs the named required param). Effectively ACCESSIBLE once the param is supplied.
- History span = first..last timestamp at the requested limit; intraday OHLC-style endpoints were probed at `limit=5` so their "~1d" span is the sample window, NOT max depth. Index/ETF series show true max depth (no limit cap).

### Trading-Market
| Endpoint | Real path | Access | Shape (first-row keys) | History |
|---|---|---|---|---|
| supported-coins | `/futures/supported-coins` | ACCESSIBLE | array of 1246 coin symbols (strings) | snapshot |
| supported-exchange-pairs | `/futures/supported-exchange-pairs` | ACCESSIBLE | object keyed by 30 exchanges → pair arrays | snapshot |
| pairs-markets | `/futures/pairs-markets` | ACCESSIBLE | `instrument_id, exchange_name, symbol, current_price, index_price, price_change_percent_24h, volume_usd, long/short_volume_usd, open_interest_usd, funding_rate, next_funding_time, open_interest_volume_radio…` (97 rows) | snapshot |
| coins-markets | `/futures/coins-markets` | ACCESSIBLE | wide per-coin: `symbol, current_price, avg_funding_rate_by_oi/vol, market_cap_usd, open_interest_usd, oi_vol_ratio, price_change_percent_{5m..24h}, long_short_ratio_{5m..24h}, liquidation_usd_{1h..24h}…` (100 rows) | snapshot |
| price-ohlc | `/futures/price/history` | ACCESSIBLE | `time, open, high, low, close, volume_usd` | intraday OHLC (needs `exchange, symbol, interval`) |
| delisted | `/futures/delisted-pair`, `/futures/delisted-pairs` | NEEDS-PATH-CHECK | both 404 | — |
| exchange-rank | `/futures/exchange-rank` | ACCESSIBLE | `exchange, open_interest_usd, volume_usd, liquidation_usd_24h` (24 rows) | snapshot |

### Open Interest
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| oi-history (per-pair) | `/futures/open-interest/history` | ACCESSIBLE | `time, open, high, low, close` | OHLC (`exchange,symbol,interval`) |
| oi-aggregated (coin) | `/futures/open-interest/aggregated-history` | ACCESSIBLE *(ingested)* | `symbol, ts, oi_open/high/low/close` | 4h, ~360d ingested |
| oi-agg-stablecoin-margin | `/futures/open-interest/aggregated-stablecoin-margin-history` | NEEDS-PATH-CHECK | 404 | — |
| oi-agg-coin-margin | `/futures/open-interest/aggregated-coin-margin-history` | BAD-PARAMS | needs `exchange_list` (path valid) | likely OHLC |
| oi-exchange-history-chart | `/futures/open-interest/exchange-history-chart` | ACCESSIBLE *(prior)* | per-exchange OI series (`range`=1m/15m/1h/4h/12h/all) | chart |
| oi-exchange-list | `/futures/open-interest/exchange-list` | ACCESSIBLE | `exchange, symbol, open_interest_usd, …_by_coin_margin, …_by_stable_coin_margin, open_interest_change_percent_{5m..24h}` (25 rows) | snapshot |

### Funding
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| funding-history | `/futures/funding-rate/history` | ACCESSIBLE *(ingested)* | OHLC funding | 4h ingested |
| funding oi-weight | `/futures/funding-rate/oi-weight-history` | ACCESSIBLE *(ingested)* | `symbol, ts, fr_open/high/low/close` | 4h ingested |
| funding vol-weight | `/futures/funding-rate/vol-weight-history` | ACCESSIBLE *(ingested)* | same | 4h ingested |
| funding exchange-list | `/futures/funding-rate/exchange-list` | ACCESSIBLE | `symbol, stablecoin_margin_list, token_margin_list` (1244 rows) | snapshot |
| funding cumulative | `/futures/funding-rate/accumulated-exchange-list` | ACCESSIBLE | same shape as exchange-list (1246 rows) | snapshot (`range`) |
| funding arbitrage | `/futures/funding-rate/arbitrage` | ACCESSIBLE | `symbol, buy, sell, apr, funding, fee, spread, next_funding_time` (469 rows) | snapshot (`usd`) |

### Long/Short ratio
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| global-account-ratio | `/futures/global-long-short-account-ratio/history` | ACCESSIBLE *(ingested)* | account-ratio series | 4h ingested |
| top-account-ratio | `/futures/top-long-short-account-ratio/history` | ACCESSIBLE *(ingested)* | top-trader account ratio | 4h ingested |
| top-position-ratio | `/futures/top-long-short-position-ratio/history` | ACCESSIBLE *(ingested)* | top-trader position ratio | 4h ingested |
| taker exchange-ratio | `/futures/taker-buy-sell-volume/exchange-list` | ACCESSIBLE | `symbol, buy_ratio, sell_ratio, buy_vol_usd, sell_vol_usd, exchange_list` (24 rows) | snapshot (`range`) |

### Liquidation
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| pair-history | `/futures/liquidation/history` | ACCESSIBLE *(ingested)* | per-pair long/short liq | 4h ingested |
| aggregated-history | `/futures/liquidation/aggregated-history` | BAD-PARAMS *(prior)* | needs `exchange_list` (path valid) | 4h |
| coin-list | `/futures/liquidation/coin-list` | ACCESSIBLE *(ingested)* | per-coin liq snapshot | snapshot |
| exchange-list | `/futures/liquidation/exchange-list` | ACCESSIBLE *(ingested)* | per-exchange liq (`range` 4h/12h/24h) | snapshot |
| coin-history | `/futures/liquidation/aggregated-coin-history`, `/coin-history` | NEEDS-PATH-CHECK | both 404 | — |
| order | `/futures/liquidation/order` | ACCESSIBLE | returns `[]` (0 rows for BTCUSDT at probe time) | live stream |
| map | `/futures/liquidation/map` | **TIER-LOCKED** | `code=401 Upgrade plan` | — |
| aggregated-map | `/futures/liquidation/aggregated-map` | **TIER-LOCKED** | `code=401 Upgrade plan` | — |
| heatmap model1/agg | `/futures/liquidation/heatmap/model1`, `/aggregated-heatmap/model1` | **TIER-LOCKED** *(prior)* | — | — |

### Order Book
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| pair bid/ask (±range%) | `/futures/orderbook/ask-bids-history` | ACCESSIBLE *(ingested)* | `bids_usd, bids_quantity, asks_usd, asks_quantity, time` | 4h, ~360d ingested (`cg_orderbook_pair`, 38k rows, 2025-05-23→) |
| coin agg bid/ask | `/futures/orderbook/aggregated-ask-bids-history` | ACCESSIBLE | `aggregated_bids_usd/quantity, aggregated_asks_usd/quantity, time` | 4h |
| full-depth snapshot | `/futures/orderbook/history` | ACCESSIBLE | tuple `[ts, [[price,qty]…]]` (full ladder) | 4h snapshots |
| large-limit-order (live) | `/futures/orderbook/large-limit-order` | ACCESSIBLE *(prior)* | `id, exchange_name, symbol, limit_price, start_time, start_quantity, start_usd_value, current_quantity/usd_value, executed_volume/usd_value, trade_count, order_side, order_state` (265 rows) | live snapshot |
| large-limit-order-history | `/futures/orderbook/large-limit-order-history` | ACCESSIBLE *(prior)* | same + `order_end_time` | event history |
| heatmap | `/futures/orderbook/heatmap` | NEEDS-PATH-CHECK | 404 | — |
| spot large-orderbook | `/spot/large-orderbook` | NEEDS-PATH-CHECK | 404 | — |

### Hyperliquid
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| whale-position | `/hyperliquid/whale-position` | ACCESSIBLE | `user, symbol, position_size, entry_price, mark_price, liq_price, leverage, margin_balance, position_value_usd, unrealized_pnl, funding_fee, margin_mode, create_time, update_time` (863 rows) | ~23d rolling |
| whale-alert | `/hyperliquid/whale-alert` | ACCESSIBLE | `user, symbol, position_size, entry_price, liq_price, position_value_usd, position_action, create_time` (50 rows) | recent event stream |
| positions / balance / funding-rate/history / open-interest/history / trader / leaderboard / vault | `/hyperliquid/{positions,balance,funding-rate/history,open-interest/history,trader,leaderboard,vault}` | NEEDS-PATH-CHECK | all 404 (only the 2 whale endpoints resolve) | — |

### Taker buy/sell & flows
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| taker pair | `/futures/taker-buy-sell-volume/history` | ACCESSIBLE *(ingested)* | `time, taker_buy_volume_usd, taker_sell_volume_usd` | 4h ingested |
| taker coin (agg) | `/futures/aggregated-taker-buy-sell-volume/history` | ACCESSIBLE | `time, aggregated_buy_volume_usd, aggregated_sell_volume_usd` (needs `exchange_list`) | 4h |
| CVD (pair) | `/futures/cvd/history` | ACCESSIBLE | `time, taker_buy_vol, taker_sell_vol, cum_vol_delta` | 4h |
| agg CVD | `/futures/aggregated-cvd/history` | ACCESSIBLE | `time, agg_taker_buy_vol, agg_taker_sell_vol, cum_vol_delta` (needs `exchange_list`) | 4h |
| footprint | `/futures/taker-buy-sell-volume/footprint` | NEEDS-PATH-CHECK | 404 | — |
| netflow-list / coin-netflow | `/futures/netflow/exchange-list`, `/futures/netflow/history`, `/futures/taker-buy-sell-volume/netflow` | NEEDS-PATH-CHECK | all 404 | — |
| volume-exchange-history | `/futures/taker-buy-sell-volume/exchange-history` | NEEDS-PATH-CHECK | 404 | — |

### Spot
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| supported-coins | `/spot/supported-coins` | ACCESSIBLE | array of 2330 symbols | snapshot |
| price-ohlc | `/spot/price/history` | ACCESSIBLE | `time, open, high, low, close, volume_usd` | OHLC |
| market-data | `/spot/pairs-markets` | ACCESSIBLE | per-pair `current_price, price_change_*, volume_usd_*, buy/sell_volume_usd_*, net_flows_usd_{1h..1w}` (18 rows) | snapshot |
| orderbook | `/spot/orderbook/ask-bids-history` | ACCESSIBLE | `bids_usd, bids_quantity, asks_usd, asks_quantity, time` | 4h |
| taker | `/spot/taker-buy-sell-volume/history` | ACCESSIBLE | `time, taker_buy_volume_usd, taker_sell_volume_usd` | 4h |
| CVD (agg) | `/spot/aggregated-cvd/history` | ACCESSIBLE | `time, agg_taker_buy_vol, agg_taker_sell_vol, cum_vol_delta` | 4h |
| netflow | `/spot/netflow/exchange-list`, `/spot/netflow/history` | NEEDS-PATH-CHECK | both 404 | — |

### Options
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| exchange-oi-history | `/option/exchange-oi-history` | BAD-PARAMS | needs `range` (path valid) | series |
| exchange-vol-history | `/option/exchange-vol-history` | ACCESSIBLE | `time_list, price_list, data_map` (column arrays, 2162 pts) | long history |
| max-pain | `/option/max-pain` | ACCESSIBLE *(prior)* | per-strike max-pain (needs `symbol,exchange`) | snapshot |
| info | `/option/info` | ACCESSIBLE *(prior)* | per-exchange option OI/vol info | snapshot |

### On-Chain
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| exchange-assets | `/exchange/assets` | ACCESSIBLE | `wallet_address, balance, balance_usd, symbol, assets_name, price` (20 rows) | snapshot |
| balance-list | `/exchange/balance/list` | ACCESSIBLE | `exchange_name, total_balance, balance_change_{1d,7d,30d}, …_percent_*` (21 rows) | snapshot |
| balance-chart | `/exchange/balance/chart` | ACCESSIBLE *(used in code)* | balance time series | history |
| onchain-transfers | `/exchange/chain/tx/list` | ACCESSIBLE | returns `[]` (0 rows for BTC at probe time) | live tx stream |
| ERC20-transfers | `/exchange/onchain/transfers`, `/exchange/chain/erc20/transfer` | NEEDS-PATH-CHECK | 404 | — |
| whale-transfer | `/exchange/chain/whale-transfer`, `/exchange/whale-transfer` | NEEDS-PATH-CHECK | both 404 | — |
| coin-unlock-list | `/coin/unlock-list` | ACCESSIBLE | `symbol, name, price, market_cap, max/total_supply, total_locked/unlocked, circulating_supply, next_unlock_date, next_unlock_usd/tokens, next_unlock_of_circulating/supply` (paginated) | forward schedule |
| token-vesting | `/coin/vesting` | ACCESSIBLE | `market_cap, symbol, listing_date, vesting_start/end_date, total_supply/locked/unlocked, next_unlock, allocations[], chart[]` (per `symbol`) | full vesting curve |

### ETF
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| BTC list | `/etf/bitcoin/list` | ACCESSIBLE | `ticker, fund_name, region, market_status, aum_usd, list_date, shares_outstanding, management_fee_percent, price_usd, volume_usd…` (20 funds) | snapshot |
| BTC HK-flow | `/hk-etf/bitcoin/flow-history` | ACCESSIBLE | `timestamp, flow_usd, price_usd, etf_flows` | 2024-04-30→ (~769 daily pts) |
| BTC net-assets | `/etf/bitcoin/net-assets/history` | ACCESSIBLE | `net_assets_usd, change_usd, timestamp, price_usd` | 2024-01-11→ (~603 pts) |
| BTC flows | `/etf/bitcoin/flow-history` | ACCESSIBLE *(ingested via near-path)* | `timestamp, flow_usd, price_usd, etf_flows` | 2024-01-11→ (~621 pts) |
| BTC history | `/etf/bitcoin/history` | BAD-PARAMS | needs `ticker` (path valid) | per-ticker series |
| BTC price | `/etf/bitcoin/price/history` | BAD-PARAMS | needs `range` (path valid) | per-ticker OHLC |
| BTC detail | `/etf/bitcoin/detail` | ACCESSIBLE | `ticker_info, market_status, name, ticker, type, session, last_quote, last_trade, performance` (per `ticker`) | snapshot |
| BTC AUM | `/etf/bitcoin/aum` | ACCESSIBLE *(ingested)* | `time, aum_usd` | 2024-01-02→ (~877 pts) |
| ETH list | `/etf/ethereum/list` | ACCESSIBLE | same shape as BTC list (12 funds) | snapshot |
| ETH flow | `/etf/ethereum/flow-history` | ACCESSIBLE | `timestamp, flow_usd, price_usd, etf_flows` | 2024-07-23→ (~483 pts) |
| ETH net-assets | `/etf/ethereum/net-assets/history` | ACCESSIBLE | `net_assets_usd, change_usd, timestamp, price_usd` | 2024-07-23→ (~483 pts) |
| Grayscale holdings | `/grayscale/holdings-list` | ACCESSIBLE | `symbol, primary/secondary_market_price, premium_rate, holdings_amount/usd, …change_{1d,7d,30d}, close_time, update_time` (10 rows) | snapshot |
| Grayscale premium | `/grayscale/premium-history` | ACCESSIBLE *(ingested)* | column arrays `primary_market_price, secondary_market_price_list, time_list, premium_rate_list` | ~2523 daily pts |
| SOL flow | `/etf/solana/flow-history` | ACCESSIBLE | `timestamp, flow_usd, price_usd, etf_flows` | 2026-05-21→ (~13 pts, new product) |
| XRP flow | `/etf/xrp/flow-history` | ACCESSIBLE | same | 2025-11-14→ (~142 pts) |
| HYPE flow | `/etf/hyperliquid/flow-history` | NEEDS-PATH-CHECK | 404 (no HYPE ETF product) | — |
| BTC premium/discount | `/etf/bitcoin/premium-discount/history` | ACCESSIBLE *(used in code)* | premium series | history |
| ETF premium edge / AUM | (see `cg-etf-premium-*` diagnostics) | ACCESSIBLE *(prior)* | — | — |

### Indicators — Futures-derived
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| RSI list | `/futures/rsi/list` | ACCESSIBLE | per-coin `rsi_{15m,1h,4h,12h,24h,1w}, price_change_percent_*, current_price` (607 coins) | snapshot |
| MA / MA-list | `/futures/ma/history`, `/futures/ma-list`, `/futures/indicator/ma/history` | NEEDS-PATH-CHECK | all 404 | — |
| EMA / EMA-list | `/futures/ema-list`, `/futures/ema/history` | NEEDS-PATH-CHECK | 404 | — |
| BOLL | `/futures/bollinger-band/history`, `/futures/boll/history` | NEEDS-PATH-CHECK | 404 | — |
| MACD / MACD-list | `/futures/macd-list`, `/futures/macd/history` | NEEDS-PATH-CHECK | 404 | — |
| ATR / ATR-list | `/futures/atr-list`, `/futures/atr/history` | NEEDS-PATH-CHECK | 404 | — |
| TD / TD-list | `/futures/td-sequential-list`, `/futures/td/history` | NEEDS-PATH-CHECK | 404 | — |
| whale-index | `/futures/whale-index/history` | ACCESSIBLE | `time, whale_index_value` (needs `exchange, symbol`) | series |
| CGDI | `/futures/cgdi-index/history` | ACCESSIBLE *(ingested)* | `time, cgdi_index_value` | 2024-01-01→ (~891 daily pts) |
| CDRI | `/futures/cdri-index/history` | ACCESSIBLE | `time, cdri_index_value` | 2022-03-05→ (~1558 daily pts) |

> The RSI screener resolves only as a *list* snapshot. The per-symbol MA/EMA/BOLL/MACD/ATR/TD
> *history* endpoints all 404 across every slug tried — either not exposed on v4 or use a slug not
> inferable from the doc href. Marked NEEDS-PATH-CHECK, not no-access.

### Indicators — On-chain / cycle (BTC)
Working family slug is `/index/bitcoin-<name>` (NOT bare `/index/<name>`). All daily series, mostly
2010→present (~5,800 pts), free on the Standard key.

| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| ahr999 | `/index/ahr999` | ACCESSIBLE | `date_string, average_price, ahr999_value, current_value` | ~5607 pts |
| bull-market-peak | `/bull-market-peak-indicator` | ACCESSIBLE | `indicator_name, current_value, target_value, previous_value, change_value, comparison_type, hit_status` (30 indicators) | snapshot |
| puell-multiple | `/index/puell-multiple` | ACCESSIBLE | `timestamp, price, puell_multiple` | 2010-08-17→ (~5774) |
| stock-flow (S2F) | `/index/stock-flow` | ACCESSIBLE | `timestamp, price, next_halving` | 2010→2028 (~6469) |
| pi-cycle | `/index/pi-cycle-indicator` | ACCESSIBLE | `ma_110, ma_350_mu_2, price, timestamp` | 2010-07-13→ (~5810) |
| golden-ratio | `/index/golden-ratio-multiplier` | ACCESSIBLE | `ma_350, low_bull_high_2, accumulation_high_1_6, x_3/5/8/13/21, price, timestamp` | ~5810 |
| altcoin-season | `/index/altcoin-season` | ACCESSIBLE | `timestamp, altcoin_index` | 2017-04-03→ (~3337) |
| STH-SOPR | `/index/bitcoin-sth-sopr` | ACCESSIBLE | `timestamp, price, sth_sopr` | ~5810 |
| LTH-SOPR | `/index/bitcoin-lth-sopr` | ACCESSIBLE | `timestamp, price, lth_sopr` | ~5808 |
| STH realized price | `/index/bitcoin-sth-realized-price` | ACCESSIBLE | `timestamp, price, sth_realized_price` | ~5774 |
| LTH realized price | `/index/bitcoin-lth-realized-price` | ACCESSIBLE | `timestamp, price, lth_realized_price` | ~5774 |
| RHODL ratio | `/index/bitcoin-rhodl-ratio` | ACCESSIBLE | `price, rhodl_ratio, timestamp` | ~5774 |
| reserve-risk | `/index/bitcoin-reserve-risk` | ACCESSIBLE | `price, reserve_risk_index, movcd, hodl_bank, vocd, timestamp` | ~5774 |
| active addresses | `/index/bitcoin-active-addresses` | ACCESSIBLE | `timestamp, price, active_address_count` | ~5775 |
| new addresses | `/index/bitcoin-new-addresses` | ACCESSIBLE | `timestamp, price, new_address_count` | ~5774 |
| NUPL | `/index/bitcoin-net-unrealized-profit-loss` | ACCESSIBLE | `price, net_unpnl, timestamp` | ~6366 |
| STH supply | `/index/bitcoin-short-term-holder-supply` | ACCESSIBLE | `price, short_term_holder_supply, timestamp` | ~5408 |
| BTC correlations | `/index/bitcoin-correlation` | ACCESSIBLE | `timestamp, price, gld, iwm, qqq, spy, tlt` | ~5746 |
| BMO (macro osc.) | `/index/bitcoin-macro-oscillator` | ACCESSIBLE | `price, bmo_value, timestamp` | 2012-01-09→ (~5265) |
| opt-vs-fut OI ratio | `/index/option-vs-futures-oi-ratio` | ACCESSIBLE | `btc_option_vs_futures_radio, eth_option_vs_futures_radio, timestamp` | 2020-06-24→ (~2170) |
| BTC vs global M2 | `/index/bitcoin-vs-global-m2-growth` | ACCESSIBLE | `timestamp, price, global_m2_yoy_growth, global_m2_supply` | 2013-05-20→ (~667) |
| BTC vs US M2 | `/index/bitcoin-vs-us-m2-growth` | ACCESSIBLE | `timestamp, price, us_m2_yoy_growth, us_m2_supply` | 2010-07-13→ (~5771) |
| stablecoin marketcap | `/index/stableCoin-marketCap-history` | ACCESSIBLE | column arrays keyed by stablecoin (`USDT`, …) | ~4117 daily |
| fear-greed | `/index/fear-greed-history` | ACCESSIBLE *(prior)* | fear/greed series | history |
| bitcoin-dominance | `/index/bitcoin-dominance` | ACCESSIBLE *(prior)* | dominance series | history |

> **Still NEEDS-PATH-CHECK** (404 on all attempted slugs): profitable-days, rainbow-chart,
> bubble-index, 2yr-ma-multiplier, 200w-ma-heatmap, realized-price (base, vs STH/LTH which DO
> resolve), realized-cap, futures-spot-volume-ratio, exchanges-transparency.

### Calendar / News
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| economic-data | `/calendar/economic-data` | ACCESSIBLE | `calendar_name, country_code/name, data_effect, forecast_value, previous_value, publish_timestamp, published_value, importance_level, has_exact_publish_time` (766 rows) | calendar |
| article-list (news) | `/article/list` | ACCESSIBLE | `article_title, article_content, source_name, article_release_time, article_description` (20 rows) | recent feed |

### Account
| Endpoint | Real path | Access | Shape | History |
|---|---|---|---|---|
| account / tier query | `/user/account-subscription`, `/account/subscription`, `/account/subscription-info`, `/user/info`, `/api-usage` | NEEDS-PATH-CHECK | all 404 — **no tier-query endpoint is exposed on v4 under any slug tried.** Tier confirmed indirectly: only `liq-map`/`agg-map`/`heatmap` return `code=401 "Upgrade plan"`; everything else is `code=0`, consistent with Standard. | — |

### Summary counts (this audit)
- **ACCESSIBLE: ~74 distinct endpoints** (63 from catalog-probe + whale-index + 10 from the `/index/bitcoin-*` retries + large-limit-order family + carried-over ingested/prior-verified).
- **TIER-LOCKED: liquidation `map`, `aggregated-map`, `heatmap/model1` + `aggregated-heatmap/model1`** (all `code=401 Upgrade plan`) — the liquidation heatmap/map cluster is the only confirmed paid wall.
- **BAD-PARAMS (path valid, ACCESSIBLE once param supplied): 5** — `oi-aggregated-coin-margin-history` (needs `exchange_list`), `option/exchange-oi-history` (needs `range`), `etf/bitcoin/history` (needs `ticker`), `etf/bitcoin/price/history` (needs `range`), plus agg taker/cvd which need `exchange_list`.
- **NEEDS-PATH-CHECK (404, slug unresolved):** per-symbol indicator histories (MA/EMA/BOLL/MACD/ATR/TD), most Hyperliquid sub-endpoints (only the 2 whale ones resolve), futures/spot netflow, taker footprint, ERC20/whale on-chain transfers, several BTC cycle indices (rainbow/bubble/2yr-ma/200w-ma/profitable-days/realized-price-base/realized-cap/exchanges-transparency/fut-spot-vol-ratio), delisted-pairs, orderbook heatmap, and any account-tier endpoint. These returned plain `Endpoint not found` — not permission failures, may exist under a slug not inferable from the doc href.

**Key practical takeaways for ingestion:** the entire BTC on-chain cycle-index family (SOPR, NUPL,
realized prices, reserve-risk, addresses, RHODL, correlations, M2 overlays) is free and deep
(2010→now). ETF flows for BTC/ETH/SOL/XRP + Grayscale premium are free with multi-year daily depth.
Hyperliquid whale positioning is free but only ~23d rolling. The only hard paywall hit is the
liquidation heatmap/map cluster.

---

## 4. Research verdicts

Every CG signal/family the project has tested for tradeable edge, with the empirical verdict.

**Verdict legend:** *live* = in the production book; *robust* = passed two-sided WF both halves;
*marginal* = orthogonal/real-IC but regime-concentrated or sub-gate, not deployed; *noise* = IC ~0
or sign-flips IS↔OOS; *dead-price-proxy* = the "signal" is just lagged/coincident price (momentum
repackaged); *regime-fragile* = works one window/half, reverses in another; *data-insufficient* = no
usable history on our tier; *tier-locked* = endpoint requires a plan upgrade.

**Verified live (2026-06-09):** production book in `src/runtime/pair-strategies.ts:56-85` is **4
pairs, single-entry, mixed risk** — BTC `lsTopPositionFade .85/.15` @1.25%, SOL `fundingFade .70/.30`
@0.875%, ADA `fundingFade .75/.25` @0.875%, LINK `fundingTaConfluence .70/.30` @0.6%. We ingest **9
CG families** (`src/data/coinglass-backfill.ts`): aggregated OI, funding OI-weight, funding
vol-weight, global L/S account, top L/S account, top L/S position, taker buy/sell, liquidation
history, orderbook ±5%. Tier-probe re-run live confirms only the **liquidation heatmap/map** family
is tier-locked (HTTP 401 "Upgrade plan"); all other catalog endpoints return 200.

### IN LIVE USE (the validated core)

| CG signal / family | Archetype tested | Verdict | One-line why | Memory pointer |
|---|---|---|---|---|
| Top L/S **position** ratio (BTC) | fade .85/.15 + BTC-trend + wide 2.0×ATR stop | **live / robust** | BTC's stable signal (funding flips on it); two-sided, WF both halves PF 1.47/1.90 | `project_standalone_pairs_2026_06_03`, `project_btc_eth_signal_edge_2026_06_03` |
| **Funding** (OI/vol-weighted) (SOL) | fade .70/.30 + trend + wide stop | **live / robust** | strongest standalone, two-sided (long +$26.5k / short +$30.8k/yr), PF 1.58/1.78 | `project_standalone_pairs_2026_06_03` |
| **Funding** (ADA) | fade .75/.25 tight stop | **live / robust (watch-pair)** | two-sided but short-tilted; weakest OOS, flat in reverse WF — kept on probation | `project_standalone_pairs_2026_06_03` |
| **Funding + Top L/S Account confluence** (LINK, S4) | fade .70/.30 | **live / robust** | only ROBUST of 14 screened; same S4 config picked on both WF halves; de-risks book + fixes flatten-concentration | `project_link_addition_flatten_2026_06_04` |

### MARGINAL — orthogonal but not deployed (real-ish IC, regime-concentrated / sub-gate / not ingested)

| CG signal / family | Archetype tested | Verdict | One-line why | Memory pointer |
|---|---|---|---|---|
| Aggregated **CVD** (cross-exch taker buy/sell, BTC) | confluence **filter** — drop a fade when 24h order-flow strongly opposes it | **marginal** | best lead of the combo search: passed every signal-level robustness check, BTC-only, removes 15-22% (losers) — but signal-level OVERSTATES; engine validation pending; **not ingested** | `project_combo_round1_2026_06_09` |
| Exchange **BTC reserves** (`/exchange/balance/chart`) | FOLLOW — falling 7d reserves → BTC up | **marginal / regime-fragile** | IC IS +0.079 / OOS +0.272 (3.4× → concentrated), momentum- & funding-orthogonal, quintile tail-driven, 7d horizon = slow | `project_cg_full_catalog_sweep_2026_06_09` |
| **ETF premium/discount** (`/etf/.../premium-discount`) | FOLLOW — high premium-to-NAV → BTC up, 3-7d | **marginal / regime-fragile** | IC IS +0.09 / OOS +0.21, orthogonal (passes the test ETF-FLOWS failed), but tails-only, first ~9mo near-zero, US-trading-day cadence + ~3wk-stale API | `project_cg_full_catalog_sweep_2026_06_09` |
| **Spot taker imbalance** (SOL, 24h) | FOLLOW | **marginal** | same order-flow flavour as the CVD filter; IS IC under the 0.05 bar, non-monotone quintiles | `project_cg_full_catalog_sweep_2026_06_09`, `project_cg_new_archetype_sweep_2026_06_09` |
| **Futures basis** (ADA, Binance-only 360d) | basis-level fade @48h | **marginal / regime-fragile** | only ADA basis-fade survives all sub-periods (1/5 pairs); ADA is the weakest pair; other pairs decay/IS-concentrated | `project_cg_full_catalog_sweep_2026_06_09` |
| **BTC dominance LEVEL** → BTC-vs-alt relative, ~9d | cross-sectional spread (high dom → BTC underperforms alts) | **marginal-signal / NOT-tradeable** | statistically REAL (survives overlap/survivorship/sign attacks, IC −0.237 t=−2.18) but REJECTED on the trade: 4-leg costs flatten it, 69% of edge in 3 un-capturable episodes, and **Hyro-infeasible** (worst day −6.67% > −5%, MaxDD −24/−27%) | `project_dominance_spread_rejected`, `project_cg_new_archetype_sweep_2026_06_09` |

### DEAD / NOISE (do NOT re-test)

| CG signal / family | Archetype tested | Verdict | One-line why | Memory pointer |
|---|---|---|---|---|
| **ETF spot flows** (BTC/ETH/SOL) | follow / regime | **dead-price-proxy** | net flow is near-COINCIDENT price proxy (flow[T] IC +0.38 same session → +0.06 at first tradable T+1, ~0.01 after); corr w/ trailing-3d ret +0.49-0.55 | `project_cg_new_archetype_sweep_2026_06_09`, `project_cg_data_expansion_candidates` |
| **Coinbase Premium Index** | follow / regime | **dead-price-proxy / SKIP** | rate-level LAGS price (corr w/ PAST ret +0.25 >> FWD +0.10), detrended next-bar IC ~0; BTC-only mechanism, alts have no Coinbase liquidity | `project_cg_new_archetype_sweep_2026_06_09`, `project_strategy_research_2026_06_03` |
| **OI×price 4-quadrant** regime | regime/cascade @24-48h | **noise** | ~0.2-0.3% relative (at/below cost), IC~0, flips at 24h — orthogonal axis but no real edge | `project_cg_new_archetype_sweep_2026_06_09` |
| **ETH** funding / ls_top_position (any) | fade, both halves | **noise / regime-fragile** | sign FLIPS IS↔OOS (funding +0.025→−0.103); TA scan all \|IC\|<0.06; packaged S3 finalist unmasks as flipping one-sided windows → regime gamble | `project_btc_eth_signal_edge_2026_06_03` |
| **BTC funding-fade** (the stronger-IC signal) | fade, standalone | **noise / IC≠tradeable** | strongest raw IC (−0.171 OOS) but a two-sided LOSER even at instant timing (recent −6.83R, older −6.42R faithful) | `project_btc_pattern_real_but_marginal` |
| **Taker-delta extreme** confluence (v5) | confluence gate (0.20/0.30/0.40) | **dead** | rejects the strategy's own moderate-taker edge zone; 6 trades vs baseline 184, −10.72pp | `feedback_cg_gates_overfit` (#8) |
| **Liquidation-cascade** confluence (v5) | confluence gate (0.50/0.70/0.85) | **dead / regime-fragile** | 8-11 trades over 3 windows, W3 broke to WR 0% — small-sample fake edge | `feedback_cg_gates_overfit` (#9) |
| **Orderbook imbalance** (±5% bid/ask) | entry gate | **dead** | train avgR 0.44 → OOS shorts in bid-dom collapsed to 0.02; rolled back | `feedback_cg_gates_overfit` (#3) |
| **Conviction scoring** (L/S+funding+ETF, 0-3) | multi-signal gate | **dead** | non-monotonic (score1 worse than 0), OOS contradicts train, 4H-CG vs 4-24h-trade horizon mismatch | `feedback_cg_gates_overfit` (#4) |
| **BTC S4/S5 confluence** (funding × L/S) | confluence strategy | **dead** | all edge comes from the embedded trend filter, not the alignment — confluence is a placebo; collapses recent half −1.2..−15.9R | `feedback_cg_gates_overfit` (#5,#6), `project_btc_eth_signal_edge_2026_06_03` |
| **OI-direction confirmation** on funding fade | gate | **dead** | coin-flip at funding extremes (50.5/49.5) → ~zero conditional info | `project_strategy_research_2026_06_03` (#4) |
| **ADX / trend-strength** gate | gate | **dead** | filter removes best trades; fade edge lives in moves that look trending | `project_strategy_research_2026_06_03` (#5) |
| Whole exhaustive-catalog tail (Net L/S USD, OI-by-margin-type, OI-by-exchange + dOI, funding arb/dispersion, options/futures OI ratio, fut/spot vol ratio, CG proprietary indices Whale/CGDI/CDRI, Bitfinex margin L/S + borrow, large limit orders / depth imbalance, Altcoin-Season, BTC-equity corr, BTC-vs-M2, stablecoin-margin-OI-share, OI/marketcap) | follow/regime/cascade/order-flow/pinning/macro IC both halves + thirds | **noise** | 10 families, IC ~0 or sign-unstable; catalog effectively exhausted | `project_cg_full_catalog_sweep_2026_06_09` |
| **Dominance as a conditioning GATE** (salvage attempt) | both-halves gate | **dead** | fails every adversarial test (random-count p=0.123, block-bootstrap p=0.829, Welch t=1.90); slow monthly macro proxy = time-slice selection | `project_combo_round1_2026_06_09` (B) |
| **Equal-weight ensemble** (funding ⟂ liqImbDir ⟂ cvdDelta) | composite | **noise / dilution** | beats best single component in 0/4 pairs; funding_oi dominates, blending DILUTES | `project_combo_round1_2026_06_09` (E) |
| **Per-pair signal-swap** | swap each pair's signal | **noise / regime-fragile** | no swap survives both halves; signal-level forward-return OVERSTATES because it can't see SL/TP/hold packaging collapse | `project_combo_round1_2026_06_09` (D) |

### NOT-BACKTESTABLE (no usable history on our tier)

| CG signal / family | Status | Verdict | One-line why | Memory pointer |
|---|---|---|---|---|
| **Liquidation heatmap / map** (`/liquidation/heatmap`, `/aggregated-heatmap`, `/map`) | **tier-locked** | tier-locked | HTTP 401 "Upgrade plan" — verified live in tier-probe (only locked family) | `project_cg_data_expansion_candidates`, tier-probe |
| **Options max-pain / pinning** | snapshot only | **data-insufficient** | endpoint is a current snapshot, no history; would need months of standing ingest before any pinning test | `project_cg_new_archetype_sweep_2026_06_09`, `project_cg_data_expansion_candidates` |
| **Hyperliquid whale positions / alert** | snapshot only (860 / 50 live rows) | **data-insufficient (forward-only)** | accessible but no history → can only accumulate live, can't backtest | `project_cg_data_expansion_candidates` |
| **Token unlocks / vesting, whale-transfer / on-chain TX** | empty / 404 on Standard | **data-insufficient** | no usable history on tier (chain-tx returns 0 rows; whale-to-exchange untestable) | `project_cg_full_catalog_sweep_2026_06_09` |

### Recurring lessons (the meta-pattern across every verdict)

1. **Signal-level IC overstates tradeable edge** — forward-return rank-IC ignores
   SL/TP/maxHold/cap/cooldown/fees. The per-pair signal-swap and BTC S4/S5 confluence both looked
   good at IC level then **collapsed once packaged** through the engine. IC is necessary, not
   sufficient. (`project_combo_round1_2026_06_09`, `feedback_cg_gates_overfit`)
2. **IC ≠ tradeable edge** — BTC funding has a real, OOS-strengthening fade IC (−0.171) yet is a
   two-sided money-loser; dominance has a real adversarially-robust IC (−0.237, t=−2.18) yet is
   untradeable on costs + episode-concentration + Hyro DD. "Edge in the signal, not in the trade."
   (`project_btc_pattern_real_but_marginal`, `project_dominance_spread_rejected`)
3. **The price-proxy trap** — ETF spot flows and Coinbase premium "predict" returns only because net
   flow / premium-level is lagged or coincident price. The discriminating test is whether the
   **detrended / momentum-residual** IC survives (ETF premium passes, ETF flows + Coinbase premium
   fail). (`project_cg_new_archetype_sweep_2026_06_09`)
4. **Regime concentration** — every catalog survivor (reserves, ETF premium, dominance, ETH, LTC
   OOS) earns its edge in a few windows and reverses elsewhere; two-sided long/short balance + same
   config picked on **both** WF halves is the robustness discriminator that separates a real edge
   (BTC/SOL/LINK) from a directional regime bet (XRP/BNB/ETH).
   (`project_standalone_pairs_2026_06_03`, `project_cg_full_catalog_sweep_2026_06_09`)
5. **Ensemble dilution** — blending orthogonal signals (funding ⟂ liqImb ⟂ CVD) beat the best single
   component in 0/4 pairs; funding dominates and the weak/flipping legs drag the composite.
   Single-signal beats the blend. (`project_combo_round1_2026_06_09`)
6. **Hyro-infeasible structures** — a statistically real, orthogonal, sign-stable signal can still
   be undeployable because the trade structure breaks prop-firm rules: the dominance spread's worst
   single day (−6.67%) alone exceeds the −5% daily-DD death line, MaxDD −24/−27% > the −10% total
   line, and the cap-4 book has no slot/heat headroom. Prop-firm DD rules + 4-leg costs are the real
   gates, not the IC. (`project_dominance_spread_rejected`)
7. **Data-integrity discipline** — the old VP-SMC CG gates flipped behaviour retroactively after a
   full backfill (sparse-data permissive → firing throughout), and the gates were dropping the
   BETTER trades (avgR +0.294 blocked vs +0.257 passed). Evaluate gates on the CURRENT data state,
   and prove BLOCKED trades are materially worse before believing any gate. (`feedback_cg_gates_artifact`)

---

## 5. Quirks & gotchas

Collected across all three audits — read before writing any new probe or ingest path.

| Quirk | Detail |
|---|---|
| **Column-array vs row-array shapes** | Most history endpoints return an array of row objects. But several return **parallel column arrays** (one array per field, index-aligned): `option/exchange-vol-history` (`time_list, price_list, data_map`), `grayscale/premium-history` (`time_list, premium_rate_list, …`), `index/stableCoin-marketCap-history` (keyed by stablecoin). You must zip them, not iterate rows. |
| **ms-vs-seconds timestamps** | Ingested 4h history (`*_history`) is **ms** epoch; verified 5m-table median gap = `300000ms`. Some index/ETF series carry `timestamp` in ms too — but always inspect: the field is sometimes `time`, sometimes `timestamp`, sometimes `date_string`. No single canonical ts key across families. |
| **Binance-only ingest** | All pair-keyed `cg_` tables store `exchange = 'Binance'` only (`REF_EXCHANGE`, `coinglass-backfill.ts:19`); `loadCoinglassAt` reads `exchange='Binance'`. Other exchanges are reachable via API but NOT ingested. Do not assume a pair table has cross-exchange data. |
| **`symbol` = COIN vs PAIR** | Coin-level endpoints (OI-aggregated, funding-weight) take a bare COIN (`BTC`, `SOL`). Pair-level endpoints (L/S ratios, taker, liq-history, orderbook) take `symbol=<COIN>USDT` **plus** an `exchange`. `loadCoinglassAt(coin, pair, atTs)` carries both for this reason. |
| **`exchange` param required** | L/S ratios, taker, liquidation-history, orderbook, price-OHLC, whale-index all require an `exchange` arg or return 400/empty. Coin-aggregated OI/funding do not. |
| **2160-row / 360d cap on 4h** | History depth is interval-bound: 4h tops out at ~2160 rows = 360d. Don't expect >1y of 4h. 1h = ~187d, 5m = ~15.6d. Per-request `limit` ceiling is 4500 (5000 → 400). |
| **Weekend / staleness on daily ETF & premium** | ETF flow / premium-discount / net-assets series follow **US trading-day cadence** — no weekend points, and the premium-discount API runs ~3 weeks stale. Any feature off these must tolerate gaps + lag. |
| **Snapshot-only families (no history)** | `pairs-markets`, `coins-markets`, `*/exchange-list`, `funding/arbitrage`, `rsi/list`, options `max-pain`/`info`, Hyperliquid `whale-*`, on-chain `assets`/`balance/list`, coin `unlock-list`/`vesting`, ETF `list`/`detail`, calendar/news — all CURRENT snapshots. To backtest anything off them you must accumulate live first. |
| **`liquidation/order` & `chain/tx/list` return `[]`** | Accessible but returned empty at probe time (BTC params) — they are live/event streams, not historical. Empty ≠ no-access. |
| **Orderbook incremental gap** | `cg_orderbook_pair` is backfill-only — `runCgIncremental` never refreshes it. Orderbook depth is stale between manual backfills. |
| **Liquidation snapshot NOT-NULL fix** | `migrations/004_cg_liq_nullable.sql` drops NOT NULL on exchange-snapshot liq cols — CG occasionally returns null liq values during outages; a strict schema would reject the whole cycle. |
| **Retry is narrow** | `withCgRetry` only retries when the error message matches `/rate\|limit\|429\|busy/i`. A transient TCP/HTTP/non-JSON failure is **not** retried — it throws straight through. |
| **No tier-query endpoint** | v4 exposes no account/subscription/usage endpoint under any slug tried. Tier is inferred only from the `401 "Upgrade plan"` pattern on the liquidation heatmap/map cluster. |
| **Index family slug** | BTC cycle indices live under `/index/bitcoin-<name>` (e.g. `/index/bitcoin-sth-sopr`), NOT bare `/index/<name>`. A few (ahr999, puell-multiple, pi-cycle, golden-ratio, altcoin-season) are bare `/index/<name>`. Check both forms before declaring 404. |

---

## 6. Gaps / not yet verified + how to extend ingestion

### Not yet verified (NEEDS-PATH-CHECK — 404 on slugs tried, may exist under another slug)
- Per-symbol indicator **histories**: MA / EMA / BOLL / MACD / ATR / TD (only RSI resolves, and only as a list snapshot).
- Most **Hyperliquid** sub-endpoints (only `whale-position` + `whale-alert` resolve).
- **Netflow** (futures + spot), taker **footprint**, ERC20 / whale **on-chain transfers**.
- Several **BTC cycle indices**: rainbow-chart, bubble-index, 2yr-ma-multiplier, 200w-ma-heatmap, profitable-days, realized-price (base), realized-cap, futures-spot-volume-ratio, exchanges-transparency.
- `delisted-pairs`, orderbook `heatmap`, any account-tier endpoint.

### Known data gaps in the live pipeline (verified)
- **`cg_orderbook_pair`** — backfill-only, goes stale (re-run `runCgBackfill` to refresh, or add it to `runCgIncremental`).
- **Migration tables NOT written by the live cron** (research-only, populated by one-off diagnostics): `cg_cb_premium`, `cg_btc_etf_flow`, `cg_agg_taker_coin`, `cg_agg_liq_coin`, the five `*_5m` tables (`migrations/009`), `cg_heatmap_snapshot` (0 rows, unused). These are not part of the live ingestion contract.

### How to extend ingestion
The canonical pattern lives in **`src/data/coinglass-backfill.ts`**. To add a new CG family:
1. Add the coin/pair to `SYMBOLS_COIN` / `PAIRS` (`:26-45`) if not already present.
2. Write a fetch+upsert helper modeled on the existing per-table functions (e.g. the OI block at `:79`, funding at `:94`) — `cgGet(path, { symbol, interval: '4h', limit: HISTORY_LIMIT })`, then upsert with `ON CONFLICT DO NOTHING`.
3. Wire it into **both** `runCgBackfill()` (`:247`) and `runCgIncremental()` (`:279`, fetch only `SMALL = 5` latest bars) — do NOT repeat the orderbook mistake of adding to backfill only.
4. Add the table schema as a new `migrations/0NN_*.sql`. PK convention: `(symbol, ts)` for coin tables, `(exchange, pair, ts)` for pair tables.
5. If a strategy needs it, surface it in `CoinglassFeatures` (`src/data/coinglass-features.ts:6-25`) and populate it in `loadCoinglassAt` with the mandatory `ts <= atTs` look-ahead guard.
6. Respect pacing: keep `PACE_MS = 220` between calls (Standard plan = 300 req/min).

**Before deploying any new signal:** validate on the cap-aware live mirror (not isolated
`portfolio-live.ts`) — every "marginal" in §4 looked better at signal-IC level than it did once
packaged through the engine. See recurring lessons #1 and #2.
