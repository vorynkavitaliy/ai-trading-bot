# Arbitrage

This endpoint provides funding rate arbitrage data across exchanges for futures cryptocurrencies.

***Cache / Update Frequency:*** 20 second for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "symbol": "SUPRA", // Token symbol
      "buy": { //  (lower funding rate)
        "exchange": "MEXC", // Exchange name
        "open_interest_usd": 848218.2833, // Open interest in USD on the exchange
        "funding_rate_interval": 4, // Funding rate interval (hours)
        "funding_rate": -0.994 // Current funding rate (%)
      },
      "sell": { //  (higher funding rate)
        "exchange": "Gate.io", // Exchange name
        "open_interest_usd": 448263.5072, // Open interest in USD on the exchange
        "funding_rate_interval": 4, // Funding rate interval (hours)
        "funding_rate": 0.005 // Current funding rate (%)
      },
      "apr": 2187.81, // Annual Percentage Rate (APR, %)
      "funding": 0.999, // Funding rate difference (between long and short)
      "fee": 0.03, // Total trading fee (both sides)
      "spread": -0.09, // Price spread between platforms (%)
      "next_funding_time": 1745222400000 // Next funding settlement time (timestamp in milliseconds)
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
    "/api/futures/funding-rate/arbitrage": {
      "get": {
        "summary": "Arbitrage",
        "description": "",
        "operationId": "fr-arbitrage",
        "parameters": [
          {
            "name": "usd",
            "in": "query",
            "required": true,
            "description": "Investment principal for arbitrage (e.g., 10000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": 10000
            }
          },
          {
            "in": "query",
            "name": "exchange_list",
            "schema": {
              "type": "string"
            },
            "description": "List of exchange names to retrieve data from (e.g.,  'Binance,OKX,Bybit')"
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"SUPRA\", // Token symbol\n      \"buy\": { // Suggested long platform (lower funding rate)\n        \"exchange\": \"MEXC\", // Exchange name\n        \"open_interest_usd\": 848218.2833, // Open interest in USD on the exchange\n        \"funding_rate_interval\": 4, // Funding rate interval (hours)\n        \"funding_rate\": -0.994 // Current funding rate (%)\n      },\n      \"sell\": { // Suggested short platform (higher funding rate)\n        \"exchange\": \"Gate.io\", // Exchange name\n        \"open_interest_usd\": 448263.5072, // Open interest in USD on the exchange\n        \"funding_rate_interval\": 4, // Funding rate interval (hours)\n        \"funding_rate\": 0.005 // Current funding rate (%)\n      },\n      \"apr\": 2187.81, // Annual Percentage Rate (APR, %)\n      \"funding\": 0.999, // Funding rate difference (between long and short)\n      \"fee\": 0.03, // Total trading fee (both sides)\n      \"spread\": -0.09, // Price spread between platforms (%)\n      \"next_funding_time\": 1745222400000 // Next funding settlement time (timestamp in milliseconds)\n    }\n  ]\n}\n"
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