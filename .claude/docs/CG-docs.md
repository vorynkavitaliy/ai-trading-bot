# Coinglass API — Tested Endpoints

**Every Coinglass v4 endpoint hit during the 2026-06-09/10 edge-research session**, with its
real path, what our **Standard-plan** key returns, required params, response shape and history
depth. Probed empirically via `cgGet` (`src/core/coinglass.ts`) against
`https://open-api-v4.coinglass.com/api`.

> Companion doc with tier/client/ingest/verdicts/quirks: [`docs/coinglass-api-reference.md`](../../docs/coinglass-api-reference.md).
> Probe tools: `src/tools/diagnostics/cg-tier-probe.ts`, `cg-catalog-probe{,2,3}.ts`, `cg-large-ob-probe.ts`.

## Legend
| Mark | Meaning |
|---|---|
| 🟢 **OK** | `code=0` with data on the Standard key |
| 📥 **INGESTED** | OK **and** pulled by the live cron into a `cg_*` table |
| 🔒 **TIER-LOCKED** | `code=401 "Upgrade plan"` (key valid, plan insufficient) |
| 🟡 **BAD-PARAMS** | `code=400` — path valid + key accepted, just needs the named param (effectively OK) |
| ❔ **404** | `Endpoint not found` after 1–2 slug attempts; may exist under another slug. NOT a permission verdict |
| ∅ **EMPTY** | `code=0` but `[]` at probe time (live/event stream, not historical) |

**Counts:** ~74 OK (9 of them INGESTED) · 4 TIER-LOCKED (liq heatmap/map cluster) · 5 BAD-PARAMS · ~25 NEEDS-PATH-CHECK.
**Only hard paywall:** the liquidation `heatmap` / `map` family.

---

## Futures — Trading Market
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| supported-coins | `/futures/supported-coins` | 🟢 | — | array of 1246 coin symbols |
| supported-exchange-pairs | `/futures/supported-exchange-pairs` | 🟢 | — | object keyed by 30 exchanges → pair arrays |
| pairs-markets | `/futures/pairs-markets` | 🟢 | — | 97 rows: price, oi_usd, funding_rate, vol, next_funding_time… (snapshot) |
| coins-markets | `/futures/coins-markets` | 🟢 | — | 100 rows: price, avg_funding, mcap, oi, ls_ratio_*, liq_usd_* (snapshot) |
| price-ohlc | `/futures/price/history` | 🟢 | exchange, symbol, interval | `time,open,high,low,close,volume_usd` |
| delisted | `/futures/delisted-pair(s)` | ❔ | — | both 404 |
| exchange-rank | `/futures/exchange-rank` | 🟢 | — | 24 rows: exchange, oi_usd, vol_usd, liq_usd_24h |

## Futures — Open Interest
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| OI per-pair | `/futures/open-interest/history` | 🟢 | exchange, symbol, interval | OHLC |
| OI aggregated (coin) | `/futures/open-interest/aggregated-history` | 📥 | symbol, interval | OHLC → `cg_oi_aggregated`, 4h ~360d |
| OI agg stablecoin-margin | `/futures/open-interest/aggregated-stablecoin-margin-history` | ❔ | — | 404 |
| OI agg coin-margin | `/futures/open-interest/aggregated-coin-margin-history` | 🟡 | needs `exchange_list` | OHLC |
| OI exchange-history-chart | `/futures/open-interest/exchange-history-chart` | 🟢 | symbol, range∈{1m,15m,1h,4h,12h,all} | per-exchange OI series |
| OI exchange-list | `/futures/open-interest/exchange-list` | 🟢 | symbol | 25 rows: oi_usd by coin/stable margin, oi_change_% (snapshot) |

