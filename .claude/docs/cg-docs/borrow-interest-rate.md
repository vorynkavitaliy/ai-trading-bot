> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Borrow Interest Rate

This endpoint provides daily borrowing interest rates for cryptocurrencies.

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
  "data": [
    {
      "time": 1741636800,                  // Timestamp (in seconds)
      "interest_rate": 0.002989            // daily Interest rate
    },
    {
      "time": 1741640400,                  // Timestamp (in seconds)
      "interest_rate": 0.002989            // daily Interest rate
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
    "/api/borrow-interest-rate/history": {
      "get": {
        "summary": "Borrow Interest Rate",
        "description": "The API retrieves borrowing interest rates for cryptocurrencies.",
        "operationId": "borrow-interest-rate",
        "parameters": [
          {
            "name": "exchange",
            "in": "query",
            "required": true,
            "description": "Exchange name  support:Binance ,OKX,Bybit ",
            "schema": {
              "type": "string",
              "default": "Binance"
            }
          },
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
            "description": "Data aggregation time interval. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w.",
            "schema": {
              "type": "string",
              "default": "h1"
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
              "default": 500
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": " Start timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": 1706089927315
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
                    "value": "{\n  \"code\": \"0\",                             \n  \"msg\": \"success\",                         \n  \"data\": [\n    {\n      \"time\": 1741636800,                  // Timestamp (in seconds)\n      \"interest_rate\": 0.002989            // Interest rate\n    },\n    {\n      \"time\": 1741640400,                  // Timestamp (in seconds)\n      \"interest_rate\": 0.002989            // Interest rate\n    }\n  ]\n}\n"
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