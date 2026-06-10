> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Bitfinex Margin Long/Short

This endpoint provides data on margin long and short positions from Bitfinex.

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
      "time": 1658880000,              // Timestamp, representing the data's corresponding time point
      "long_quantity": 104637.94,       // Long position quantity
      "short_quantity": 2828.53        // Short position quantity
    },
    {
      "time": 1658966400,              // Timestamp, representing the data's corresponding time point
      "long_quantity": 105259.46,       // Long position quantity
      "short_quantity": 2847.84        // Short position quantity
    }
    // More data entries...
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
    "/api/bitfinex-margin-long-short": {
      "get": {
        "summary": "Bitfinex Margin Long/Short",
        "description": "This API retrieves data on margin long and short positions from Bitfinex.",
        "operationId": "bitfinex-margin-long-short",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "description": "BTC,ETH",
            "required": true,
            "schema": {
              "type": "string",
              "default": "BTC"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1658880000,              // Timestamp, representing the data's corresponding time point\n      \"long_quantity\": 104637.94,       // Long position quantity\n      \"short_quantity\": 2828.53        // Short position quantity\n    },\n    {\n      \"time\": 1658966400,              // Timestamp, representing the data's corresponding time point\n      \"long_quantity\": 105259.46,       // Long position quantity\n      \"short_quantity\": 2847.84        // Short position quantity\n    }\n    // More data entries...\n  ]\n}\n"
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