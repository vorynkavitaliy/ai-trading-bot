# Futures Basis

This endpoint provides historical futures basis data, including open and close basis rates and their corresponding annualized percentage changes over time.

***Cache / Update Frequency:*** Real time for all the API plans.

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
      "time": 1741629600000,            // Timestamp (in milliseconds)
      "open_basis": 0.0504,             // Opening basis (%) - the basis at the start of the interval
      "close_basis": 0.0445,            // Closing basis (%) - the basis at the end of the interval
      "open_change": 39.5,              // Percentage change in basis at opening compared to previous period
      "close_change": 34.56             // Percentage change in basis at closing compared to previous period
    },
    {
      "time": 1741633200000,            // Timestamp (in milliseconds)
      "open_basis": 0.0446,             // Opening basis (%)
      "close_basis": 0.03,              // Closing basis (%)
      "open_change": 34.65,             // Opening basis change (%)
      "close_change": 23.74             // Closing basis change (%)
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
    "/api/futures/basis/history": {
      "get": {
        "description": "",
        "operationId": "get_apifuturesbasishistory",
        "responses": {
          "200": {
            "description": "",
            "content": {
              "application/json": {
                "examples": {
                  "New Example": {
                    "summary": "New Example",
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1741629600000,            // Timestamp (in milliseconds)\n      \"open_basis\": 0.0504,             // Opening basis (%) - the basis at the start of the interval\n      \"close_basis\": 0.0445,            // Closing basis (%) - the basis at the end of the interval\n      \"open_change\": 39.5,              // Percentage change in basis at opening compared to previous period\n      \"close_change\": 34.56             // Percentage change in basis at closing compared to previous period\n    },\n    {\n      \"time\": 1741633200000,            // Timestamp (in milliseconds)\n      \"open_basis\": 0.0446,             // Opening basis (%)\n      \"close_basis\": 0.03,              // Closing basis (%)\n      \"open_change\": 34.65,             // Opening basis change (%)\n      \"close_change\": 23.74             // Closing basis change (%)\n    }\n  ]\n}\n"
                  }
                }
              }
            }
          }
        },
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
            "description": "Data aggregation time interval. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w.",
            "schema": {
              "type": "string",
              "default": "1h"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Number of results per request. Default: 1000, Maximum: 1000.",
            "schema": {
              "type": "string",
              "default": "10"
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "string",
              "default": ""
            }
          },
          {
            "name": "end_time",
            "in": "query",
            "required": false,
            "description": "End timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "string",
              "default": ""
            }
          }
        ],
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