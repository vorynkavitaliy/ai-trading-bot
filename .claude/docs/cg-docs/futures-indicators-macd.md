> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Moving Average Convergence Divergence (MACD)

This endpoint provides Moving Average Convergence Divergence (MACD) for pairs .

***Cache / Update Frequency:*** Real time for all the API plans..

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

<br />

**Response Data**

```json
{
  "code": "0",
  "data": [
    {
      "time": 1759352400000,
      "macd_value": 1200.54
    },
    {
      "time": 1759356000000,
      "macd_value": 1175.91
    },
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
    "/api/futures/indicators/macd": {
      "get": {
        "description": "",
        "operationId": "get_apifuturesindicatorsema-1",
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
            "description": "Futures exchange names (e.g., Binance, OKX) .Retrieve supported exchanges via the 'support-exchange-pair' API.",
            "required": true
          },
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
            },
            "description": " Trading pair (e.g., BTCUSDT). Retrieve supported pairs via the 'support-exchange-pair' API.",
            "required": true
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "1h"
            },
            "description": "Time interval for data aggregation.  Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w",
            "required": true
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "string"
            },
            "description": "Number of results per request.  Default: 1000, Maximum: 4500",
            "required": false
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "integer"
            },
            "description": "End timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "series_type",
            "schema": {
              "type": "string"
            },
            "description": "Price type used in calculation. Supported values: open, high, low, close. Default: close."
          },
          {
            "in": "query",
            "name": "fast_window",
            "schema": {
              "type": "integer"
            },
            "description": "Fast period window size used for indicator calculation (e.g., 12 for MACD)."
          },
          {
            "in": "query",
            "name": "slow_window",
            "schema": {
              "type": "integer"
            },
            "description": "Slow period window size used for indicator calculation (e.g., 26 for MACD)."
          },
          {
            "in": "query",
            "name": "signal_window",
            "schema": {
              "type": "integer"
            },
            "description": "Signal line window size used to smooth the fast–slow difference (e.g., 9 for MACD)."
          }
        ],
        "summary": "Copy of Copy of Copy of "
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