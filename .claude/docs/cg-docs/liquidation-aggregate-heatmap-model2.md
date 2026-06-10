> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin Liquidation Heatmap Model2

This endpoint provides aggregated liquidation levels on a heatmap chart, calculated based on market data and liquidation leverage levels.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ❌        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": {
    "y_axis": [47968.54, 48000.00, 48031.46], // Y-axis price levels
    "liquidation_leverage_data": [
      [5, 124, 2288867.26], // Each array: [X-axis index, Y-axis index, liquidation leverage]
      [6, 123, 318624.82],
      [7, 122, 1527940.12]
    ],
    "price_candlesticks": [
      [
        1722676500, // Timestamp (seconds)
        "61486",    // Open price
        "61596.4",  // High price
        "61434.4",  // Low price
        "61539.9",  // Close price
        "63753192.1129" // Trading volume (USD)
      ],
      [
        1722676800,
        "61539.9",
        "61610.0",
        "61480.0",
        "61590.5",
        "42311820.8720"
      ]
    ]
  }
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
    "/api/futures/liquidation/aggregated-heatmap/model2": {
      "get": {
        "summary": "Liquidation Aggregated Heatmap Model2",
        "description": "This API presents aggregated liquidation levels on the chart, calculated from market data and various leverage amounts.",
        "operationId": "liquidation-aggregate-heatmap-model2",
        "parameters": [
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
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for data aggregation. Supported values: 12h, 24h, 3d, 7d, 30d, 90d, 180d, 1y.",
            "schema": {
              "type": "string",
              "default": "3d"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"y_axis\": [47968.54, 48000.00, 48031.46], // Y-axis price levels\n    \"liquidation_leverage_data\": [\n      [5, 124, 2288867.26], // Each array: [X-axis index, Y-axis index, liquidation amount in USD]\n      [6, 123, 318624.82],\n      [7, 122, 1527940.12]\n    ],\n    \"price_candlesticks\": [\n      [\n        1722676500, // Timestamp (seconds)\n        \"61486\",    // Open price\n        \"61596.4\",  // High price\n        \"61434.4\",  // Low price\n        \"61539.9\",  // Close price\n        \"63753192.1129\" // Trading volume (USD)\n      ],\n      [\n        1722676800,\n        \"61539.9\",\n        \"61610.0\",\n        \"61480.0\",\n        \"61590.5\",\n        \"42311820.8720\"\n      ]\n    ]\n  }\n}"
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