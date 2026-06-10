# Exchange Taker Buy/Sell Ratio

This endpoint provides the long/short ratio of aggregated taker buy/sell volumes across exchanges.

***Cache / Update Frequency:*** 1 second for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": {
    "symbol": "BTC", // Token symbol
    "buy_ratio": 51.01, // Buy ratio (%)
    "sell_ratio": 48.99, // Sell ratio (%)
    "buy_vol_usd": 1112108532.1688, // Total buy volume (USD)
    "sell_vol_usd": 1068220541.0417, // Total sell volume (USD)
    "exchange_list": [ // Buy/sell data per exchange
      {
        "exchange": "Binance", // Exchange name
        "buy_ratio": 49.22, // Buy ratio (%)
        "sell_ratio": 50.78, // Sell ratio (%)
        "buy_vol_usd": 240077939.5811, // Buy volume (USD)
        "sell_vol_usd": 247674925.1653 // Sell volume (USD)
      },
      {
        "exchange": "OKX", // Exchange name
        "buy_ratio": 50.84, // Buy ratio (%)
        "sell_ratio": 49.16, // Sell ratio (%)
        "buy_vol_usd": 108435724.6214, // Buy volume (USD)
        "sell_vol_usd": 104834502.5904 // Sell volume (USD)
      }
    ]
  }
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
    "/api/futures/taker-buy-sell-volume/exchange-list": {
      "get": {
        "summary": "Exchange Taker Buy/Sell Ratio",
        "description": "This API retrieves the long/short ratio of aggregated taker buy/sell volumes for exchanges.",
        "operationId": "taker-buysell-volume-exchange-list",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC).  Retrieve supported coins via the 'supported-coins' API.",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for the data (e.g., 5m, 15m, 30m, 1h, 4h,12h, 24h).",
            "schema": {
              "type": "string",
              "default": "4h"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"symbol\": \"BTC\", // Token symbol\n    \"buy_ratio\": 51.01, // Buy ratio (%)\n    \"sell_ratio\": 48.99, // Sell ratio (%)\n    \"buy_vol_usd\": 1112108532.1688, // Total buy volume (USD)\n    \"sell_vol_usd\": 1068220541.0417, // Total sell volume (USD)\n    \"exchange_list\": [ // Buy/sell data per exchange\n      {\n        \"exchange\": \"Binance\", // Exchange name\n        \"buy_ratio\": 49.22, // Buy ratio (%)\n        \"sell_ratio\": 50.78, // Sell ratio (%)\n        \"buy_vol_usd\": 240077939.5811, // Buy volume (USD)\n        \"sell_vol_usd\": 247674925.1653 // Sell volume (USD)\n      },\n      {\n        \"exchange\": \"OKX\", // Exchange name\n        \"buy_ratio\": 50.84, // Buy ratio (%)\n        \"sell_ratio\": 49.16, // Sell ratio (%)\n        \"buy_vol_usd\": 108435724.6214, // Buy volume (USD)\n        \"sell_vol_usd\": 104834502.5904 // Sell volume (USD)\n      }\n    ]\n  }\n}\n"
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