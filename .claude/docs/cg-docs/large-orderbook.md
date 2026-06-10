> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Large Open Orders (Order Book)

This endpoint provides large open limit orders from the current order book for futures trading.(thresholds: BTC ≥ 1M, ETH ≥ 500K, Other ≥ 50K)

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data":[
  {
    "id": 2868159989,
    "exchange_name": "Binance",            // Exchange name
    "symbol": "BTCUSDT",                   // Trading pair
    "base_asset": "BTC",                   // Base asset
    "quote_asset": "USDT",                 // Quote asset

    "price": 56932,                  // Order price
    "start_time": 1722964242000,           // Order start time (ms)
    "start_quantity": 28.39774,            // Initial order quantity
    "start_usd_value": 1616740.1337,       // Initial USD value

    "current_quantity": 18.77405,          // Current remaining quantity
    "current_usd_value": 1068844.21,       // Current USD value
    "current_time": 1722964272000,         // Current time (ms)

    "executed_volume": 0,                  // Executed volume
    "executed_usd_value": 0,               // Executed USD value
    "trade_count": 0,                      // Number of trades

    "order_side": 2,                       // Order side: 1 - Sell, 2 - Buy
    "order_state": 1                       // Order state: 1 - Open, 2 - Filled, 3      - Canceled
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
    "/api/futures/orderbook/large-limit-order": {
      "get": {
        "summary": "Large Orderbook",
        "description": "The API retrieves large open orders from the current order book for futures trading.",
        "operationId": "large-orderbook",
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
            "description": "Trading pair (e.g., BTCUSDT). Retrieve supported pair via the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
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
                    "value": "[\n  {\n    \"id\": 2868159989,\n    \"exchange_name\": \"Binance\",            // Exchange name\n    \"symbol\": \"BTCUSDT\",                   // Trading pair\n    \"base_asset\": \"BTC\",                   // Base asset\n    \"quote_asset\": \"USDT\",                 // Quote asset\n\n    \"price\": 56932,                  // Order price\n    \"start_time\": 1722964242000,           // Order start time (ms)\n    \"start_quantity\": 28.39774,            // Initial order quantity\n    \"start_usd_value\": 1616740.1337,       // Initial USD value\n\n    \"current_quantity\": 18.77405,          // Current remaining quantity\n    \"current_usd_value\": 1068844.21,       // Current USD value\n    \"current_time\": 1722964272000,         // Current time (ms)\n\n    \"executed_volume\": 0,                  // Executed volume\n    \"executed_usd_value\": 0,               // Executed USD value\n    \"trade_count\": 0,                      // Number of trades\n\n    \"order_side\": 2,                       // Order side: 1 - Sell, 2 - Buy\n    \"order_state\": 1                       // Order state: 1 - Open, 2 - Filled, 3 - Canceled\n  }\n]\n"
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