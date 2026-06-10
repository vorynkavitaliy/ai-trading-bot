> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin Liquidation History

This endpoint provides aggregated historical data for both long and short liquidations of a coin across multiple exchanges.

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
      "time": 1658966400000, // Timestamp (milliseconds) 
      "aggregated_long_liquidation_usd": 5916885.14234,//aggregated Long position liquidation amount (USD)
      "aggregated_short_liquidation_usd": 12969583.87632 //aggregated Short position liquidation amount (USD)
    },
    {
      "time": 1659052800000,  // Timestamp (milliseconds)
      "aggregated_long_liquidation_usd": 5345708.23191, //aggregated Long position liquidation amount (USD)
      "aggregated_short_liquidation_usd": 6454875.54909 //aggregated Short position liquidation amount (USD)
    },
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
    "/api/futures/liquidation/aggregated-history": {
      "get": {
        "summary": "Liquidation Aggregated History",
        "description": "This API retrieves aggregated historical data for both long and short liquidations of a coin on the exchange",
        "operationId": "aggregated-liquidation-history",
        "parameters": [
          {
            "name": "exchange_list",
            "in": "query",
            "required": true,
            "description": "List of exchange names to retrieve data from (e.g.,  'Binance, OKX, Bybit')",
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
            "description": "Time interval for data aggregation. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w.",
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1658966400000, // Timestamp (milliseconds) \n      \"aggregated_long_liquidation_usd\": 5916885.14234,//aggregated Long position liquidation amount (USD)\n      \"aggregated_short_liquidation_usd\": 12969583.87632 //aggregated Short position liquidation amount (USD)\n    },\n    {\n      \"time\": 1659052800000,  // Timestamp (milliseconds)\n      \"aggregated_long_liquidation_usd\": 5345708.23191, //aggregated Long position liquidation amount (USD)\n      \"aggregated_short_liquidation_usd\": 6454875.54909 //aggregated Short position liquidation amount (USD)\n    },\n  ]\n}\n\n"
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