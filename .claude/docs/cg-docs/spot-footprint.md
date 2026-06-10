# Footprint History (90d)

This endpoint provides historical footprint chart data for spot markets, including buy and sell volumes at each price level.

**Cache / Update Frequency:** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ❌        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",  // code (0 = success)
  "data": [
    [
      1757808000,  // Timestamp (seconds)
      [
        [
          115765,        // Price start
          115770,        // Price end
          3.223,         // Taker buy volume 
          9.906,         // Taker sell volume 
          373118.1958,   // Taker buy volume (quote currency)
          1146773.5391,  // Taker sell volume (quote currency)
          373118.1958,   // Taker buy volume (USDT)
          1146773.5391,  // Taker sell volume (USDT)
          193,           // Taker buy trade count
          153            // Taker sell trade count
        ],
        [
          115770,
          115775,
          3.315,         // Taker buy volume
          0.528,         // Taker sell volume
          383782.5569,   // Taker buy volume (quote currency)
          61127.0686,    // Taker sell volume (quote currency)
          383782.5569,   // Taker buy volume (USDT)
          61127.0686,    // Taker sell volume (USDT)
          40,            // Taker buy trade count
          64             // Taker sell trade count
        ]
      ]
    ]
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
    "/api/spot/volume/footprint-history": {
      "get": {
        "description": "",
        "operationId": "spot-footprint",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "exchange",
            "schema": {
              "type": "string",
              "default": "Binance"
            },
            "required": true,
            "description": "Spot exchange names (Supported Binance, OKX, Bybit)"
          },
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTCUSDT"
            },
            "required": true,
            "description": "Trading pair (e.g., BTCUSDT). Retrieve supported pairs via the 'support-exchange-pair' API."
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "1h"
            },
            "required": true,
            "description": "Time interval for data aggregation. Supported values: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 6h, 8h, 12h, 1d, 1w"
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer"
            },
            "required": false,
            "description": "Number of results per request. Default: 1000, Maximum: 1000"
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "End timestamp in milliseconds (e.g., 1641522717000)."
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