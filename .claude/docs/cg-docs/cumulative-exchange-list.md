> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Cumulative Exchange List

This endpoint provides cumulative funding rate data from exchanges.

***Cache / Update Frequency:*** 1 hour for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "symbol": "BTC", // Symbol
      "stablecoin_margin_list": [ // Accumulated funding rate for USDT/USD margin mode
        {
          "exchange": "BINANCE", // Exchange name
          "funding_rate": 0.001873 // Accumulated funding rate
        },
        {
          "exchange": "OKX", // Exchange name
          "funding_rate": 0.00775484 // Accumulated funding rate
        }
      ],

      "token_margin_list": [ // Accumulated funding rate for coin-margined mode
        {
          "exchange": "BINANCE", // Exchange name
          "funding_rate": -0.003149 // Accumulated funding rate
        }
      ]
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
    "/api/futures/funding-rate/accumulated-exchange-list": {
      "get": {
        "summary": "Cumulative Exchange List",
        "description": "This API retrieves cumulative funding rate data from exchanges.",
        "operationId": "cumulative-exchange-list",
        "parameters": [
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for the data (e.g.,1d, 7d, 30d, 365d).",
            "schema": {
              "type": "string",
              "default": "1d"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"BTC\", // Symbol\n      \"stablecoin_margin_list\": [ // Accumulated funding rate for USDT/USD margin mode\n        {\n          \"exchange\": \"BINANCE\", // Exchange name\n          \"funding_rate\": 0.001873 // Accumulated funding rate\n        },\n        {\n          \"exchange\": \"OKX\", // Exchange name\n          \"funding_rate\": 0.00775484 // Accumulated funding rate\n        }\n      ],\n\n      \"token_margin_list\": [ // Accumulated funding rate for coin-margined mode\n        {\n          \"exchange\": \"BINANCE\", // Exchange name\n          \"funding_rate\": -0.003149 // Accumulated funding rate\n        }\n      ]\n    }\n  ]\n}\n"
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