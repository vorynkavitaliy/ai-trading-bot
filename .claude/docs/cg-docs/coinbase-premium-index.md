# Coinbase Premium Index

This endpoint provides the Coinbase Bitcoin Premium Index, which indicates the price difference between Bitcoin on Coinbase Pro and Binance.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans          | Hobbyist | Startup  | Standard | Professional | Enterprise |
| :------------- | :------- | :------- | :------- | :----------- | :--------- |
| Available      | ✅        | ✅        | ✅        | ✅            | ✅          |
| interval Limit | ​`>=4h`  | ​`>=30m` | No Limit | No Limit     | No Limit   |

<br />

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "time": 1658880000,         // Timestamp (in seconds)
      "premium": 5.55,            // Premium amount (USD)
      "premium_rate": 0.0261      // Premium rate (e.g., 0.0261 = 2.61%)
      "coinbase_price": 30772.93   // Close Price

    },
    {
       "time": 1658880000,         // Timestamp (in seconds)
       "premium": 5.55,            // Premium amount (USD)
       "premium_rate": 0.0261      // Premium rate (e.g., 0.0261 = 2.61%)
       "coinbase_price": 30772.93  // Close Price
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
    "/api/coinbase-premium-index": {
      "get": {
        "summary": "Coinbase Premium Index",
        "description": "This API retrieves the Coinbase Bitcoin Premium Index, indicating the price difference between Bitcoin on Coinbase Pro and Binance",
        "operationId": "coinbase-premium-index",
        "parameters": [
          {
            "name": "interval",
            "in": "query",
            "required": true,
            "description": "Data aggregation time interval. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w.",
            "schema": {
              "type": "string",
              "default": "1d"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Number of results per request. Default: 1000, Maximum: 1000.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": ""
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": ""
            }
          },
          {
            "name": "end_time",
            "in": "query",
            "required": false,
            "description": "End timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": ""
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n   \"time\": 1658880000,         // Timestamp (in seconds)\n  \"premium\": 5.55,            // Premium amount (USD)\n  \"premium_rate\": 0.0261      // Premium rate (e.g., 0.0261 = 2.61%)\n\n    },\n    {\n    \"time\": 1658880000,         // Timestamp (in seconds)\n  \"premium\": 5.55,            // Premium amount (USD)\n  \"premium_rate\": 0.0261      // Premium rate (e.g., 0.0261 = 2.61%)\n\n    }\n  ]\n}"
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