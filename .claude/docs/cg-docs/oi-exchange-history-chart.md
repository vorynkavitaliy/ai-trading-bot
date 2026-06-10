# Exchange History Chart

This endpoint retrieves historical open interest data for a specific cryptocurrency across exchanges, formatted for chart display.

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
  "data": {
    "time_list": [1721649600000, ...], // List of timestamps (in milliseconds)
    "price_list": [67490.3, ...], // List of prices corresponding to each timestamp

    "data_map": { // Open interest data of futures from each exchange
      "Binance": [8018229234, ...], // Binance open interest (corresponds to time_list)
      "Bitmex": [395160842, ...] // BitMEX open interest (corresponds to time_list)
      // ...
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
    "/api/futures/open-interest/exchange-history-chart": {
      "get": {
        "summary": "Exchange History Chart",
        "description": "This API retrieves historical open interest data for a cryptocurrency from exchanges, and the data is formatted for chart presentation.",
        "operationId": "oi-exchange-history-chart",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC).  Check supported coins through the 'supported-coins' API.",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for the data (e.g., all, 1m, 15m, 1h, 4h, 12h).",
            "schema": {
              "type": "string",
              "default": "12h"
            }
          },
          {
            "name": "unit",
            "in": "query",
            "required": false,
            "description": "Unit for the returned data, choose between 'usd' or 'coin'.",
            "schema": {
              "type": "string",
              "default": "usd"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"time_list\": [1721649600000, ...], // List of timestamps (in milliseconds)\n    \"price_list\": [67490.3, ...], // List of prices corresponding to each timestamp\n\n    \"data_map\": { // Open interest data of futures from each exchange\n      \"Binance\": [8018229234, ...], // Binance open interest (corresponds to time_list)\n      \"Bitmex\": [395160842, ...] // BitMEX open interest (corresponds to time_list)\n      // ...\n    }\n  }\n}\n"
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