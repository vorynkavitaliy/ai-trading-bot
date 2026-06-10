# Whale Index

This endpoint provides historical Whale Index data.

***Cache / Update Frequency:*** every 1 minutes for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

<br />

**Response Data**

```json
{
  "code": "0",
  "data": [
    {
      "time": 1665532800000,
      "whale_index_value": -184.8
    },
    {
      "time": 1665619200000,
      "whale_index_value": -118.965
    },
    {
      "time": 1665705600000,
      "whale_index_value": -58.795
    },
    {
      "time": 1665792000000,
      "whale_index_value": -84.095
    },
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
    "/api/futures/whale-index/history": {
      "get": {
        "description": "",
        "operationId": "get_apifutureswhale-indexhistory",
        "responses": {
          "200": {
            "description": ""
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
            "description": "Number of results per request. Default 1000, Max 1000",
            "schema": {
              "type": "integer",
              "default": "1000"
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds (e.g., 1641522717000).",
            "schema": {
              "type": "integer",
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