> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Liquidation Order

This endpoint provides liquidation order data from the past 7 days, including exchange, trading pair, and liquidation amount details.

***Cache / Update Frequency:*** 1 second for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "exchange_name": "BINANCE", // Exchange name
      "symbol": "BTCUSDT", // Trading pair symbol
      "base_asset": "BTC", // Base asset
      "price": 87535.9, // Liquidation price
      "usd_value": 205534.2932, // Transaction amount (USD)
      "side": 2, // Order direction (1: Buy, 2: Sell)
      "time": 1745216319263 // Timestamp
    },
    {
      "exchange_name": "BINANCE", // Exchange name
      "symbol": "BTCUSDT", // Trading pair symbol
      "base_asset": "BTC", // Base asset
      "price": 87465.2, // Liquidation price
      "usd_value": 15918.6664, // Transaction amount (USD)
      "side": 2, // Order direction (1: Buy, 2: Sell)
      "time": 1745215647165 // Timestamp
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
    "/api/futures/liquidation/order": {
      "get": {
        "summary": "Liquidation Order",
        "description": "This API retrieves liquidation orders within the past 7 days, including details about the specific exchange, trading pairs, and liquidation amounts",
        "operationId": "liquidation-order",
        "parameters": [
          {
            "name": "exchange",
            "in": "query",
            "required": true,
            "description": "Exchange name (e.g., Binance, OKX). Retrieve supported exchanges via the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "Binance"
            }
          },
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC). Retrieve supported coins via the 'supported-coins' API.",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "min_liquidation_amount",
            "in": "query",
            "required": true,
            "description": "Minimum threshold for liquidation events.  Max 200 records per request.",
            "schema": {
              "type": "string",
              "default": "10000"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"exchange_name\": \"BINANCE\", // Exchange name\n      \"symbol\": \"BTCUSDT\", // Trading pair symbol\n      \"base_asset\": \"BTC\", // Base asset\n      \"price\": 87535.9, // Liquidation price\n      \"usd_value\": 205534.2932, // Transaction amount (USD)\n      \"side\": 2, // Order direction (1: Buy, 2: Sell)\n      \"time\": 1745216319263 // Timestamp\n    },\n    {\n      \"exchange_name\": \"BINANCE\", // Exchange name\n      \"symbol\": \"BTCUSDT\", // Trading pair symbol\n      \"base_asset\": \"BTC\", // Base asset\n      \"price\": 87465.2, // Liquidation price\n      \"usd_value\": 15918.6664, // Transaction amount (USD)\n      \"side\": 2, // Order direction (1: Buy, 2: Sell)\n      \"time\": 1745215647165 // Timestamp\n    }\n  ]\n}\n"
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