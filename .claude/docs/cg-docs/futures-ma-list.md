> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin Moving Average List(MA)

This API provides moving average (MA) indicator data for multiple cryptocurrencies across different time periods.

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
      "close_price": 68026.7,
      "ma_1m": 68034.8,
      "ma_5m": 67987.1,
      "ma_15m": 67879.6,
      "ma_30m": 67997,
      "ma_1h": 68131.6,
      "ma_4h": 68717.9,
      "ma_1d": 70866.4,
      "ma_1w": 69008.5
    },
    {
      "symbol": "ETH",
      "close_price": 2054.27,
      "ma_1m": 2054.86,
      "ma_5m": 2055.33,
      "ma_15m": 2051.83,
      "ma_30m": 2054.24,
      "ma_1h": 2058.39,
      "ma_4h": 2084.59,
      "ma_1d": 2168.92,
      "ma_1w": 2048.88
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
    "/api/futures/ma/list": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [],
        "operationId": "get_api-futures-ma-list"
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