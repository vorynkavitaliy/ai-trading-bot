> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin MACD List

This endpoint returns current MACD values across multiple timeframes for each symbol.  This endpoint returns current Moving Average Convergence Divergence (MACD) values across multiple timeframes for each symbol, calculated using the standard parameters (12, 26, 9).

***Cache / Update Frequency:*** Updates every 10 seconds

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

<br />

**Response Data**

```json
{
  "code": "0",
  "data": [
    {
      "symbol": "BTC",
      "macd_1m": 81.80561,
      "macd_5m": 143.48905,
      "signal_5m": 91.452,
      "macd_15m": -16.18165,
      "signal_15m": -87.99726,
      "macd_30m": -95.87941,
      "signal_30m": -122.73658,
      "macd_1h": 88.56051,
      "signal_1h": 182.9783,
      "macd_4h": 977.82453,
      "signal_4h": 888.912,
      "macd_1d": 722.9137,
      "signal_1d": -219.23382,
      "macd_1w": -8949.2849,
      "signal_1w": -7934.24745
    },
    {
      "symbol": "ETH",
      "macd_1m": 1.13198,
      "macd_5m": 3.80416,
      "signal_5m": 4.17097,
      "macd_15m": 3.55342,
      "signal_15m": 1.73445,
      "macd_30m": 2.12428,
      "signal_30m": 0.70135,
      "macd_1h": 15.12386,
      "signal_1h": 19.77531,
      "macd_4h": 69.31752,
      "signal_4h": 57.72725,
      "macd_1d": 34.24028,
      "signal_1d": -15.63182,
      "macd_1w": -366.30054,
      "signal_1w": -302.1124
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
    "/api/futures/macd/list": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [],
        "operationId": "get_api-futures-macd-list"
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