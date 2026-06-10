> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Aggregated Cumulative Volume Delta (CVD)

This endpoint provides historical CVD data for a single cryptocurrency within one spot exchange, aggregated across multiple trading pairs.

**Cache / Update Frequency:** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "time": 1762254000000,
      "agg_taker_buy_vol": 461937243.0899,
      "agg_taker_sell_vol": 415687343.2719,
      "cum_vol_delta": 46249899.818
    },
    {
      "time": 1762257600,
      "agg_taker_buy_vol": 390296231.4588,
      "agg_taker_sell_vol": 469137635.9107,
      "cum_vol_delta": -32591504.6339
    },
    {
      "time": 1762261200,
      "agg_taker_buy_vol": 461378798.1884,
      "agg_taker_sell_vol": 450407935.7885,
      "cum_vol_delta": -21620642.234
    },
  ]
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
    "/api/spot/aggregated-cvd/history": {
      "get": {
        "description": "",
        "operationId": "get_apispotaggregated-cvdhistory",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "exchange_list",
            "schema": {
              "type": "string",
              "default": "Binance"
            },
            "description": "Comma-separated exchange names (e.g., \"binance, okx, bybit\"). Retrieve supported exchanges via the 'supported-exchange-pairs' API.",
            "required": true
          },
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTC"
            },
            "description": "Trading pair (e.g., BTC). Retrieve supported coins via the 'support-coins' API.",
            "required": true
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "1h"
            },
            "required": true,
            "description": "Time interval for data aggregation.\nSupported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w\n"
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer"
            },
            "description": "Number of results per request. Default: 1000, Maximum: 4500"
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000).  The starting timestamp from which CVD calculation begins."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "\nEnd timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "unit",
            "schema": {
              "type": "string"
            },
            "description": "Unit for the returned data, choose between 'usd' or 'coin'.  Default: 'usd'"
          }
        ]
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