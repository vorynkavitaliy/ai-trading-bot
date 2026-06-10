# CoinGlass API v4 — справочник (план Standard)

Сгенерировано из изучения 158 локальных доков (`.claude/docs/cg-docs/`). Машиночитаемый полный
каталог — `cg-endpoints.json` (рядом). Этот файл — кураторская выжимка для реализации клиента.

- **Эндпоинтов всего:** 158
- **Доступно на Standard:** 146
- **Запейволено выше Standard (401 «Upgrade plan»):** 12 — кластер liquidation heatmap/map + 2
  hyperliquid by-tag + 1 spot footprint (список ниже).

## Глобальные факты

| Параметр | Значение |
|---|---|
| REST база | `https://open-api-v4.coinglass.com` (все пути под `/api`) |
| Заголовок авторизации | `CG-API-KEY: <key>` (REST). Для WS ключ в query: `?cg-api-key=<key>` |
| Конверт ответа | `{ "code": "0", "msg": "success", "data": ... }` — `code` всегда **строка** |
| Success-код | `"0"` (клиент также принимает `0` и `"00000"`) |
| Время | epoch **миллисекунды** во всех полях (`time`, `start_time`, `end_time`) |
| Числа | OHLC/series-поля **могут приходить и строкой, и числом** (проверено: `close` пришёл числом, `open/high/low` — строками). В типах — `CgNumeric = number \| string`; всегда коэрсить через `Number()` |
| Пагинация | `limit` Default 1000 / Max 1000; окно через `start_time` + `end_time` |
| Rate-limit | по плану; точные числа не публикуются. Отдаются в заголовках `API-KEY-MAX-LIMIT` и `API-KEY-USE-LIMIT`. Превышение → `429`. Клиент пейсит `RateLimiter.perMinute(270)` |
| Интервалы | `1m,3m,5m,15m,30m,1h,4h,6h,8h,12h,1d,1w` (есть `8h`, **нет** `2h`/`3h`) |
| Гранулярность по плану | Hobbyist ≥4h, Startup ≥30m, **Standard = без ограничений** (sub-hour доступен) |
| Проверка плана | `GET /api/user/account/subscription` (на Standard-ключе может вернуть 404 — на практике единственный надёжный сигнал тира это 401 на liquidation heatmap/map) |

### Коды ответов

| Код | Значение |
|---|---|
| `0` | успех |
| `400` | отсутствует/некорректен параметр (эндпоинт валиден, нужен required-параметр) |
| `401` | неверный/отсутствующий ключ; либо «Upgrade plan» — тир ниже требуемого |
| `404` | ресурс не найден |
| `405` | метод не поддерживается |
| `408` | таймаут запроса |
| `422` | параметры валидны, но не приняты |
| `429` | превышен rate-limit (смотри `API-KEY-MAX-LIMIT` / `API-KEY-USE-LIMIT`) |
| `500` | ошибка сервера |

### WebSocket

- URL: `wss://open-ws.coinglass.com/ws-api?cg-api-key=<key>`.
- Подписка: `{"method":"subscribe"|"unsubscribe","channels":[...]}`.
- Каналы (все требуют Standard+): `liquidationOrders`/`liquidation_orders` (side=1 long-liq, side=2 short-liq);
  `futures_ticker@{exchange}_{symbol}`; `futures_trades@{exchange}_{symbol}@{minVol}` (side=1 sell, 2 buy);
  `spot_trades@{exchange}_{symbol}@{minVol}`.
- Keepalive: слать `ping` каждые ~20s, ждать `pong`; при обрыве — переподключение + повторная подписка.
- Входящие: `{"channel":"...","data":[{...}]}`. Время — epoch ms.

### Запейволено выше Standard (12)

```
/api/futures/liquidation/heatmap/model1 · model2 · model3
/api/futures/liquidation/aggregated-heatmap/model1 · model2 · model3
/api/futures/liquidation/map
/api/futures/liquidation/aggregated-map
/api/futures/liquidation/max-pain
/api/futures/hyperliquid/long-short-account-ratio-by-tag/history
/api/futures/hyperliquid/position-distribution-by-tag/history
/api/spot/volume/footprint-history
```

## Покрытие типизированным клиентом

`CoinglassClient` оборачивает типизированными методами домены с авторитетной схемой полей; всё
остальное из 146 Standard-эндпоинтов доступно через generic `client.request<T>(path, params)`.

