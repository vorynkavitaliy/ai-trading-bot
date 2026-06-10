> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Price OHLC History

This endpoint provides historical open, high, low, and close (OHLC) price data for cryptocurrencies over specified timeframes.

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
      "time": 1741690800000,
      "open": 81808.25,//open price
      "high": 82092.34, //high price
      "low": 81400,//low price
      "close": 81720.34,//close price
      "volume_usd": 96823535.5724
    },
    {
      "time": 1741694400000,
      "open": 81720.33,
      "high": 81909.69,
      "low": 81017,
      "close": 81225.5,
      "volume_usd": 150660424.1863
    },
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
    "/api/spot/price/history": {
      "get": {
        "description": "",
        "operationId": "get_apispotpricehistory",
        "responses": {
          "200": {
            "description": "",
            "content": {
              "application/json": {
                "examples": {
                  "New Example": {
                    "summary": "New Example",
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1741690800000,\n      \"open\": 81808.25,//open price\n      \"high\": 82092.34, //high price\n      \"low\": 81400,//low price\n      \"close\": 81720.34,//close price\n      \"volume_usd\": 96823535.5724\n    },\n    {\n      \"time\": 1741694400000,\n      \"open\": 81720.33,\n      \"high\": 81909.69,\n      \"low\": 81017,\n      \"close\": 81225.5,\n      \"volume_usd\": 150660424.1863\n    },"
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
            "description": "spot exchange names (e.g., Binance, OKX) .Retrieve supported exchanges via the 'supported-exchange-pair' API.",
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