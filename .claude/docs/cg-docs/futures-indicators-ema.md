> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Exponential Moving Average (EMA)

This endpoint provides Exponential Moving Average (EMA) for trading pairs .

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
      "time": 1759287600000,
      "ema_value": 114209.64
    },
    {
      "time": 1759291200000,
      "ema_value": 114200.6
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
    "/api/futures/indicators/ema": {
      "get": {
        "description": "",
        "operationId": "get_apifuturesindicatorsma-1",
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
              "default": "1d"
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
            "description": "Number of results per request.  Default: 1000, Maximum: 1000",
            "required": false
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
          },
          {
            "in": "query",
            "name": "window",
            "schema": {
              "type": "integer"
            },
            "description": "Window size — defines the number of data points used for indicator calculation (e.g., 10 for EMA)."
          },
          {
            "in": "query",
            "name": "series_type",
            "schema": {
              "type": "string"
            },
            "description": "Price type used in calculation. Supported values: open, high, low, close. Default: close."
          }
        ],
        "summary": "Copy of Copy of "
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