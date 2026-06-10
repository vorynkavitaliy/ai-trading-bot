> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Net Long/Short Position

This endpoint provides the historical net position data for futures, including the net_long_change and net_short_change values.

***Cache / Update Frequency:*** Real time for all the API plans.

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
      "net_long_change": -50.11,
      "net_short_change": 0,
      "net_long_change_cum": -50.11,
      "net_short_change_cum": 0,
      "net_position_change_cum": -50.11,
      "time": 1767272400000
    },
    {
      "net_long_change": 0,
      "net_short_change": -64.88,
      "net_long_change_cum": -50.11,
      "net_short_change_cum": -64.88,
      "net_position_change_cum": 14.77,
      "time": 1767276000000
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
    "/api/futures/net-position/history": {
      "get": {
        "description": "",
        "operationId": "net-position",
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
            "description": "Spot exchange names (Supported Binance, OKX,Bybit,Hyperliquid)",
            "required": true
          },
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
            },
            "description": "Trading pair (e.g., BTCUSDT). Retrieve supported pairs via the 'support-exchange-pair' API.",
            "required": true
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "4h"
            },
            "description": "Time interval for data aggregation. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d",
            "required": true
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer",
              "format": "int32"
            },
            "description": "Number of results per request. Default: 1000, Maximum: 1000"
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer",
              "default": "",
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