| Группа | Свойство | Методы |
|---|---|---|
| Market | `client.market` | `getSupportedCoins`, `getSupportedExchanges`, `getSupportedExchangePairs`, `getCoinsMarkets`, `getPairsMarkets`, `getPriceHistory` |
| Open Interest | `client.openInterest` | `getHistory`, `getAggregatedHistory`, `getExchangeList` |
| Funding | `client.funding` | `getHistory`, `getOiWeightHistory`, `getVolWeightHistory` |
| Positioning | `client.positioning` | `getGlobalAccountRatio`, `getTopAccountRatio`, `getTopPositionRatio`, `getTakerVolumeExchangeList` |
| Liquidation | `client.liquidation` | `getHistory`, `getAggregatedHistory`, `getCoinList`, `getExchangeList` |
| Orderbook | `client.orderbook` | `getAskBidsHistory`, `getAggregatedAskBidsHistory` |

Параметры серий нормализованы (camelCase → snake_case в `params.ts`): `exchange`, `symbol`,
`interval`, `limit`, `startTime`, `endTime`, `unit`; агрегаты — `exchangeList`.

---

## Полный каталог по доменам

Легенда: ✅ = доступно на Standard, 🔒 = требует план выше Standard. `*` у параметра = обязательный.

### etf-grayscale (18)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Bitcoin ETF List | `/api/etf/bitcoin/list` | ✅ |  |
| Hong Kong ETF Flows History | `/api/hk-etf/bitcoin/flow-history` | ✅ |  |
| ETF NetAssets History | `/api/etf/bitcoin/net-assets/history` | ✅ | ticker |
| ETF Flows History | `/api/etf/bitcoin/flow-history` | ✅ |  |
| ETF Premium/Discount History | `/api/etf/bitcoin/premium-discount/history` | ✅ | ticker |
| ETF History | `/api/etf/bitcoin/history` | ✅ | ticker* |
| ETF Price History | `/api/etf/bitcoin/price/history` | ✅ | ticker*, range* |
| ETF Detail | `/api/etf/bitcoin/detail` | ✅ | ticker* |
| ETF AUM | `/api/etf/bitcoin/aum` | ✅ | ticker |
| ETF NetAssets History | `/api/etf/ethereum/net-assets/history` | ✅ |  |
| Ethereum ETF List | `/api/etf/ethereum/list` | ✅ |  |
| ETF Flows History | `/api/etf/ethereum/flow-history` | ✅ |  |
| Holdings List | `/api/grayscale/holdings-list` | ✅ |  |
| Premium History | `/api/grayscale/premium-history` | ✅ | symbol* |
| ETF Flows History | `/api/etf/solana/flow-history` | ✅ |  |
| ETF Flows History | `/api/etf/xrp/flow-history` | ✅ |  |
| ETF Flows History | `/api/etf/hype/flow-history` | ✅ |  |
| Option Max Pain | `/api/option/max-pain` | ✅ | symbol*, exchange* |

### exchange-onchain (9)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Exchange Volume History | `/api/option/exchange-vol-history` | ✅ | symbol*, unit* |
| Exchange Assets | `/api/exchange/assets` | ✅ | exchange*, per_page, page |
| Exchange Balance List | `/api/exchange/balance/list` | ✅ | symbol* |
| Exchange Balance Chart | `/api/exchange/balance/chart` | ✅ | symbol* |
| Exchange On-chain Transfers (ERC-20) | `/api/exchange/chain/tx/list` | ✅ | symbol, start_time, min_usd, per_page, page |
| Whale Transfer | `/api/chain/v2/whale-transfer` | ✅ | symbol, start_time, end_time |
| Token Unlock List | `/api/coin/unlock-list` | ✅ | per_page, page |
| Token Vesting | `/api/coin/vesting` | ✅ | symbol* |
| Exchanges Assets Transparency | `/api/exchange_assets_transparency/list` | ✅ |  |

### funding-rate (7)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| History (OHLC) | `/api/futures/funding-rate/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| OI Weight History (OHLC) | `/api/futures/funding-rate/oi-weight-history` | ✅ | symbol*, interval*, limit, start_time, end_time |
| Vol Weight History (OHLC) | `/api/futures/funding-rate/vol-weight-history` | ✅ | symbol*, interval*, limit, start_time, end_time |
| Exchange List | `/api/futures/funding-rate/exchange-list` | ✅ |  |
| Cumulative Exchange List | `/api/futures/funding-rate/accumulated-exchange-list` | ✅ | range* |
| Arbitrage | `/api/futures/funding-rate/arbitrage` | ✅ | usd*, exchange_list |
| Options/Futures OI Ratio | `/api/index/option-vs-futures-oi-ratio` | ✅ |  |

