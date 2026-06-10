> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Pair Taker Buy/Sell History

This endpoint provides historical data for the long/short ratio of taker buy and sell volumes in spot markets.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans          | Hobbyist | Startup | Standard | Professional | Enterprise |
| :------------- | :------- | :------ | :------- | :----------- | :--------- |
| Available      | ✅        | ✅       | ✅        | ✅            | ✅          |
| interval Limit | `>=4h`   | `>=30m` | No Limit | No Limit     | No Limit   |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "time": 1741622400000, // Timestamp in milliseconds
      "taker_buy_volume_usd": "10551.033", // Taker buy volume (USD)
      "taker_sell_volume_usd": "11308" // Taker sell volume (USD)
    },
    {
      "time": 1741626000000,
      "taker_buy_volume_usd": "15484.245",
      "taker_sell_volume_usd": "16316.118"
    },
    {
      "time": 1741629600000,
      "taker_buy_volume_usd": "20340.501",
      "taker_sell_volume_usd": "18977.660"
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
    "/api/spot/taker-buy-sell-volume/history": {
      "get": {
        "summary": "Taker Buy/Sell History",
        "description": "This API retrieves historical data for the long/short ratio of taker buy/sell volumes.",
        "operationId": "spot-taker-buysell-ratio-history",
        "parameters": [
          {
            "name": "exchange",
            "in": "query",
            "required": true,
            "description": "Exchange name (e.g., Binance). Retrieve supported exchanges via the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "Binance"
            }
          },
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading pair (e.g., BTCUSDT). Retrieve supported pairs via the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
            }
          },
          {
            "name": "interval",
            "in": "query",
            "required": true,
            "description": "Time interval for data aggregation.  Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w",
            "schema": {
              "type": "string",
              "default": "h1"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Number of results per request.  Default: 1000, Maximum: 1000",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": "10"
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": ""
            }
          },
          {
            "name": "end_time",
            "in": "query",
            "required": false,
            "description": "End timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": ""
            }
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1741622400000, // Timestamp in milliseconds\n      \"taker_buy_volume_usd\": \"10551.033\", // Taker buy volume (USD)\n      \"taker_sell_volume_usd\": \"11308\" // Taker sell volume (USD)\n    },\n    {\n      \"time\": 1741626000000,\n      \"taker_buy_volume_usd\": \"15484.245\",\n      \"taker_sell_volume_usd\": \"16316.118\"\n    },\n    {\n      \"time\": 1741629600000,\n      \"taker_buy_volume_usd\": \"20340.501\",\n      \"taker_sell_volume_usd\": \"18977.660\"\n    }\n  ]\n}\n"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          }
        },
        "deprecated": false
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