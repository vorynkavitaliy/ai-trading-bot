# Coin NetFlow

This API provides inflow and outflow data for a single coin across multiple time intervals in the spot market.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": {
    "symbol": "BTC",
    "taker_buy_volume_usd_5m": "8564899",
    "taker_sell_volume_usd_5m": "9692915",
    "net_flow_usd_5m": "-1128017",
    "net_flow_usd_change_percent_5m": -51.73,
    "net_flow_usd_5m_market_cap_ratio": -0.000076,
    "taker_buy_volume_usd_15m": "29134420",
    "taker_sell_volume_usd_15m": "44784583",
    "net_flow_usd_15m": "-15650163",
    "net_flow_usd_change_percent_15m": -206.69,
    "net_flow_usd_15m_market_cap_ratio": -0.001055,
    "taker_buy_volume_usd_30m": "79865179",
    "taker_sell_volume_usd_30m": "80845695",
    "net_flow_usd_30m": "-980517",
    "net_flow_usd_change_percent_30m": -104.76,
    "net_flow_usd_30m_market_cap_ratio": -0.000066,
    "taker_buy_volume_usd_1h": "165477715",
    "taker_sell_volume_usd_1h": "145832349",
    "net_flow_usd_1h": "19645366",
    "net_flow_usd_change_percent_1h": 217.96,
    "net_flow_usd_1h_market_cap_ratio": 0.001324,
    "taker_buy_volume_usd_4h": "760187107",
    "taker_sell_volume_usd_4h": "729339048",
    "net_flow_usd_4h": "30848059",
    "net_flow_usd_change_percent_4h": 135.14,
    "net_flow_usd_4h_market_cap_ratio": 0.00208,
    "taker_buy_volume_usd_8h": "1005775816",
    "taker_sell_volume_usd_8h": "1044121929",
    "net_flow_usd_8h": "-38346114",
    "net_flow_usd_change_percent_8h": -9.06,
    "net_flow_usd_8h_market_cap_ratio": -0.002585,
    "taker_buy_volume_usd_12h": "2442236886",
    "taker_sell_volume_usd_12h": "2561495148",
    "net_flow_usd_12h": "-119258262",
    "net_flow_usd_change_percent_12h": -129.43,
    "net_flow_usd_12h_market_cap_ratio": -0.00804,
    "taker_buy_volume_usd_24h": "7566899147",
    "taker_sell_volume_usd_24h": "7280826322",
    "net_flow_usd_24h": "286072825",
    "net_flow_usd_change_percent_24h": -60.91,
    "net_flow_usd_24h_market_cap_ratio": 0.019286,
    "taker_buy_volume_usd_3d": "25868053532",
    "taker_sell_volume_usd_3d": "24153912510",
    "net_flow_usd_3d": "1714141022",
    "net_flow_usd_change_percent_3d": -16.01,
    "net_flow_usd_3d_market_cap_ratio": 0.115562,
    "taker_buy_volume_usd_5d": "35555399802",
    "taker_sell_volume_usd_5d": "33163465367",
    "net_flow_usd_5d": "2391934436",
    "net_flow_usd_change_percent_5d": -9.4,
    "net_flow_usd_5d_market_cap_ratio": 0.161257,
    "taker_buy_volume_usd_7d": "58795007181",
    "taker_sell_volume_usd_7d": "55000626111",
    "net_flow_usd_7d": "3794381071",
    "net_flow_usd_change_percent_7d": 1960.91,
    "net_flow_usd_7d_market_cap_ratio": 0.255806,
    "taker_buy_volume_usd_10d": "90978663883",
    "taker_sell_volume_usd_10d": "85946889007",
    "net_flow_usd_10d": "5031774877",
    "net_flow_usd_change_percent_10d": 506.96,
    "net_flow_usd_10d_market_cap_ratio": 0.339227,
    "taker_buy_volume_usd_15d": "137799491538",
    "taker_sell_volume_usd_15d": "132072679473",
    "net_flow_usd_15d": "5726812066",
    "net_flow_usd_change_percent_15d": 3668.93,
    "net_flow_usd_15d_market_cap_ratio": 0.386085,
    "taker_buy_volume_usd_30d": "266960790361",
    "taker_sell_volume_usd_30d": "261394441706",
    "net_flow_usd_30d": "5566348656",
    "net_flow_usd_change_percent_30d": 151.96,
    "net_flow_usd_30d_market_cap_ratio": 0.375267,
    "taker_buy_volume_usd_40d": "349549701197",
    "taker_sell_volume_usd_40d": "344312184923",
    "net_flow_usd_40d": "5237516274",
    "net_flow_usd_change_percent_40d": 152.76,
    "net_flow_usd_40d_market_cap_ratio": 0.353098,
    "taker_buy_volume_usd_50d": "496844249786",
    "taker_sell_volume_usd_50d": "499136038696",
    "net_flow_usd_50d": "-2291788910",
    "net_flow_usd_change_percent_50d": 57.87,
    "net_flow_usd_50d_market_cap_ratio": -0.154506,
    "taker_buy_volume_usd_60d": "564792098258",
    "taker_sell_volume_usd_60d": "569939808511",
    "net_flow_usd_60d": "-5147710254",
    "net_flow_usd_change_percent_60d": 41.36,
    "net_flow_usd_60d_market_cap_ratio": -0.347043,
    "taker_buy_volume_usd_90d": "766953365285",
    "taker_sell_volume_usd_90d": "771796120595",
    "net_flow_usd_90d": "-4842755310",
    "net_flow_usd_change_percent_90d": 86.29,
    "net_flow_usd_90d_market_cap_ratio": -0.326484,
    "taker_buy_volume_usd_120d": "1062521073566",
    "taker_sell_volume_usd_120d": "1076447240334",
    "net_flow_usd_120d": "-13926166769",
    "net_flow_usd_change_percent_120d": 72.68,
    "net_flow_usd_120d_market_cap_ratio": -0.938861,
    "taker_buy_volume_usd_150d": "1374917377958",
    "taker_sell_volume_usd_150d": "1401464473468",
    "net_flow_usd_150d": "-26547095511",
    "net_flow_usd_change_percent_150d": 45.46,
    "net_flow_usd_150d_market_cap_ratio": -1.789726,
    "taker_buy_volume_usd_180d": "1713318564888",
    "taker_sell_volume_usd_180d": "1753478516197",
    "net_flow_usd_180d": "-40159951310",
    "net_flow_usd_change_percent_180d": -23.01,
    "net_flow_usd_180d_market_cap_ratio": -2.707464,
    "taker_buy_volume_usd_1y": "3618522811709",
    "taker_sell_volume_usd_1y": "3690105674385",
    "net_flow_usd_1y": "-71582862676",
    "net_flow_usd_change_percent_1y": -0.17,
    "net_flow_usd_1y_market_cap_ratio": -4.825903
  },
  "success": true
}
```

# OpenAPI definition

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "coinglass",
    "version": "3.0"
  },
  "servers": [
    {
      "url": "https://open-api-v4.coinglass.com"
    }
  ],
  "components": {
    "securitySchemes": {
      "sec0": {
        "type": "apiKey",
        "in": "header",
        "name": "CG-API-KEY"
      }
    }
  },
  "security": [
    {
      "sec0": []
    }
  ],
  "paths": {
    "/api/spot/coin/netflow": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTC"
            },
            "required": true,
            "description": "Trading coin (e.g., BTC). Retrieve supported coins via the 'supported-coins' API."
          },
          {
            "in": "query",
            "name": "exchange_list",
            "schema": {
              "type": "string",
              "default": "Binance, Bybit, OKX, Bitget, Gate"
            },
            "required": true,
            "description": "exchange_list: List of exchange names to retrieve data from (e.g., 'Binance, OKX, Bybit') . Default exchanges: \"Binance, Bybit, OKX, Bitget, Gate\"."
          }
        ],
        "operationId": "get_api-spot-coin-netflow"
      }
    }
  },
  "x-readme": {
    "headers": [],
    "explorer-enabled": true,
    "proxy-enabled": true
  },
  "x-readme-fauxas": true
}
```