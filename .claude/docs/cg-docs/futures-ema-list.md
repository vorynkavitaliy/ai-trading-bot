> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin Exponential Moving Average List (EMA)

This API provides exponential moving average (EMA) indicator data for multiple cryptocurrencies across different time periods.

***Cache / Update Frequency:*** Updates every 10 seconds

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "symbol": "BTC",
      "close_price": 67943.4,
      "ema_1m": 68003.4,
      "ema_5m": 67961.8,
      "ema_15m": 67932.2,
      "ema_30m": 67995.9,
      "ema_1h": 68095.9,
      "ema_4h": 68666.9,
      "ema_1d": 69689.8,
      "ema_1w": 71404.6
    },
    {
      "symbol": "ETH",
      "close_price": 2051.63,
      "ema_1m": 2053.93,
      "ema_5m": 2053.7,
      "ema_15m": 2052.7,
      "ema_30m": 2054.45,
      "ema_1h": 2057.74,
      "ema_4h": 2081.84,
      "ema_1d": 2112.42,
      "ema_1w": 2188.84
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
    "/api/futures/ema/list": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [],
        "operationId": "get_api-futures-ema-list"
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