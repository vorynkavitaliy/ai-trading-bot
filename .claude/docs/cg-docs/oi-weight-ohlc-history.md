> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# OI Weight History (OHLC)

This endpoint provides open interest-weighted funding rate data in OHLC (open, high, low, close) candlestick format for futures cryptocurrencies.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans          | Hobbyist | Startup  | Standard | Professional | Enterprise |
| :------------- | :------- | :------- | :------- | :----------- | :--------- |
| Available      | ✅        | ✅        | ✅        | ✅            | ✅          |
| interval Limit | ​`>=4h`  | ​`>=30m` | No Limit | No Limit     | No Limit   |

&#x20;

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "time": 1658880000000, // Timestamp (milliseconds)
      "open": "0.004603",     // Opening funding rate
      "high": "0.009388",     // Highest funding rate
      "low": "-0.005063",     // Lowest funding rate
      "close": "0.009229"     // Closing funding rate
    },
    {
      "time": 1658966400000, // Timestamp (milliseconds)
      "open": "0.009229",     // Opening funding rate
      "high": "0.01",         // Highest funding rate
      "low": "0.007794",      // Lowest funding rate
      "close": "0.01"         // Closing funding rate
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
    "/api/futures/funding-rate/oi-weight-history": {
      "get": {
        "summary": "OI Weight OHLC History",
        "description": "This API presents open interest-weight data through OHLC (Open, High, Low, Close) candlestick charts.",
        "operationId": "oi-weight-ohlc-history",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC). Retrieve supported coins via the 'supported-coins' API.",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "interval",
            "in": "query",
            "required": true,
            "description": "Time interval for data aggregation. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w",
            "schema": {
              "type": "string",
              "default": "1d"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Number of results per request. Default: 1000, Maximum: 1000",
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
            "description": "Start timestamp in seconds (e.g., 1641522717000).",
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
            "description": "End timestamp in seconds (e.g., 1641522717000).",
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1658880000000, // Timestamp (milliseconds)\n      \"open\": \"0.004603\",     // Opening funding rate\n      \"high\": \"0.009388\",     // Highest funding rate\n      \"low\": \"-0.005063\",     // Lowest funding rate\n      \"close\": \"0.009229\"     // Closing funding rate\n    },\n    {\n      \"time\": 1658966400000, // Timestamp (milliseconds)\n      \"open\": \"0.009229\",     // Opening funding rate\n      \"high\": \"0.01\",         // Highest funding rate\n      \"low\": \"0.007794\",      // Lowest funding rate\n      \"close\": \"0.01\"         // Closing funding rate\n    }\n  ]\n}"
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