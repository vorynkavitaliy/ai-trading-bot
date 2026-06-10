# Large Orderbook History

This endpoint provides completed historical large limit orders from the order book for futures trading.(thresholds: BTC ≥ 350K, ETH ≥ 250K, Other ≥ 10K)

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
      "id": 2895605135,
      "exchange_name": "Binance",               // Exchange name
      "symbol": "BTCUSDT",                      // Trading pair
      "base_asset": "BTC",                      // Base asset
      "quote_asset": "USDT",                    // Quote asset
      "price": 89205.9,                         // Order price
      "start_time": 1745287309000,              // Order start time (milliseconds)
      "start_quantity": 25.779,                 // Initial order quantity
      "start_usd_value": 2299638.8961,          // Initial order value (USD)
      "current_quantity": 25.779,               // Remaining quantity
      "current_usd_value": 2299638.8961,        // Remaining value (USD)
      "current_time": 1745287309000,            // Current timestamp (milliseconds)
      "executed_volume": 0,                     // Executed volume
      "executed_usd_value": 0,                  // Executed value (USD)
      "trade_count": 0,                         // Number of trades executed
      "order_side": 1,                          // Order side: 1 = Sell, 2 = Buy
      "order_state": 2,                         // Order state:2 = Filled
      "order_end_time": 1745287328000           // Order end time (milliseconds),start_time and end_time filter by order_end_time.
    }
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
    "/api/spot/orderbook/v2/large-limit-order-history": {
      "get": {
        "description": "This endpoint provides completed historical large limit orders from the order book for futures trading.(thresholds: BTC ≥ 350K, ETH ≥ 250K, Other ≥ 10K)",
        "operationId": "spot-large-orderbook-history",
        "responses": {
          "200": {
            "description": ""
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
            "description": "Trading pair (e.g., BTCUSDT). Check supported pairs through the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": true,
            "description": "Start timestamp in milliseconds (e.g., 1723625037000).",
            "schema": {
              "type": "string",
              "default": ""
            }
          },
          {
            "name": "end_time",
            "in": "query",
            "required": true,
            "description": "End timestamp in milliseconds (e.g., 1723626037000).",
            "schema": {
              "type": "string",
              "default": ""
            }
          },
          {
            "name": "state",
            "in": "query",
            "required": true,
            "description": "Order status description: 2: Finished; 3: Revoked (filled amount is 0)",
            "schema": {
              "type": "string",
              "default": "2"
            }
          }
        ],
        "summary": "Large Orderbook History"
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