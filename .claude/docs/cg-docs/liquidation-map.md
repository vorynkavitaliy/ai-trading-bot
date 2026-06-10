# Pair Liquidation Map

This endpoint provides a mapped visualization of liquidation events for trading pairs, calculated based on market data and liquidation leverage levels.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ❌        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": 
  {
    "data": 
    {
      "48935": //liquidation price
      [
        [
          48935,//liquidation price
          1579370.77,//Liquidation Level
          25,//Leverage Ratio
          null
        ]
      ],
      ...  
    }
  }
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
    "/api/futures/liquidation/map": {
      "get": {
        "summary": "Pair Liquidation Map",
        "description": "This endpoint provides a mapped visualization of liquidation events for trading pairs, calculated based on market data and liquidation leverage levels.",
        "operationId": "liquidation-map",
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
          },
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for data aggregation. Supported values: 1d, 7d, 30d,180d,365d",
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
                    "value": "{}"
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