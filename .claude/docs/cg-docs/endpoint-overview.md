# 🔍 Endpoint Overview

CoinGlass Endpoint Overview

### Endpoint Overview

CoinGlass API provides a comprehensive set of endpoints covering a wide range of cryptocurrency market data, including **Futures, Spot, Options, ETF, On-Chain, and Index indicators**.

To help developers quickly find and integrate the data they need, all endpoints are organized by category in the overview below.

**Base URL**

The base URL for all CoinGlass API requests is:

[https://open-api-v4.coinglass.com](https://open-api-v4.coinglass.com)\
For example, the full request URL for the Supported Futures Coins endpoint is:\
[https://open-api-v4.coinglass.com/api/futures/supported-coins](https://open-api-v4.coinglass.com/api/futures/supported-coins)

When making requests, simply append the endpoint path to the base URL.

Below is a categorized overview of all available CoinGlass API endpoints to help you **navigate, discover, and integrate data efficiently.**

| Endpoints                                                 | Description                                  |
| :-------------------------------------------------------- | :------------------------------------------- |
| **Future Market**                                         |                                              |
| /api/futures/supported-coins                              | Get Supported Futures Coins                  |
| /api/futures/supported-exchange-pairs                     | Get Supported Exchanges and Pairs            |
| /api/futures/coins-markets                                | Futures Coin Markets                         |
| /api/futures/pairs-markets                                | Futures Pair Markets                         |
| /api/futures/coins-price-change                           | Price Change List                            |
| /api/futures/price/history                                | Price OHLC history                           |
| /api/futures/exchange-rank                                | Exchange Rank                                |
| /api/futures/delisted-exchange-pairs                      | Delisted Pairs                               |
| /api/futures/supported-exchanges                          | Supported Exchanges                          |
| **Open Interest**                                         |                                              |
| /api/futures/open-interest/history                        | Open Interest OHLC history                   |
| /api/futures/open-interest/aggregated-history             | Aggregated OI OHLC history                   |
| /api/futures/open-interest/aggregated-stablecoin-history  | Aggregated Stablecoin OI OHLC                |
| /api/futures/open-interest/aggregated-coin-margin-history | Aggregated Coin Margin OI OHLC               |
| /api/futures/open-interest/exchange-list                  | OI By Exchange List                          |
| /api/futures/open-interest/exchange-history-chart         | OI Chart By Exchange                         |
| **Funding Rate**                                          |                                              |
| /api/futures/funding-rate/history                         | Funding Rate OHLC History                    |
| /api/futures/funding-rate/oi-weight-history               | OI Weight History (OHLC)                     |
| /api/futures/funding-rate/vol-weight-history              | Vol Weight History (OHLC)                    |
| /api/futures/funding-rate/exchange-list                   | Funding Rate By Exchange List                |
| /api/futures/funding-rate/accumulated-exchange-list       | Cumulative Funding Rate List                 |
| /api/futures/funding-rate/arbitrage                       | Funding Arbitrage Opportunities              |
| **Long/Short Ratio**                                      |                                              |
| /api/futures/global-long-short-account-ratio/history      | Global Long/Short Account Ratio              |
| /api/futures/top-long-short-account-ratio/history         | Top Trader Long/Short Ratio                  |
| /api/futures/top-long-short-position-ratio/history        | Top Trader Position Ratio                    |
| /api/futures/taker-buy-sell-volume/exchange-list          | Exchange Taker Buy/Sell Ratio                |
| /api/futures/net-position/history                         | Net Position                                 |
| /api/futures/v2/net-position/history                      | Net Position (v2)                            |
| **Liquidation**                                           |                                              |
| /api/futures/liquidation/history                          | Pair Liquidation History                     |
| /api/futures/liquidation/aggregated-history               | Coin Liquidation History                     |
| /api/futures/liquidation/coin-list                        | Liquidation Coin List                        |
| /api/futures/liquidation/exchange-list                    | Liquidation Exchange List                    |
| /api/futures/liquidation/order                            | Liquidation Order                            |
| /api/futures/liquidation/heatmap/model1                   | Pair Liquidation Heatmap Model1              |
| /api/futures/liquidation/heatmap/model2                   | Pair Liquidation Heatmap Model2              |
| /api/futures/liquidation/heatmap/model3                   | Pair Liquidation Heatmap Model3              |
| /api/futures/liquidation/aggregated-heatmap/model1        | Coin Liquidation Heatmap Model1              |
| /api/futures/liquidation/aggregated-heatmap/model2        | Coin Liquidation Heatmap Model2              |
| /api/futures/liquidation/aggregated-heatmap/model3        | Coin Liquidation Heatmap Model3              |
| /api/futures/liquidation/map                              | Pair Liquidation Map                         |
| /api/futures/liquidation/aggregated-map                   | Coin Liquidation Map                         |
| /api/futures/liquidation/max-pain                         | Liquidation Max Pain                         |
| **Order Book**                                            |                                              |
| /api/futures/orderbook/ask-bids-history                   | Pair Orderbook Bid\&Ask(±range)              |
| /api/futures/orderbook/aggregated-ask-bids-history        | Coin Orderbook Bid\&Ask(±range)              |
| /api/futures/orderbook/history                            | Orderbook Heatmap                            |
| /api/futures/orderbook/large-limit-order                  | Large Orderbook                              |
| /api/futures/orderbook/large-limit-order-history          | Large Orderbook History                      |
| **Whale Postions**                                        |                                              |
| /api/hyperliquid/whale-alert                              | Hyperliquid Whale Alert                      |
| /api/hyperliquid/whale-position                           | Hyperliquid Whale Position                   |
| /api/hyperliquid/position                                 | Hyperliquid Position                         |
| /api/hyperliquid/user-position                            | Hyperliquid User Position                    |
| /api/hyperliquid/wallet/position-distribution             | Hyperliquid Wallet Positions Distribution    |
| /api/hyperliquid/wallet/pnl-distribution                  | Hyperliquid Wallet PNL Distribution          |
| /api/hyperliquid/global-long-short-account-ratio/history  | Hyperliquid Long/Short Ratio (Account)       |
| **Taker Buy/Sell**                                        |                                              |
| /api/futures/aggregated-taker-buy-sell-volume/history     | Coin Taker Buy/Sell History                  |
| /api/futures/v2/taker-buy-sell-volume/history             | Pair Taker Buy/Sell History                  |
| /api/futures/volume/footprint-history                     | Footprint History (90d)                      |
| /api/futures/cvd/history                                  | Cumulative Volume Delta (CVD)                |
| /api/futures/aggregated-cvd/history                       | Aggregated Cumulative Volume Delta (CVD)     |
| /api/futures/netflow-list                                 | Futures Coin NetFlow List                    |
| /api/furures/coin/netflow                                 | Futures Coin NetFlow                         |
| **Spots Market**                                          |                                              |
| /api/spot/supported-coins                                 | Supported Coins                              |
| /api/spot/supported-exchange-pairs                        | Suported Exchange and Pairs                  |
| /api/spot/coins-markets                                   | Coins Markets                                |
| /api/spot/pairs-markets                                   | Pairs Markets                                |
| /api/spot/price/history                                   | Price OHLC History                           |
| **Order Book**                                            |                                              |
| /api/spot/orderbook/ask-bids-history                      | Pair Orderbook Bid\&Ask(±range)              |
| /api/spot/orderbook/aggregated-ask-bids-history           | Coin Orderbook Bid\&Ask(±range)              |
| /api/spot/orderbook/history                               | Orderbook Heatmap                            |
| /api/spot/orderbook/large-limit-order                     | Large Orderbook                              |
| /api/spot/orderbook/large-limit-order-history             | Large Orderbook History                      |
| **Taker Buy/Sell**                                        |                                              |
| /api/spot/taker-buy-sell-volume/history                   | Pair Taker Buy/Sell History                  |
| /api/spot/aggregated-taker-buy-sell-volume/history        | Coin Taker Buy/Sell History                  |
| /api/spot/volume/footprint-history                        | Footprint History (90d)                      |
| /api/spot/cvd/history                                     | Cumulative Volume Delta (CVD)                |
| /api/spot/aggregated-cvd/history                          | Aggregated Cumulative Volume Delta (CVD)     |
| /api/spot/netflow-list                                    | Spot Coin NetFlow List                       |
| /api/spot/coin/netflow                                    | Spot Coin NetFlow                            |
|                                                           |                                              |
| **Options**                                               |                                              |
| /api/option/max-pain                                      | Option Max Pain                              |
| /api/option/info                                          | Options Info                                 |
| /api/option/exchange-oi-history                           | Exchange Open Interest History               |
| /api/option/exchange-vol-history                          | Exchange Volume History                      |
| **On-Chain**                                              |                                              |
| /api/exchange/assets                                      | Exchange Assets                              |
| /api/exchange/balance/list                                | Exchange Balance List                        |
| /api/exchange/balance/chart                               | Exchange Balance Chart                       |
| /api/exchange/chain/tx/list                               | Exchange On-chain Transfers (ERC-20)         |
| /api/exchange\_assets\_transparency/list                  | Exchanges Assets Transparency                |
| /api/chain/v2/whale-transfer                              | Whale Transfer                               |
| /api/coin/unlock-list                                     | Token Unlock List                            |
| /api/coin/vesting                                         | Token Vesting                                |
| **ETF**                                                   |                                              |
| /api/etf/bitcoin/list                                     | Bitcoin ETF List                             |
| /api/hk-etf/bitcoin/flow-history                          | Hong Kong ETF Flows History                  |
| /api/etf/bitcoin/net-assets/history                       | ETF NetAssets History                        |
| /api/etf/bitcoin/flow-history                             | ETF Flows History                            |
| /api/etf/bitcoin/premium-discount/history                 | ETF Premium/Discount History                 |
| /api/etf/bitcoin/history                                  | ETF History                                  |
| /api/etf/bitcoin/price/history                            | ETF Price History                            |
| /api/etf/bitcoin/detail                                   | ETF Detail                                   |
| /api/etf/bitcoin/aum                                      | ETF NetAssets History                        |
| /api/etf/ethereum/net-assets/history                      | ETF NetAssets History                        |
| /api/etf/ethereum/list                                    | Ethereum ETF List                            |
| /api/etf/ethereum/flow-history                            | ETF Flows History                            |
| /api/grayscale/holdings-list                              | Holdings List                                |
| /api/grayscale/premium-history                            | Premium History                              |
| /api/etf/solana/flow-history                              | ETF Flows History                            |
| /api/etf/xrp/flow-history                                 | ETF Flows History                            |
| **Indic**                                                 |                                              |
| /api/futures/indicators/td                                | TD Sequential                                |
| /api/futures/avg-true-range/list                          | Coin Average True Range (ATR) List           |
| /api/futures/indicators/avg-true-range                    | Pair Average True Range (ATR)                |
| /api/futures/rsi/list                                     | RSI List                                     |
| /api/futures/basis/history                                | Futures Basis                                |
| /api/futures/whale-index/history                          | Whale Index                                  |
| /api/futures/cgdi-index/history                           | CGDI Index                                   |
| /api/futures/cdri-index/history                           | CDRI Index                                   |
| /api/futures/indicators/ma                                | Moving Average (MA)                          |
| /api/futures/indicators/ema                               | Exponential Moving Average (EMA)             |
| /api/futures/indicators/rsi                               | Pair RSI                                     |
| /api/futures/indicators/macd                              | Moving Average Convergence Divergence (MACD) |
| /api/futures/indicators/boll                              | Bollinger Bands (BOLL)                       |
| /api/futures/macd/list                                    | MACD List                                    |
| /api/coinbase-premium-index                               | Coinbase Premium Index                       |
| /api/bitfinex-margin-long-short                           | Bitfinex Margin Long/Short                   |
| /api/borrow-interest-rate/history                         | Borrow Interest Rate                         |
| /api/index/ahr999                                         | AHR999                                       |
| /api/index/puell-multiple                                 | Puell-Multiple                               |
| /api/index/stock-flow                                     | Stock-to-Flow Model                          |
| /api/index/pi-cycle-indicator                             | Pi Cycle Top Indicator                       |
| /api/index/golden-ratio-multiplier                        | Golden-Ratio-Multiplier                      |
| /api/index/bitcoin/profitable-days                        | Bitcoin Profitable Days                      |
| /api/index/bitcoin/rainbow-chart                          | Bitcoin-Rainbow-Chart                        |
| /api/index/fear-greed-history                             | Crypto Fear & Greed Index                    |
| /api/index/stableCoin-marketCap-history                   | StableCoin MarketCap History                 |
| /api/index/bitcoin/bubble-index                           | Bitcoin Bubble Index                         |
| /api/bull-market-peak-indicator                           | Bull Market Peak Indicators                  |
| /api/index/2-year-ma-multiplier                           | Tow Year Ma Multiplier                       |
| /api/index/200-week-moving-average-heatmap                | 200-Week Moving Avg Heatmap                  |
| /api/index/bitcoin-sth-sopr                               | Bitcoin Short Term Holder SOPR               |
| /api/index/bitcoin-lth-sopr                               | Bitcoin Long Term Holder SOPR                |
| /api/index/bitcoin-sth-realized-price                     | Bitcoin Short Term Holder Realized Price     |
| /api/index/bitcoin-lth-realized-price                     | Bitcoin Long Term Holder Realized Price      |
| /api/index/bitcoin-rhodl-ratio                            | Bitcoin RHODL Ratio                          |
| /api/index/bitcoin-short-term-holder-supply               | Bitcoin Short Term Holder Supply             |
| /api/index/bitcoin-long-term-holder-supply                | Bitcoin Long Term Holder Supply              |
| /api/index/bitcoin-new-addresses                          | Bitcoin New Addresses                        |
| /api/index/bitcoin-active-addresses                       | Bitcoin Active Addresses                     |
| /api/index/bitcoin-reserve-risk                           | Bitcoin Reserve Risk                         |
| /api/index/bitcoin-net-unrealized-profit-loss             | Bitcoin Net Unrealized PNL                   |
| /api/index/bitcoin-correlation                            | Bitcoin Correlations                         |
| /api/index/bitcoin-macro-oscillator                       | Bitcoin Macro Oscillator (BMO)               |
| /api/index/option-vs-futures-oi-ratio                     | Options/Futures OI Ratio                     |
| /api/index/altcoin-season                                 | Altcoin Season Index                         |
| /api/index/bitcoin-vs-global-m2-growth                    | Bitcoin vs Global M2 Supply & Growth         |
| /api/index/bitcoin-vs-us-m2-growth                        | Bitcoin vs US M2 Supply & Growth             |
| /api/index/bitcoin-dominance                              | Bitcoin Dominance                            |
| /api/calendar/economic-data                               | Economic Data                                |
| /api/article/list                                         | News                                         |
| /api/futures\_spot\_volume\_ratio                         | Futures vs Spot Volume Ratio                 |

<br />