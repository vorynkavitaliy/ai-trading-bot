> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin Aggregated Orderbook Bid&Ask(±range)

This endpoint provides historical data of the aggregated order book for futures trading, including total bid/ask volumes within a specific price range.

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
      "aggregated_bids_usd": 12679537.0806,         // Aggregated long amount (USD)
      "aggregated_bids_quantity": 197.99861,        // Aggregated long quantity
      "aggregated_asks_usd": 10985519.9268,         // Aggregated short amount (USD)
      "aggregated_asks_quantity": 170.382,          // Aggregated short quantity
      "time": 1714003200000                         // Timestamp (milliseconds)
    },
    {
      "aggregated_bids_usd": 18423845.1947,
      "aggregated_bids_quantity": 265.483,
      "aggregated_asks_usd": 17384271.5521,
      "aggregated_asks_quantity": 240.785,
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
    "/api/futures/orderbook/aggregated-ask-bids-history": {
      "get": {
        "summary": "Aggregated Orderbook Bid&Ask(±range)",
        "description": "The API retrieves historical data of the aggregated order book for futures trading.(https://www.coinglass.com/pro/depth-delta)",
        "operationId": "futures-aggregated-orderbook-history",
        "parameters": [
          {
            "name": "exchange_list",
            "in": "query",
            "required": true,
            "description": "List of exchange names to retrieve data from (e.g., 'ALL', or 'Binance, OKX, Bybit')",
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
              "default": "4h"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"aggregated_bids_usd\": 12679537.0806,         // Aggregated long amount (USD)\n      \"aggregated_bids_quantity\": 197.99861,        // Aggregated long quantity\n      \"aggregated_asks_usd\": 10985519.9268,         // Aggregated short amount (USD)\n      \"aggregated_asks_quantity\": 170.382,          // Aggregated short quantity\n      \"time\": 1714003200000                         // Timestamp (milliseconds)\n    },\n    {\n      \"aggregated_bids_usd\": 18423845.1947,\n      \"aggregated_bids_quantity\": 265.483,\n      \"aggregated_asks_usd\": 17384271.5521,\n      \"aggregated_asks_quantity\": 240.785,\n      \"time\": 1714089600000\n    }\n  ]\n}\n"
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