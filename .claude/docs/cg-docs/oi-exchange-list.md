# Exchange List

This endpoint provides open interest data for a specific coin across multiple exchanges.

***Cache / Update Frequency:*** 10 second for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

<br />

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "exchange": "All", // Exchange name; "All" means aggregated across all exchanges
      "symbol": "BTC", // Token symbol

      "open_interest_usd": 57437891724.5572, // Total open interest value in USD
      "open_interest_quantity": 659557.3064, // Total open interest quantity

      "open_interest_by_stable_coin_margin": 48920274435.15, // Open interest value in USD for stablecoin-margined futures
      "open_interest_quantity_by_coin_margin": 97551.2547, // Open interest quantity for coin-margined futures
      "open_interest_quantity_by_stable_coin_margin": 562006.0517, // Open interest quantity for stablecoin-margined futures

      "open_interest_change_percent_5m": 0.34, // Open interest change (%) in the last 5 minutes
      "open_interest_change_percent_15m": 0.59, // Open interest change (%) in the last 15 minutes
      "open_interest_change_percent_30m": 1.42, // Open interest change (%) in the last 30 minutes
      "open_interest_change_percent_1h": 2.27, // Open interest change (%) in the last 1 hour
      "open_interest_change_percent_4h": 2.95, // Open interest change (%) in the last 4 hours
      "open_interest_change_percent_24h": 0.9 // Open interest change (%) in the last 24 hours
    },
    {
      "exchange": "CME", // Exchange name
      "symbol": "BTC", // Token symbol

      "open_interest_usd": 12294999402.5, // Total open interest value in USD
      "open_interest_quantity": 141275.5, // Total open interest quantity

      "open_interest_by_stable_coin_margin": 12294999402.5, // Open interest value in USD for stablecoin-margined futures
      "open_interest_quantity_by_coin_margin": 0, // Open interest quantity for coin-margined futures
      "open_interest_quantity_by_stable_coin_margin": 141275.5, // Open interest quantity for stablecoin-margined futures

      "open_interest_change_percent_5m": 0.08, // Open interest change (%) in the last 5 minutes
      "open_interest_change_percent_15m": 0.14, // Open interest change (%) in the last 15 minutes
      "open_interest_change_percent_30m": 0.49, // Open interest change (%) in the last 30 minutes
      "open_interest_change_percent_1h": 1.13, // Open interest change (%) in the last 1 hour
      "open_interest_change_percent_4h": 2.4, // Open interest change (%) in the last 4 hours
      "open_interest_change_percent_24h": 2.08 // Open interest change (%) in the last 24 hours
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
    "/api/futures/open-interest/exchange-list": {
      "get": {
        "summary": "Exchange List",
        "description": "This API retrieves open interest data for a coin from exchanges",
        "operationId": "oi-exchange-list",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC).Retrieve supported coins via the 'supported-coins' API.",
            "schema": {
              "type": "string",
              "default": "BTC"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"exchange\": \"All\", // Exchange name; \"All\" means aggregated across all exchanges\n      \"symbol\": \"BTC\", // Token symbol\n\n      \"open_interest_usd\": 57437891724.5572, // Total open interest value in USD\n      \"open_interest_quantity\": 659557.3064, // Total open interest quantity\n\n      \"open_interest_by_stable_coin_margin\": 48920274435.15, // Open interest value in USD for stablecoin-margined futures\n      \"open_interest_quantity_by_coin_margin\": 97551.2547, // Open interest quantity for coin-margined futures\n      \"open_interest_quantity_by_stable_coin_margin\": 562006.0517, // Open interest quantity for stablecoin-margined futures\n\n      \"open_interest_change_percent_5m\": 0.34, // Open interest change (%) in the last 5 minutes\n      \"open_interest_change_percent_15m\": 0.59, // Open interest change (%) in the last 15 minutes\n      \"open_interest_change_percent_30m\": 1.42, // Open interest change (%) in the last 30 minutes\n      \"open_interest_change_percent_1h\": 2.27, // Open interest change (%) in the last 1 hour\n      \"open_interest_change_percent_4h\": 2.95, // Open interest change (%) in the last 4 hours\n      \"open_interest_change_percent_24h\": 0.9 // Open interest change (%) in the last 24 hours\n    },\n    {\n      \"exchange\": \"CME\", // Exchange name\n      \"symbol\": \"BTC\", // Token symbol\n\n      \"open_interest_usd\": 12294999402.5, // Total open interest value in USD\n      \"open_interest_quantity\": 141275.5, // Total open interest quantity\n\n      \"open_interest_by_stable_coin_margin\": 12294999402.5, // Open interest value in USD for stablecoin-margined futures\n      \"open_interest_quantity_by_coin_margin\": 0, // Open interest quantity for coin-margined futures\n      \"open_interest_quantity_by_stable_coin_margin\": 141275.5, // Open interest quantity for stablecoin-margined futures\n\n      \"open_interest_change_percent_5m\": 0.08, // Open interest change (%) in the last 5 minutes\n      \"open_interest_change_percent_15m\": 0.14, // Open interest change (%) in the last 15 minutes\n      \"open_interest_change_percent_30m\": 0.49, // Open interest change (%) in the last 30 minutes\n      \"open_interest_change_percent_1h\": 1.13, // Open interest change (%) in the last 1 hour\n      \"open_interest_change_percent_4h\": 2.4, // Open interest change (%) in the last 4 hours\n      \"open_interest_change_percent_24h\": 2.08 // Open interest change (%) in the last 24 hours\n    }\n  ]\n}\n"
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