# Exchange List

This endpoint provides funding rate data from exchanges.

***Cache / Update Frequency:*** 20 second for all the API plans.

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
      "stablecoin_margin_list": [ // USDT/USD margin mode
        {
          "exchange": "Binance", // Exchange
          "funding_rate_interval": 8, // Funding rate interval (hours)
          "funding_rate": 0.007343, // Current funding rate
          "next_funding_time": 1745222400000 // Next funding time (milliseconds)
        },
        {
          "exchange": "OKX", // Exchange
          "funding_rate_interval": 8, // Funding rate interval (hours)
          "funding_rate": 0.00736901950628, // Current funding rate
          "next_funding_time": 1745222400000 // Next funding time (milliseconds)
        }
      ],
      "token_margin_list": [ // Coin-margined mode
        {
          "exchange": "Binance", // Exchange
          "funding_rate_interval": 8, // Funding rate interval (hours)
          "funding_rate": -0.001829, // Current funding rate
          "next_funding_time": 1745222400000 // Next funding time (milliseconds)
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
    "/api/futures/funding-rate/exchange-list": {
      "get": {
        "summary": "Exchange List",
        "description": "This API retrieves funding rate data from exchanges",
        "operationId": "fr-exchange-list",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"BTC\", // Symbol\n      \"stablecoin_margin_list\": [ // USDT/USD margin mode\n        {\n          \"exchange\": \"Binance\", // Exchange\n          \"funding_rate_interval\": 8, // Funding rate interval (hours)\n          \"funding_rate\": 0.007343, // Current funding rate\n          \"next_funding_time\": 1745222400000 // Next funding time (milliseconds)\n        },\n        {\n          \"exchange\": \"OKX\", // Exchange\n          \"funding_rate_interval\": 8, // Funding rate interval (hours)\n          \"funding_rate\": 0.00736901950628, // Current funding rate\n          \"next_funding_time\": 1745222400000 // Next funding time (milliseconds)\n        }\n      ],\n      \"token_margin_list\": [ // Coin-margined mode\n        {\n          \"exchange\": \"Binance\", // Exchange\n          \"funding_rate_interval\": 8, // Funding rate interval (hours)\n          \"funding_rate\": -0.001829, // Current funding rate\n          \"next_funding_time\": 1745222400000 // Next funding time (milliseconds)\n        }\n      ]\n    }\n  ]\n}\n"
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