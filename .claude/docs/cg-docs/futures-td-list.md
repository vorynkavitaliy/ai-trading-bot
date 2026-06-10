> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin TD Sequential List

This endpoint provides TD (Tom DeMark Sequential) indicator counts for multiple cryptocurrencies across different timeframes.

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
      "td_1m": -2,
      "td_5m": 5,// Positive values indicate buy
      "td_15m": -1,// Negative values indicate sell
      "td_30m": -1,
      "td_1h": -7,
      "td_4h": -1,
      "td_1d": -1,
      "td_1w": 4
    },
    {
      "symbol": "ETH",
      "td_1m": -4,
      "td_5m": 4,
      "td_15m": -1,
      "td_30m": 4,
      "td_1h": 2,
      "td_4h": -1,
      "td_1d": 4,
      "td_1w": 4
    },
           ....
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
    "/api/futures/td/list": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [],
        "operationId": "get_api-futures-td-list"
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