> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Aggregated Stablecoin Margin History (OHLC)

This endpoint provides aggregated stablecoin-margined open interest data in OHLC (open, high, low, close) candlestick format.

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
      "time": 2644845344000, // Timestamp (ms)
      "open": "2644845344",   // Open interest at interval start
      "high": "2692643311",   // Highest open interest during interval
      "low": "2576975597",    // Lowest open interest during interval
      "close": "2608846475"   // Open interest at interval end
    },
    {
      "time": 2608846475000, // Timestamp (ms)
      "open": "2608846475",  // Open interest at interval start
      "high": "2620807645",  // Highest open interest during interval
      "low": "2327236202",   // Lowest open interest during interval
      "close": "2340177420"  // Open interest at interval end
    },
    ....
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
    "/api/futures/open-interest/aggregated-stablecoin-history": {
      "get": {
        "summary": "OHLC Aggregated Stablecoin Margin History",
        "description": "This API presents aggregated stablecoin margin open interest data using OHLC (Open, High, Low, Close) candlestick charts.",
        "operationId": "oi-ohlc-aggregated-stablecoin-margin-history",
        "parameters": [
          {
            "name": "exchange_list",
            "in": "query",
            "required": true,
            "description": "Comma-separated exchange names (e.g., \"Binance,OKX,Bybit\"). Retrieve supported exchanges via the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "Binance"
            }
          },
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC).Retrieve supported coins via the 'supported-coins' API.",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "interval",
            "in": "query",
            "required": true,
            "description": "Time interval for data aggregation.Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w",
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 2644845344000, // Timestamp (ms)\n      \"open\": \"2644845344\",   // Open interest at interval start\n      \"high\": \"2692643311\",   // Highest open interest during interval\n      \"low\": \"2576975597\",    // Lowest open interest during interval\n      \"close\": \"2608846475\"   // Open interest at interval end\n    },\n    {\n      \"time\": 2608846475000, // Timestamp (ms)\n      \"open\": \"2608846475\",  // Open interest at interval start\n      \"high\": \"2620807645\",  // Highest open interest during interval\n      \"low\": \"2327236202\",   // Lowest open interest during interval\n      \"close\": \"2340177420\"  // Open interest at interval end\n    },\n    ....\n  ]\n}\n"
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