# Cumulative Volume Delta (CVD)

This endpoint provides historical Cumulative Volume Delta (CVD) data for a single spot exchange trading pair, including taker buy and sell volumes over time.

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
      "taker_buy_vol": 350281007.0211,
      "taker_sell_vol": 325339470.9493,
      "cum_vol_delta": 24941536.0718
    },
    {
      "time": 1762257600,
      "taker_buy_vol": 286399814.1275,
      "taker_sell_vol": 347409544.4937,
      "cum_vol_delta": -36068194.2944
    },
    {
      "time": 1762261200,
      "taker_buy_vol": 299952362.4807,
      "taker_sell_vol": 323978642.5934,
      "cum_vol_delta": -60094474.4071
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
    "/api/spot/cvd/history": {
      "get": {
        "description": "",
        "operationId": "get_apispotcvdhistory",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "exchange",
            "schema": {
              "type": "string",
              "default": "Binance"
            },
            "description": "Exchange name (e.g., Binance). Retrieve supported exchanges via the 'supported-exchange-pair' API.",
            "required": true
          },
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
            },
            "required": true,
            "description": "Trading pair (e.g., BTCUSDT). Retrieve supported pairs via the 'supported-exchange-pair' API."
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "1h"
            },
            "required": true,
            "description": "Time interval for data aggregation. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w"
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer"
            },
            "description": "Number of results per request. Default: 1000, Maximum: 1000"
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
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "unit",
            "schema": {
              "type": "string"
            },
            "description": "Unit for the returned data, choose between 'usd' or 'coin'.   Default: 'usd'"
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