### general-market (9)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Supported Coins | `/api/futures/supported-coins` | ✅ |  |
| Supported Exchanges | `/api/futures/supported-exchanges` | ✅ |  |
| Supported Exchange and Pairs | `/api/futures/supported-exchange-pairs` | ✅ | exchange |
| Coins Markets | `/api/futures/coins-markets` | ✅ | exchange_list, per_page, page |
| Pairs Markets | `/api/futures/pairs-markets` | ✅ | symbol* |
| Coins Price Change | `/api/futures/coins-price-change` | ✅ |  |
| Price History (OHLC) | `/api/futures/price/history` | ✅ | exchange*, symbol*, interval*, limit*, start_time, end_time |
| Delisted Pairs | `/api/futures/delisted-exchange-pairs` | ✅ |  |
| Exchange Rank | `/api/futures/exchange-rank` | ✅ |  |

### hyperliquid (9)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Hyperliquid Whale Alert | `/api/hyperliquid/whale-alert` | ✅ |  |
| Hyperliquid Whale Position | `/api/hyperliquid/whale-position` | ✅ |  |
| Hyperliquid Wallet Positions by Coin | `/api/hyperliquid/position` | ✅ | symbol*, current_page |
| Hyperliquid Wallet Positions by Address | `/api/hyperliquid/user-position` | ✅ | user_address* |
| Hyperliquid Wallet Positions Distribution | `/api/hyperliquid/wallet/position-distribution` | ✅ |  |
| Hyperliquid Wallet PNL Distribution | `/api/hyperliquid/wallet/pnl-distribution` | ✅ |  |
| Hyperliquid Long/Short Ratio (Accounts) | `/api/hyperliquid/global-long-short-account-ratio/history` | ✅ | symbol, interval*, limit, start_time, end_time |
| Hyperliquid Long/Short Account Ratio (By Tag) | `/api/futures/hyperliquid/long-short-account-ratio-by-tag/history` | 🔒 | symbol*, interval*, wallet_tag*, limit, start_time, end_time |
| Hyperliquid Position Distribution (By Tag) | `/api/futures/hyperliquid/position-distribution-by-tag/history` | 🔒 | interval*, wallet_tag*, limit, start_time, end_time |

