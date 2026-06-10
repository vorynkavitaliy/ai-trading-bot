# Global Account Ratio

This endpoint provides the long/short account ratio history for trading pairs on a specific exchange.

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
      "time": 1741604400000, // Timestamp (in milliseconds)
      "global_account_long_percent": 73.88, // Long position percentage of accounts (%)
      "global_account_short_percent": 26.12, // Short position percentage of accounts (%)
      "global_account_long_short_ratio": 2.83 // Long/Short ratio of accounts
    },
    {
      "time": 1741608000000, // Timestamp (in milliseconds)
      "global_account_long_percent": 73.24, // Long position percentage of accounts (%)
      "global_account_short_percent": 26.76, // Short position percentage of accounts (%)
      "global_account_long_short_ratio": 2.74 // Long/Short ratio of accounts
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
    "/api/futures/global-long-short-account-ratio/history": {
      "get": {
        "summary": "Global Account Ratio",
        "description": "This API retrieves the long/short account ratio for trading pairs on an exchange",
        "operationId": "global-longshort-account-ratio",
        "parameters": [
          {
            "name": "exchange",
            "in": "query",
            "required": true,
            "description": "Futures exchange names (e.g., Binance, OKX) .Retrieve supported exchanges via the 'supported-exchange-pair' API.",
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
            "name": "interval",
            "in": "query",
            "required": true,
            "description": "Time interval for data aggregation.  Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w",
            "schema": {
              "type": "string",
              "default": "4h"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Number of results per request.  Default: 1000, Maximum: 1000",
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1741604400000, // Timestamp (in milliseconds)\n      \"global_account_long_percent\": 73.88, // Long position percentage of accounts (%)\n      \"global_account_short_percent\": 26.12, // Short position percentage of accounts (%)\n      \"global_account_long_short_ratio\": 2.83 // Long/Short ratio of accounts\n    },\n    {\n      \"time\": 1741608000000, // Timestamp (in milliseconds)\n      \"global_account_long_percent\": 73.24, // Long position percentage of accounts (%)\n      \"global_account_short_percent\": 26.76, // Short position percentage of accounts (%)\n      \"global_account_long_short_ratio\": 2.74 // Long/Short ratio of accounts\n    }\n  ]\n}\n"
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
        "deprecated": false,
        "security": [
          {
            "sec0": []
          }
        ]
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