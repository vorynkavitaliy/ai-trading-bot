# Futures vs Spot Volume Ratio

This endpoint provides time-series data for the futures-to-spot trading volume ratio, including timestamp, volume ratio, futures trading volume (USD), and spot trading volume (USD).

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
    "time": 1766588040000,        // timestamp (ms)
    "futures_spot_vol_ratio": 16.9974, // futures / spot volume ratio
    "futures_vol_usd": 59900899.685,   // futures volume (USD)
    "spot_vol_usd": 3524120.4165       // spot volume (USD)
  },
  {
    "time": 1766588100000,        // timestamp (ms)
    "futures_spot_vol_ratio": 9.0887,  // futures / spot volume ratio
    "futures_vol_usd": 24469968.832,   // futures volume (USD)
    "spot_vol_usd": 2692346.1708       // spot volume (USD)
  }
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
    "/api/futures_spot_volume_ratio": {
      "get": {
        "description": "",
        "operationId": "get_apifutures_spot_volume_ratio",
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
            "description": "List of exchange names to retrieve data from (e.g.,  'Binance, OKX, Bybit')",
            "required": true
          },
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTC"
            },
            "required": true,
            "description": "Trading coin (e.g., BTC).Retrieve supported coins via the 'support-coins' API."
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "1h"
            },
            "required": true,
            "description": "Time interval for data aggregation.Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w."
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer"
            },
            "description": "Number of results per request.Default: 1000, Maximum: 1000."
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "End timestamp in milliseconds (e.g., 1641522717000)."
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