## Futures — Funding Rate
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| funding history | `/futures/funding-rate/history` | 🟢 | exchange, symbol, interval | OHLC funding |
| funding OI-weight | `/futures/funding-rate/oi-weight-history` | 📥 | symbol, interval | OHLC → `cg_funding_oi_weighted`, 4h |
| funding vol-weight | `/futures/funding-rate/vol-weight-history` | 📥 | symbol, interval | OHLC → `cg_funding_vol_weighted`, 4h |
| funding exchange-list | `/futures/funding-rate/exchange-list` | 🟢 | — | 1244 rows: stablecoin/token margin lists (snapshot) |
| funding cumulative | `/futures/funding-rate/accumulated-exchange-list` | 🟢 | range | 1246 rows, same shape (snapshot) |
| funding arbitrage | `/futures/funding-rate/arbitrage` | 🟢 | usd | 469 rows: buy, sell, apr, spread, next_funding_time |

## Futures — Long/Short Ratio
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| global account ratio | `/futures/global-long-short-account-ratio/history` | 📥 | exchange, symbol, interval | → `cg_ls_global_account`, 4h |
| top account ratio | `/futures/top-long-short-account-ratio/history` | 📥 | exchange, symbol, interval | → `cg_ls_top_account`, 4h |
| top position ratio | `/futures/top-long-short-position-ratio/history` | 📥 | exchange, symbol, interval | → `cg_ls_top_position`, 4h |
| taker exchange-ratio | `/futures/taker-buy-sell-volume/exchange-list` | 🟢 | symbol, range | 24 rows: buy/sell ratio + vol (snapshot) |
| net-position | `/futures/net-position/history` | 🟢 | exchange, symbol, interval | `net_long/short_change(_cum)`, 4h ~360d; 1d back to 2020-12 |
| net-position-v2 | `/futures/net-position-v2` | ❔ | — | 404 (hinted path doesn't exist) |

## Futures — Liquidation
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| pair-history | `/futures/liquidation/history` | 📥 | exchange, symbol, interval | long/short liq → `cg_liq_pair`, 4h |
| aggregated-history | `/futures/liquidation/aggregated-history` | 🟡 | needs `exchange_list` | 4h agg long/short liq |
| coin-list (snapshot) | `/futures/liquidation/coin-list` | 📥 | — | → `cg_liq_coin_snapshot` |
| exchange-list (snapshot) | `/futures/liquidation/exchange-list` | 📥 | range∈{4h,12h,24h} | → `cg_liq_exchange_snapshot` |
| coin-history | `/futures/liquidation/aggregated-coin-history`,`/coin-history` | ❔ | — | both 404 |
| order | `/futures/liquidation/order` | ∅ | symbol | `[]` for BTCUSDT (live stream) |
| **map** | `/futures/liquidation/map` | 🔒 | — | **Upgrade plan** |
| **aggregated-map** | `/futures/liquidation/aggregated-map` | 🔒 | — | **Upgrade plan** |
| **heatmap model1/agg** | `/futures/liquidation/heatmap/model1`, `/aggregated-heatmap/model1` | 🔒 | — | **Upgrade plan** |

## Futures — Order Book
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| pair bid/ask (±range%) | `/futures/orderbook/ask-bids-history` | 📥 | exchange, symbol, interval, range=5 | → `cg_orderbook_pair`, 4h (backfill-only) |
| coin agg bid/ask | `/futures/orderbook/aggregated-ask-bids-history` | 🟢 | symbol, interval | agg bids/asks usd+qty, 4h |
| full-depth snapshot | `/futures/orderbook/history` | 🟢 | exchange, symbol, interval | full ladder `[ts,[[price,qty]…]]`, 4h |
| large-limit-order (live) | `/futures/orderbook/large-limit-order` | 🟢 | symbol | 265 rows: limit_price, qty, usd, executed, order_side/state |
| large-limit-order-history | `/futures/orderbook/large-limit-order-history` | 🟢 | symbol | same + order_end_time (event history) |
| heatmap | `/futures/orderbook/heatmap` | ❔ | — | 404 |

## Futures — Taker / CVD / Flows
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| taker pair | `/futures/taker-buy-sell-volume/history` | 📥 | exchange, symbol, interval | → `cg_taker_pair`, 4h |
| taker coin (agg) | `/futures/aggregated-taker-buy-sell-volume/history` | 🟢 | symbol, exchange_list, interval | agg buy/sell vol usd, 4h |
| CVD (pair) | `/futures/cvd/history` | 🟢 | exchange, symbol, interval | taker_buy/sell_vol, cum_vol_delta, 4h |
| agg CVD | `/futures/aggregated-cvd/history` | 🟢 | symbol, exchange_list, interval | agg cvd, 4h |
| footprint | `/futures/taker-buy-sell-volume/footprint` | ❔ | — | 404 |
| netflow / coin-netflow | `/futures/netflow/*`, `/futures/taker-buy-sell-volume/netflow` | ❔ | — | all 404 |
| volume-exchange-history | `/futures/taker-buy-sell-volume/exchange-history` | ❔ | — | 404 |

## Spot
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| supported-coins | `/spot/supported-coins` | 🟢 | — | array of 2330 symbols |
| price-ohlc | `/spot/price/history` | 🟢 | exchange, symbol, interval | OHLC |
| market-data | `/spot/pairs-markets` | 🟢 | — | 18 rows: price, vol, net_flows_usd_{1h..1w} (snapshot) |
| orderbook | `/spot/orderbook/ask-bids-history` | 🟢 | exchange, symbol, interval | bids/asks usd+qty, 4h |
| taker | `/spot/taker-buy-sell-volume/history` | 🟢 | exchange, symbol, interval | taker buy/sell vol, 4h |
| agg CVD | `/spot/aggregated-cvd/history` | 🟢 | symbol, exchange_list, interval | agg cvd, 4h |
| netflow | `/spot/netflow/*` | ❔ | — | both 404 |

## Options
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| exchange-oi-history | `/option/exchange-oi-history` | 🟡 | needs `range` | series |
| exchange-vol-history | `/option/exchange-vol-history` | 🟢 | — | column arrays (time/price/data_map), 2162 pts |
| max-pain | `/option/max-pain` | 🟢 | symbol, exchange (e.g. Deribit) | per-strike max-pain (snapshot) |
| info | `/option/info` | 🟢 | symbol | per-exchange option OI/vol (snapshot) |

## On-Chain
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| exchange-assets | `/exchange/assets` | 🟢 | — | 20 rows: wallet, balance, balance_usd |
| balance-list | `/exchange/balance/list` | 🟢 | symbol | 21 rows: total_balance, change_{1d,7d,30d} (snapshot) |
| balance-chart | `/exchange/balance/chart` | 🟢 | symbol | balance time series (673 daily pts for BTC) |
| onchain-transfers | `/exchange/chain/tx/list` | ∅ | symbol | `[]` for BTC (live tx stream) |
| ERC20-transfers | `/exchange/onchain/transfers`, `/exchange/chain/erc20/transfer` | ❔ | — | 404 |
| whale-transfer | `/exchange/chain/whale-transfer`, `/exchange/whale-transfer` | ❔ | — | both 404 |
| coin-unlock-list | `/coin/unlock-list` | 🟢 | (paginated) | next_unlock_date/usd/tokens, locked/unlocked, circulating |
| token-vesting | `/coin/vesting` | 🟢 | symbol | listing/vesting dates, allocations[], full vesting curve |

## Hyperliquid
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| whale-position | `/hyperliquid/whale-position` | 🟢 | — | 863 rows: user, symbol, size, entry, liq_price, leverage, uPnL (~23d rolling) |
| whale-alert | `/hyperliquid/whale-alert` | 🟢 | — | 50 rows: user, symbol, size, position_action (event stream) |
| positions/balance/funding/oi/trader/leaderboard/vault | `/hyperliquid/{…}` | ❔ | — | all 404 (only the 2 whale endpoints resolve) |

## ETF
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| BTC list | `/etf/bitcoin/list` | 🟢 | — | 20 funds: ticker, aum_usd, fee, price (snapshot) |
| BTC HK-flow | `/hk-etf/bitcoin/flow-history` | 🟢 | — | flow_usd, price_usd; 2024-04-30→ (~769 daily) |
| BTC net-assets | `/etf/bitcoin/net-assets/history` | 🟢 | — | net_assets_usd, change; 2024-01-11→ (~603) |
| BTC flows | `/etf/bitcoin/flow-history` | 🟢 | — | flow_usd, etf_flows; 2024-01-11→ (~621) |
| BTC history | `/etf/bitcoin/history` | 🟡 | needs `ticker` | per-ticker series |
| BTC price | `/etf/bitcoin/price/history` | 🟡 | needs `range` | per-ticker OHLC |
| BTC detail | `/etf/bitcoin/detail` | 🟢 | ticker | ticker_info, last_quote, performance |
| BTC AUM | `/etf/bitcoin/aum` | 🟢 | — | time, aum_usd; 2024-01-02→ (~877) |
| premium/discount | `/etf/bitcoin/premium-discount/history` | 🟢 | — | per-ticker premium series; 2024-01-26→ (~574 daily) |
| ETH list | `/etf/ethereum/list` | 🟢 | — | 12 funds |
| ETH flow | `/etf/ethereum/flow-history` | 🟢 | — | 2024-07-23→ (~483) |
| ETH net-assets | `/etf/ethereum/net-assets/history` | 🟢 | — | 2024-07-23→ (~483) |
| SOL flow | `/etf/solana/flow-history` | 🟢 | — | 2026-05-21→ (~13, new product) |
| XRP flow | `/etf/xrp/flow-history` | 🟢 | — | 2025-11-14→ (~142) |
| HYPE flow | `/etf/hyperliquid/flow-history` | ❔ | — | 404 (no HYPE ETF) |
| Grayscale holdings | `/grayscale/holdings-list` | 🟢 | — | 10 rows: premium_rate, holdings_usd |
| Grayscale premium | `/grayscale/premium-history` | 🟢 | — | column arrays; ~2523 daily (ENDS 2024-01, GBTC converted = dead) |

## Indicators — Futures-derived
| Endpoint | Real path | Status | Params | Shape / History |
|---|---|:--:|---|---|
| RSI list | `/futures/rsi/list` | 🟢 | — | 607 coins: rsi_{15m..1w}, price_change (snapshot) |
| MA/EMA/BOLL/MACD/ATR/TD histories | `/futures/{ma,ema,bollinger-band,macd,atr,td-sequential}*` | ❔ | — | all 404 (only RSI resolves, list-only) |
| whale-index | `/futures/whale-index/history` | 🟢 | exchange, symbol | time, whale_index_value |
| CGDI | `/futures/cgdi-index/history` | 🟢 | — | 2024-01-01→ (~891 daily) |
| CDRI | `/futures/cdri-index/history` | 🟢 | — | 2022-03-05→ (~1558 daily) |

## Indicators — On-chain / cycle (BTC) — slug `/index/bitcoin-<name>` unless noted
| Endpoint | Real path | Status | Shape / History |
|---|---|:--:|---|
| ahr999 | `/index/ahr999` | 🟢 | ~5607 daily |
| bull-market-peak | `/bull-market-peak-indicator` | 🟢 | 30 indicators (snapshot) |
| puell-multiple | `/index/puell-multiple` | 🟢 | 2010-08→ (~5774) |
| stock-flow (S2F) | `/index/stock-flow` | 🟢 | 2010→2028 (~6469) |
| pi-cycle | `/index/pi-cycle-indicator` | 🟢 | 2010-07→ (~5810) |
| golden-ratio | `/index/golden-ratio-multiplier` | 🟢 | ~5810 |
| altcoin-season | `/index/altcoin-season` | 🟢 | 2017-04→ (~3337) |
| STH-SOPR / LTH-SOPR | `/index/bitcoin-{sth,lth}-sopr` | 🟢 | ~5808 |
| STH/LTH realized price | `/index/bitcoin-{sth,lth}-realized-price` | 🟢 | ~5774 |
| RHODL ratio | `/index/bitcoin-rhodl-ratio` | 🟢 | ~5774 |
| reserve-risk | `/index/bitcoin-reserve-risk` | 🟢 | ~5774 |
| active / new addresses | `/index/bitcoin-{active,new}-addresses` | 🟢 | ~5774 |
| NUPL | `/index/bitcoin-net-unrealized-profit-loss` | 🟢 | ~6366 |
| STH supply | `/index/bitcoin-short-term-holder-supply` | 🟢 | ~5408 |
| BTC correlations | `/index/bitcoin-correlation` | 🟢 | gld, iwm, qqq, spy, tlt; ~5746 |
| BMO macro osc. | `/index/bitcoin-macro-oscillator` | 🟢 | 2012-01→ (~5265) |
| opt-vs-fut OI ratio | `/index/option-vs-futures-oi-ratio` | 🟢 | btc/eth ratio; 2020-06→ (~2170) |
| BTC vs global M2 | `/index/bitcoin-vs-global-m2-growth` | 🟢 | 2013-05→ (~667) |
| BTC vs US M2 | `/index/bitcoin-vs-us-m2-growth` | 🟢 | 2010-07→ (~5771) |
| stablecoin marketcap | `/index/stableCoin-marketCap-history` | 🟢 | column arrays per stablecoin; ~4117 daily |
| fear-greed | `/index/fear-greed-history` | 🟢 | fear/greed series |
| bitcoin-dominance | `/index/bitcoin-dominance` | 🟢 | dominance series; ~1596 daily |
| rainbow / bubble / 2yr-ma / 200w-ma / profitable-days / realized-price(base) / realized-cap / fut-spot-vol-ratio / exchanges-transparency | various slugs | ❔ | 404 on all attempted slugs |

## Spots (cross-venue indicators)
| Endpoint | Real path | Status | Shape / History |
|---|---|:--:|---|
| Coinbase Premium Index | `/coinbase-premium-index` | 🟢 | time, premium, premium_rate, coinbase_price; history floor 2025-06-14 |
| Bitfinex margin long/short | `/bitfinex-margin-long-short` | 🟢 | accessible (0 rows for some BTC params — needs symbol tuning) |
| Borrow interest rate | `/borrow-interest-rate` | 🟢 | spot borrow rate |

## Calendar / News / Account
| Endpoint | Real path | Status | Shape / History |
|---|---|:--:|---|
| economic-data | `/calendar/economic-data` | 🟢 | 766 rows: forecast/previous/published, importance |
| article-list (news) | `/article/list` | 🟢 | 20 rows: title, content, source, release_time |
| account / tier query | `/user/account-subscription`, `/account/*`, `/api-usage` | ❔ | all 404 — **no tier-query endpoint on v4**; tier inferred from the 401 on liq-heatmap/map only |

---

## What was tested for tradeable EDGE (not just probed)

The endpoints above that we actually ran IC/backtest research on, with verdict — see
`docs/coinglass-api-reference.md` §4 and the memory files for detail:

| Family / signal | Verdict |
|---|---|
| funding (oi/vol) · top-L/S-position · top-L/S-account confluence | **LIVE** (the working fade book) |
| aggregated CVD (BTC opposition filter) | **REJECTED** — cooldown-reshuffle artifact |
| exchange reserves (BTC, 7d) · ETF premium/discount (BTC) · SOL spot-taker · ADA basis | **marginal / regime-fragile** (not deployed) |
| BTC dominance → BTC-vs-alt spread | **marginal signal / NOT tradeable** (Hyro-infeasible) |
| ETF spot flows · Coinbase premium | **dead — price-coincident proxy** |
| net-position · OI-margin-split · OI-exchange · funding-arb · opt/fut-OI · Whale/CGDI/CDRI · Bitfinex margin · large-orders · altseason · M2 · OI/mcap | **noise** |
| liquidation heatmap/map | **TIER-LOCKED** (untestable) |
| options max-pain · Hyperliquid whale · token unlocks · whale-transfer | **data-insufficient** (snapshot/no-history on tier) |

**Bottom line:** the catalog is effectively exhausted — no clean new tradeable edge beyond the
live funding/L-S fade. The only confirmed paywall is the liquidation heatmap/map cluster.
