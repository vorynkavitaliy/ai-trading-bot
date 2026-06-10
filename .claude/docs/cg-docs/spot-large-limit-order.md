# Large Orderbook

This endpoint provides large open limit orders from the current order book for spot trading.(thresholds: BTC ≥ 350K, ETH ≥ 250K, Other ≥ 10K)

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
  "data": [
    {
      "id": 2536823422,
      "exchange_name": "Binance",                // Exchange name
      "symbol": "BTCUSDT",                       // Trading pair
      "base_asset": "BTC",                       // Base asset
      "quote_asset": "USDT",                     // Quote asset
      "price": 20000,                            // Order price
      "start_time": 1742615617000,               // Order start time (timestamp)
      "start_quantity": 109.42454,               // Initial quantity
      "start_usd_value": 2188490.8,              // Initial order value in USD
      "current_quantity": 104.00705,             // Current remaining quantity
      "current_usd_value": 2080141,              // Current remaining value in USD
      "current_time": 1745287267958,             // Current update time (timestamp)
      "executed_volume": 0,                      // Executed volume
      "executed_usd_value": 0,                   // Executed value in USD
      "trade_count": 0,                          // Number of executed trades
      "order_side": 2,                           // Order side: 1 = Buy, 2 = Sell
      "order_state": 1                           // Order state: 1 = Active, 2 = Completed
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
    "/api/spot/orderbook/large-limit-order": {
      "get": {
        "description": "",
        "operationId": "get_apispotorderbooklarge-limit-order",
        "responses": {
          "200": {
            "description": "",
            "content": {
              "application/json": {
                "examples": {
                  "New Example": {
                    "summary": "New Example",
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"id\": 2536823422,\n      \"exchange_name\": \"Binance\",                // Exchange name\n      \"symbol\": \"BTCUSDT\",                       // Trading pair\n      \"base_asset\": \"BTC\",                       // Base asset\n      \"quote_asset\": \"USDT\",                     // Quote asset\n      \"price\": 20000,                            // Order price\n      \"start_time\": 1742615617000,               // Order start time (timestamp)\n      \"start_quantity\": 109.42454,               // Initial quantity\n      \"start_usd_value\": 2188490.8,              // Initial order value in USD\n      \"current_quantity\": 104.00705,             // Current remaining quantity\n      \"current_usd_value\": 2080141,              // Current remaining value in USD\n      \"current_time\": 1745287267958,             // Current update time (timestamp)\n      \"executed_volume\": 0,                      // Executed volume\n      \"executed_usd_value\": 0,                   // Executed value in USD\n      \"trade_count\": 0,                          // Number of executed trades\n      \"order_side\": 2,                           // Order side: 1 = Buy, 2 = Sell\n      \"order_state\": 1                           // Order state: 1 = Active, 2 = Completed\n    }\n  ]\n}\n"
                  }
                }
              }
            }
          }
        },
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