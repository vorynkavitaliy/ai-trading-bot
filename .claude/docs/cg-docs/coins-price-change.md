> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coins Price Change

This endpoint provides percentage price changes and amplitude data for all supported coins across multiple timeframes.

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
    {
      "symbol": "BTC", // Symbol
      "current_price": 84518.4, // Current price

      "price_change_percent_5m": -0.04, // 5m change (%)
      "price_change_percent_15m": -0.09, // 15m change (%)
      "price_change_percent_30m": -0.11, // 30m change (%)
      "price_change_percent_1h": -0.17, // 1h change (%)
      "price_change_percent_4h": -0.54, // 4h change (%)
      "price_change_percent_12h": -0.6, // 12h change (%)
      "price_change_percent_24h": 0.24, // 24h change (%)

      "price_amplitude_percent_5m": 0.07, // 5m amplitude (%)
      "price_amplitude_percent_15m": 0.16, // 15m amplitude (%)
      "price_amplitude_percent_30m": 0.18, // 30m amplitude (%)
      "price_amplitude_percent_1h": 0.26, // 1h amplitude (%)
      "price_amplitude_percent_4h": 0.63, // 4h amplitude (%)
      "price_amplitude_percent_12h": 1.17, // 12h amplitude (%)
      "price_amplitude_percent_24h": 2.06 // 24h amplitude (%)
    },
    {
      "symbol": "ETH", // Symbol
      "current_price": 1573.45, // Current price

      "price_change_percent_5m": -0.04, // 5m change (%)
      "price_change_percent_15m": -0.34, // 15m change (%)
      "price_change_percent_30m": -0.38, // 30m change (%)
      "price_change_percent_1h": -0.54, // 1h change (%)
      "price_change_percent_4h": -0.77, // 4h change (%)
      "price_change_percent_12h": -1.99, // 12h change (%)
      "price_change_percent_24h": -1.41, // 24h change (%)

      "price_amplitude_percent_5m": 0.13, // 5m amplitude (%)
      "price_amplitude_percent_15m": 0.4, // 15m amplitude (%)
      "price_amplitude_percent_30m": 0.47, // 30m amplitude (%)
      "price_amplitude_percent_1h": 0.66, // 1h amplitude (%)
      "price_amplitude_percent_4h": 0.9, // 4h amplitude (%)
      "price_amplitude_percent_12h": 2.74, // 12h amplitude (%)
      "price_amplitude_percent_24h": 3.47 // 24h amplitude (%)
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
    "/api/futures/coins-price-change": {
      "get": {
        "summary": "Coins Price Change",
        "description": "This API retrieves information about price change percentages and price amplitude percentages for all coins.",
        "operationId": "coins-price-change",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"BTC\", // Symbol\n      \"current_price\": 84518.4, // Current price\n\n      \"price_change_percent_5m\": -0.04, // 5m change (%)\n      \"price_change_percent_15m\": -0.09, // 15m change (%)\n      \"price_change_percent_30m\": -0.11, // 30m change (%)\n      \"price_change_percent_1h\": -0.17, // 1h change (%)\n      \"price_change_percent_4h\": -0.54, // 4h change (%)\n      \"price_change_percent_12h\": -0.6, // 12h change (%)\n      \"price_change_percent_24h\": 0.24, // 24h change (%)\n\n      \"price_amplitude_percent_5m\": 0.07, // 5m amplitude (%)\n      \"price_amplitude_percent_15m\": 0.16, // 15m amplitude (%)\n      \"price_amplitude_percent_30m\": 0.18, // 30m amplitude (%)\n      \"price_amplitude_percent_1h\": 0.26, // 1h amplitude (%)\n      \"price_amplitude_percent_4h\": 0.63, // 4h amplitude (%)\n      \"price_amplitude_percent_12h\": 1.17, // 12h amplitude (%)\n      \"price_amplitude_percent_24h\": 2.06 // 24h amplitude (%)\n    },\n    {\n      \"symbol\": \"ETH\", // Symbol\n      \"current_price\": 1573.45, // Current price\n\n      \"price_change_percent_5m\": -0.04, // 5m change (%)\n      \"price_change_percent_15m\": -0.34, // 15m change (%)\n      \"price_change_percent_30m\": -0.38, // 30m change (%)\n      \"price_change_percent_1h\": -0.54, // 1h change (%)\n      \"price_change_percent_4h\": -0.77, // 4h change (%)\n      \"price_change_percent_12h\": -1.99, // 12h change (%)\n      \"price_change_percent_24h\": -1.41, // 24h change (%)\n\n      \"price_amplitude_percent_5m\": 0.13, // 5m amplitude (%)\n      \"price_amplitude_percent_15m\": 0.4, // 15m amplitude (%)\n      \"price_amplitude_percent_30m\": 0.47, // 30m amplitude (%)\n      \"price_amplitude_percent_1h\": 0.66, // 1h amplitude (%)\n      \"price_amplitude_percent_4h\": 0.9, // 4h amplitude (%)\n      \"price_amplitude_percent_12h\": 2.74, // 12h amplitude (%)\n      \"price_amplitude_percent_24h\": 3.47 // 24h amplitude (%)\n    }\n  ]\n}\n"
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