### index-macro-a (17)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Coinbase Premium Index | `/api/coinbase-premium-index` | ✅ | interval*, limit, start_time, end_time |
| Bitfinex Margin Long/Short | `/api/bitfinex-margin-long-short` | ✅ | symbol*, limit, interval*, start_time, end_time |
| Borrow Interest Rate | `/api/borrow-interest-rate/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| AHR999 | `/api/index/ahr999` | ✅ |  |
| Bull Market Peak Indicators | `/api/bull-market-peak-indicator` | ✅ |  |
| Puell-Multiple | `/api/index/puell-multiple` | ✅ |  |
| Stock-to-Flow Model | `/api/index/stock-flow` | ✅ |  |
| Pi Cycle Top Indicator | `/api/index/pi-cycle-indicator` | ✅ |  |
| Golden-Ratio-Multiplier | `/api/index/golden-ratio-multiplier` | ✅ |  |
| Bitcoin Profitable Days | `/api/index/bitcoin/profitable-days` | ✅ |  |
| Bitcoin-Rainbow-Chart | `/api/index/bitcoin/rainbow-chart` | ✅ |  |
| Crypto Fear & Greed Index | `/api/index/fear-greed-history` | ✅ |  |
| StableCoin MarketCap History | `/api/index/stableCoin-marketCap-history` | ✅ |  |
| Bitcoin Bubble Index | `/api/index/bitcoin/bubble-index` | ✅ |  |
| Tow Year Ma Multiplier | `/api/index/2-year-ma-multiplier` | ✅ |  |
| 200-Week Moving Avg Heatmap | `/api/index/200-week-moving-average-heatmap` | ✅ |  |
| Altcoin Season Index | `/api/index/altcoin-season` | ✅ |  |

### index-macro-b (17)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Bitcoin Short Term Holder SOPR | `/api/index/bitcoin-sth-sopr` | ✅ |  |
| Bitcoin Long Term Holder SOPR | `/api/index/bitcoin-lth-sopr` | ✅ |  |
| Bitcoin Short Term Holder Realized Price | `/api/index/bitcoin-sth-realized-price` | ✅ |  |
| Bitcoin Long Term Holder Realized Price | `/api/index/bitcoin-lth-realized-price` | ✅ |  |
| Bitcoin Short Term Holder Supply | `/api/index/bitcoin-short-term-holder-supply` | ✅ |  |
| Bitcoin Long Term Holder Supply | `/api/index/bitcoin-long-term-holder-supply` | ✅ |  |
| Bitcoin RHODL Ratio | `/api/index/bitcoin-rhodl-ratio` | ✅ |  |
| Bitcoin Reserve Risk | `/api/index/bitcoin-reserve-risk` | ✅ |  |
| Bitcoin Active Addresses | `/api/index/bitcoin-active-addresses` | ✅ |  |
| Bitcoin New Addresses | `/api/index/bitcoin-new-addresses` | ✅ |  |
| Bitcoin Net Unrealized PNL | `/api/index/bitcoin-net-unrealized-profit-loss` | ✅ |  |
| Bitcoin Correlations | `/api/index/bitcoin-correlation` | ✅ |  |
| Bitcoin Macro Oscillator (BMO) | `/api/index/bitcoin-macro-oscillator` | ✅ |  |
| Bitcoin vs Global M2 Supply & Growth | `/api/index/bitcoin-vs-global-m2-growth` | ✅ |  |
| Bitcoin vs US M2 Supply & Growth | `/api/index/bitcoin-vs-us-m2-growth` | ✅ |  |
| Bitcoin Dominance | `/api/index/bitcoin-dominance` | ✅ |  |
| Economic Data | `/api/calendar/economic-data` | ✅ | start_time, end_time, language |

### indicators-ta (18)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Coin RSI List | `/api/futures/rsi/list` | ✅ |  |
| Pair RSI | `/api/futures/indicators/rsi` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, window, series_type |
| Pair Moving Average (MA) | `/api/futures/indicators/ma` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, window, series_type |
| Coin Moving Average List(MA) | `/api/futures/ma/list` | ✅ |  |
| Exponential Moving Average (EMA) | `/api/futures/indicators/ema` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, window, series_type |
| Coin Exponential Moving Average List (EMA) | `/api/futures/ema/list` | ✅ |  |
| Bollinger Bands (BOLL) | `/api/futures/indicators/boll` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, series_type, window, mult |
| Moving Average Convergence Divergence (MACD) | `/api/futures/indicators/macd` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, series_type, fast_window, slow_window, signal_window |
| Coin MACD List | `/api/futures/macd/list` | ✅ |  |
| Futures Basis | `/api/futures/basis/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Whale Index | `/api/futures/whale-index/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| CGDI Index | `/api/futures/cgdi-index/history  ` | ✅ |  |
| CDRI Index | `/api/futures/cdri-index/history ` | ✅ |  |
| Pair Average True Range (ATR) | `/api/futures/indicators/avg-true-range` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, window |
| Coin Average True Range (ATR) List | `/api/futures/avg-true-range/list` | ✅ |  |
| TD Sequential | `/api/futures/indicators/td` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Coin TD Sequential List | `/api/futures/td/list` | ✅ |  |
| Futures vs Spot Volume Ratio | `/api/futures_spot_volume_ratio` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time |

### liquidation (14)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Pair Liquidation History | `/api/futures/liquidation/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Coin Liquidation History | `/api/futures/liquidation/aggregated-history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time |
| Liquidation Coin List | `/api/futures/liquidation/coin-list` | ✅ | exchange* |
| Liquidation Exchange List | `/api/futures/liquidation/exchange-list` | ✅ | symbol, range* |
| Liquidation Order | `/api/futures/liquidation/order` | ✅ | exchange*, symbol*, min_liquidation_amount*, start_time, end_time |
| Pair Liquidation Heatmap Model1 | `/api/futures/liquidation/heatmap/model1` | 🔒 | exchange*, symbol*, range* |
| Pair Liquidation Heatmap Model2 | `/api/futures/liquidation/heatmap/model2` | 🔒 | exchange*, symbol*, range* |
| Pair Liquidation Heatmap Model3 | `/api/futures/liquidation/heatmap/model3` | 🔒 | exchange*, symbol*, range* |
| Coin Liquidation Heatmap Model1 | `/api/futures/liquidation/aggregated-heatmap/model1` | 🔒 | symbol*, range* |
| Coin Liquidation Heatmap Model2 | `/api/futures/liquidation/aggregated-heatmap/model2` | 🔒 | symbol*, range* |
| Coin Liquidation Heatmap Model3 | `/api/futures/liquidation/aggregated-heatmap/model3` | 🔒 | symbol*, range* |
| Pair Liquidation Map | `/api/futures/liquidation/map` | 🔒 | exchange*, symbol*, range* |
| Coin Liquidation Map | `/api/futures/liquidation/aggregated-map` | 🔒 | symbol*, range* |
| Liquidation Max Pain | `/api/futures/liquidation/max-pain` | 🔒 | range |

### longshort-taker-netpos (6)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Global Account Ratio | `/api/futures/global-long-short-account-ratio/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Top Account Ratio History | `/api/futures/top-long-short-account-ratio/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Top Position Ratio History | `/api/futures/top-long-short-position-ratio/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Exchange Taker Buy/Sell Ratio | `/api/futures/taker-buy-sell-volume/exchange-list` | ✅ | symbol*, range* |
| Net Long/Short Position | `/api/futures/net-position/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Net Long/Short Position (v2) | `/api/futures/v2/net-position/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |

