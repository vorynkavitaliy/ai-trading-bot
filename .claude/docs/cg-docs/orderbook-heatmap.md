# Orderbook Heatmap

This endpoint provides historical order book depth data for futures trading, supporting heatmap visualization.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
    "code": "0",
    "msg": "success",
    "data": [
        [
            1723611600,
            [
                [
                    56420, //Price
                    4.777 //Quantity
                ],
                [
                    40300,
                    2.191
                ]
            ],
            [
                [
                    56420,
                    4.777
                ],
                [
                    40300,
                    2.191
                ]
            ]
        ]
    ],
    "success": true
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
    "/api/futures/orderbook/history": {
      "get": {
        "summary": "Orderbook Heatmap",
        "description": "The API retrieves historical data of the order book for futures trading.",
        "operationId": "orderbook-heatmap",
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
            "description": "Time intervals for data aggregation. Supported values: 1m、3m、5m、15m、30m、1h、4h、6h、8h、12h、1d.",
            "schema": {
              "type": "string",
              "default": "1h"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": true,
            "description": "Number of results per request. Default: 100, Maximum: 100.   Historical range – 1m: 3 days, 5m: 15 days, others: 150 days.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": "1"
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds (e.g., 1723625037000).",
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
            "description": "End timestamp in milliseconds (e.g., 1723626037000).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": ""
            }
          }
        ],
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