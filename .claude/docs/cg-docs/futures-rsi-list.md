> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin RSI List

This endpoint provides the Relative Strength Index (RSI) values for multiple cryptocurrencies across different timeframes.

***Cache / Update Frequency:*** Updates every 10 seconds

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
      "symbol": "BTC",                                  // Token symbol, e.g., BTC = Bitcoin
      "rsi_15m": 54.71,                                 // RSI (Relative Strength Index) over 15 minutes
      "price_change_percent_15m": 0.04,                 // Price change percentage over 15 minutes
      "rsi_1h": 71.91,                                  // RSI over 1 hour
      "price_change_percent_1h": -0.23,                 // Price change percentage over 1 hour
      "rsi_4h": 72.12,                                  // RSI over 4 hours
      "price_change_percent_4h": -0.09,                 // Price change percentage over 4 hours
      "rsi_12h": 62.33,                                 // RSI over 12 hours
      "price_change_percent_12h": 2.72,                 // Price change percentage over 12 hours
      "rsi_24h": 57.88,                                 // RSI over 24 hours
      "price_change_percent_24h": 3.4,                  // Price change percentage over 24 hours
      "rsi_1w": 52.04,                                  // RSI over 1 week
      "price_change_percent_1w": 2.6,                   // Price change percentage over 1 week
      "current_price": 87348.6                          // Current market price
    },
    {
      "symbol": "ETH",                                  // Token symbol, e.g., ETH = Ethereum
      "rsi_15m": 54.35,                                 // RSI over 15 minutes
      "price_change_percent_15m": -0.13,                // Price change percentage over 15 minutes
      "rsi_1h": 67.93,                                  // RSI over 1 hour
      "price_change_percent_1h": -0.26,                 // Price change percentage over 1 hour
      "rsi_4h": 63.6,                                   // RSI over 4 hours
      "price_change_percent_4h": 0.2,                   // Price change percentage over 4 hours
      "rsi_12h": 52.09,                                 // RSI over 12 hours
      "price_change_percent_12h": 3.41,                 // Price change percentage over 12 hours
      "rsi_24h": 45.03,                                 // RSI over 24 hours
      "price_change_percent_24h": 3.27,                 // Price change percentage over 24 hours
      "rsi_1w": 33.31,                                  // RSI over 1 week
      "price_change_percent_1w": 3.45,                  // Price change percentage over 1 week
      "current_price": 1641.36                          // Current market price
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
    "/api/futures/rsi/list": {
      "get": {
        "summary": "RSI List",
        "description": "The API retrieves Relative Strength Index (RSI) values for multiple cryptocurrencies over different timeframes",
        "operationId": "futures-rsi-list",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"BTC\",                                  // Token symbol, e.g., BTC = Bitcoin\n      \"rsi_15m\": 54.71,                                 // RSI (Relative Strength Index) over 15 minutes\n      \"price_change_percent_15m\": 0.04,                 // Price change percentage over 15 minutes\n      \"rsi_1h\": 71.91,                                  // RSI over 1 hour\n      \"price_change_percent_1h\": -0.23,                 // Price change percentage over 1 hour\n      \"rsi_4h\": 72.12,                                  // RSI over 4 hours\n      \"price_change_percent_4h\": -0.09,                 // Price change percentage over 4 hours\n      \"rsi_12h\": 62.33,                                 // RSI over 12 hours\n      \"price_change_percent_12h\": 2.72,                 // Price change percentage over 12 hours\n      \"rsi_24h\": 57.88,                                 // RSI over 24 hours\n      \"price_change_percent_24h\": 3.4,                  // Price change percentage over 24 hours\n      \"rsi_1w\": 52.04,                                  // RSI over 1 week\n      \"price_change_percent_1w\": 2.6,                   // Price change percentage over 1 week\n      \"current_price\": 87348.6                          // Current market price\n    },\n    {\n      \"symbol\": \"ETH\",                                  // Token symbol, e.g., ETH = Ethereum\n      \"rsi_15m\": 54.35,                                 // RSI over 15 minutes\n      \"price_change_percent_15m\": -0.13,                // Price change percentage over 15 minutes\n      \"rsi_1h\": 67.93,                                  // RSI over 1 hour\n      \"price_change_percent_1h\": -0.26,                 // Price change percentage over 1 hour\n      \"rsi_4h\": 63.6,                                   // RSI over 4 hours\n      \"price_change_percent_4h\": 0.2,                   // Price change percentage over 4 hours\n      \"rsi_12h\": 52.09,                                 // RSI over 12 hours\n      \"price_change_percent_12h\": 3.41,                 // Price change percentage over 12 hours\n      \"rsi_24h\": 45.03,                                 // RSI over 24 hours\n      \"price_change_percent_24h\": 3.27,                 // Price change percentage over 24 hours\n      \"rsi_1w\": 33.31,                                  // RSI over 1 week\n      \"price_change_percent_1w\": 3.45,                  // Price change percentage over 1 week\n      \"current_price\": 1641.36                          // Current market price\n    }\n  ]\n}\n"
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