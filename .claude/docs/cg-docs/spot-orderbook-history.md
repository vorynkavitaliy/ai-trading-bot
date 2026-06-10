> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Pair Orderbook Bid&Ask(±range)

This endpoint provides historical data of the order book for spot trading, including total bid/ask volumes within a specific price range.

***Cache / Update Frequency:*** every 5 seconds for all the API plans.

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
      "bids_usd": 81639959.9338,        // Total long position amount (USD)
      "bids_quantity": 1276.645,        // Total long quantity
      "asks_usd": 78533053.6862,        // Total short position amount (USD)
      "asks_quantity": 1217.125,        // Total short quantity
      "time": 1714003200000             // Timestamp (in milliseconds)
    },
    {
      "bids_usd": 62345879.8821,
      "bids_quantity": 980.473,
      "asks_usd": 65918423.4715,
      "asks_quantity": 1021.644,
      "time": 1714089600000
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
    "/api/spot/orderbook/ask-bids-history": {
      "get": {
        "summary": "Orderbook Bid&Ask(±range)",
        "description": "The API retrieves historical data of the order book for spot trading. (https://www.coinglass.com/pro/depth-delta)",
        "operationId": "spot-orderbook-history",
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
            "description": "Trading pair (e.g., BTCUSDT). Check supported pairs through the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
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
            "description": " End timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": ""
            }
          },
          {
            "name": "range",
            "in": "query",
            "required": false,
            "description": "Depth percentage (e.g., 0.25, 0.5, 0.75, 1, 2, 3, 5, 10).",
            "schema": {
              "type": "string",
              "default": "1"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"bids_usd\": 81639959.9338,        // Total long position amount (USD)\n      \"bids_quantity\": 1276.645,        // Total long quantity\n      \"asks_usd\": 78533053.6862,        // Total short position amount (USD)\n      \"asks_quantity\": 1217.125,        // Total short quantity\n      \"time\": 1714003200000             // Timestamp (in milliseconds)\n    },\n    {\n      \"bids_usd\": 62345879.8821,\n      \"bids_quantity\": 980.473,\n      \"asks_usd\": 65918423.4715,\n      \"asks_quantity\": 1021.644,\n      \"time\": 1714089600000\n    }\n  ]\n}\n"
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