### open-interest (7)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| History (OHLC) | `/api/futures/open-interest/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, unit |
| Aggregated History (OHLC) | `/api/futures/open-interest/aggregated-history` | ✅ | symbol*, interval*, limit, start_time, end_time, unit |
| Aggregated Stablecoin Margin History (OHLC) | `/api/futures/open-interest/aggregated-stablecoin-history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time |
| Aggregated Coin Margin History (OHLC) | `/api/futures/open-interest/aggregated-coin-margin-history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time |
| Exchange List | `/api/futures/open-interest/exchange-list` | ✅ | symbol* |
| Exchange History Chart | `/api/futures/open-interest/exchange-history-chart` | ✅ | symbol*, range*, unit |
| Exchange Open Interest History | `/api/option/exchange-oi-history` | ✅ | symbol*, unit*, range* |

### orderbook-futures (5)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Pair Orderbook Bid&Ask(±range) | `/api/futures/orderbook/ask-bids-history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, range |
| Coin Aggregated Orderbook Bid&Ask(±range) | `/api/futures/orderbook/aggregated-ask-bids-history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time, range |
| Orderbook Heatmap | `/api/futures/orderbook/history` | ✅ | exchange*, symbol*, interval*, limit*, start_time, end_time |
| Large Open Orders (Order Book) | `/api/futures/orderbook/large-limit-order` | ✅ | exchange*, symbol* |
| Large Open Orders (Order Book History) | `/api/futures/orderbook/v2/large-limit-order-history` | ✅ | exchange*, symbol*, start_time*, end_time*, state* |

### spot (18)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Supported Coins | `/api/spot/supported-coins` | ✅ |  |
| Suported Exchange and Pairs | `/api/spot/supported-exchange-pairs` | ✅ |  |
| Coins Markets | `/api/spot/coins-markets` | ✅ | per_page, page |
| Pairs Markets | `/api/spot/pairs-markets` | ✅ | symbol* |
| Price OHLC History | `/api/spot/price/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Market Data History | `/api/coin/market-data-history` | ✅ | symbol* |
| Pair Orderbook Bid&Ask(±range) | `/api/spot/orderbook/ask-bids-history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, range |
| Coin Orderbook Bid&Ask(±range) | `/api/spot/orderbook/aggregated-ask-bids-history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time, range |
| Orderbook Heatmap | `/api/spot/orderbook/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Large Orderbook | `/api/spot/orderbook/large-limit-order` | ✅ | exchange*, symbol* |
| Large Orderbook History | `/api/spot/orderbook/v2/large-limit-order-history` | ✅ | exchange*, symbol*, start_time*, end_time*, state* |
| Pair Taker Buy/Sell History | `/api/spot/taker-buy-sell-volume/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time |
| Coin Taker Buy/Sell History | `/api/spot/aggregated-taker-buy-sell-volume/history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time, unit |
| Footprint History (90d) | `/api/spot/volume/footprint-history` | 🔒 | exchange*, symbol*, interval*, limit, start_time, end_time |
| Cumulative Volume Delta (CVD) | `/api/spot/cvd/history` | ✅ | exchange*, symbol*, interval*, limit, start_time, end_time, unit |
| Aggregated Cumulative Volume Delta (CVD) | `/api/spot/aggregated-cvd/history` | ✅ | exchange_list*, symbol*, interval*, limit, start_time, end_time, unit |
| Coin NetFlow List | `/api/spot/netflow-list` | ✅ | per_page, page |
| Coin NetFlow | `/api/spot/coin/netflow` | ✅ | symbol*, exchange_list* |

### websocket (4)

| Endpoint | Path | Std | Key params |
|---|---|---|---|
| Liquidation Order | `channel: liquidation_orders` | ✅ | method*, channels* |
| Spot Trade Order | `channel: spot_trades@{exchange}_{symbol}@{minVol}` | ✅ | method*, channels*, exchange*, symbol*, minVol* |
| Futures Trade Order | `channel: futures_trades@{exchange}_{symbol}@{minVol}` | ✅ | method*, channels*, exchange*, symbol*, minVol* |
| Futures Ticker Snapshot | `channel: futures_ticker@{exchange}_{symbol}` | ✅ | method*, channels*, exchange*, symbol* |

