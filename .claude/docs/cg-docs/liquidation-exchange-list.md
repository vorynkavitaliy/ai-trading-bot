# Liquidation Exchange List

This endpoint provides liquidation data for a specific coin across all exchanges.

***Cache / Update Frequency:*** 10 second for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans          | Hobbyist | Startup  | Standard | Professional | Enterprise |
| :------------- | :------- | :------- | :------- | :----------- | :--------- |
| Available      | ✅        | ✅        | ✅        | ✅            | ✅          |
| interval Limit | ​`>=4h`  | ​`>=30m` | No Limit | No Limit     | No Limit   |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "exchange": "All", // Total data from all exchanges
      "liquidation_usd": 14673519.81739075, // Total liquidation amount (USD)
      "long_liquidation_usd": 451394.17404598, // Long position liquidation amount (USD)
      "short_liquidation_usd": 14222125.64334477 // Short position liquidation amount (USD)
    },
    {
      "exchange": "Bybit", // Exchange name
      "liquidation_usd": 4585290.13404, // Total liquidation amount (USD)
      "long_liquidation_usd": 104560.13885, // Long position liquidation (USD)
      "short_liquidation_usd": 4480729.99519 // Short position liquidation (USD)
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
    "/api/futures/liquidation/exchange-list": {
      "get": {
        "summary": "Liquidation Exchange List",
        "description": "This API retrieves liquidation data for coins across all exchanges",
        "operationId": "liquidation-exchange-list",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": false,
            "description": "Trading coin (e.g., BTC).  Retrieve supported coins via the 'supported-coins' API. When symbol = '', return total liquidations across all cryptocurrencies.",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for data aggregation.  Supported values: 1h, 4h, 12h, 24h.",
            "schema": {
              "type": "string",
              "default": "1h"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"exchange\": \"All\", // Total data from all exchanges\n      \"liquidation_usd\": 14673519.81739075, // Total liquidation amount (USD)\n      \"long_liquidation_usd\": 451394.17404598, // Long position liquidation amount (USD)\n      \"short_liquidation_usd\": 14222125.64334477 // Short position liquidation amount (USD)\n    },\n    {\n      \"exchange\": \"Bybit\", // Exchange name\n      \"liquidation_usd\": 4585290.13404, // Total liquidation amount (USD)\n      \"long_liquidation_usd\": 104560.13885, // Long position liquidation (USD)\n      \"short_liquidation_usd\": 4480729.99519 // Short position liquidation (USD)\n    }\n  ]\n}\n"
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