# Top Account Ratio History

This endpoint provides historical data for the long/short account ratio of top traders.

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
      "time": 1741615200000, // Timestamp (in milliseconds)
      "top_account_long_percent": 73.3, // Long position percentage of top accounts (%)
      "top_account_short_percent": 26.7, // Short position percentage of top accounts (%)
      "top_account_long_short_ratio": 2.75 // Long/Short ratio of top accounts
    },
    {
      "time": 1741618800000, // Timestamp (in milliseconds)
      "top_account_long_percent": 74.18, // Long position percentage of top accounts (%)
      "top_account_short_percent": 25.82, // Short position percentage of top accounts (%)
      "top_account_long_short_ratio": 2.87 // Long/Short ratio of top accounts
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
    "/api/futures/top-long-short-account-ratio/history": {
      "get": {
        "summary": "Top Account Ratio History",
        "description": "This API retrieves historical data for the long/short ratio of top accounts.",
        "operationId": "top-longshort-account-ratio",
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1741615200000, // Timestamp (in milliseconds)\n      \"top_account_long_percent\": 73.3, // Long position percentage of top accounts (%)\n      \"top_account_short_percent\": 26.7, // Short position percentage of top accounts (%)\n      \"top_account_long_short_ratio\": 2.75 // Long/Short ratio of top accounts\n    },\n    {\n      \"time\": 1741618800000, // Timestamp (in milliseconds)\n      \"top_account_long_percent\": 74.18, // Long position percentage of top accounts (%)\n      \"top_account_short_percent\": 25.82, // Short position percentage of top accounts (%)\n      \"top_account_long_short_ratio\": 2.87 // Long/Short ratio of top accounts\n    }\n  ]\n}\n"
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