# Liquidation Coin List

This endpoint provides liquidation data for all coins on a specific exchange.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "symbol": "BTC", // Token symbol
      "liquidation_usd_24h": 82280481.50425325, // Total liquidation amount in the past 24 hours (USD)
      "long_liquidation_usd_24h": 68437447.33734027, // Long position liquidation in the past 24 hours (USD)
      "short_liquidation_usd_24h": 13843034.16691298, // Short position liquidation in the past 24 hours (USD)

      "liquidation_usd_12h": 68331844.36224127, // Total liquidation in the past 12 hours
      "long_liquidation_usd_12h": 66614158.47451427, // Long liquidation (12h)
      "short_liquidation_usd_12h": 1717685.887727, // Short liquidation (12h)

      "liquidation_usd_4h": 11381137.080643, // Total liquidation in the past 4 hours
      "long_liquidation_usd_4h": 10921633.272973, // Long liquidation (4h)
      "short_liquidation_usd_4h": 459503.80767, // Short liquidation (4h)

      "liquidation_usd_1h": 3283635.95309, // Total liquidation in the past 1 hour
      "long_liquidation_usd_1h": 3182915.16289, // Long liquidation (1h)
      "short_liquidation_usd_1h": 100720.7902 // Short liquidation (1h)
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
    "/api/futures/liquidation/coin-list": {
      "get": {
        "summary": "Liquidation Coin List",
        "description": "This API retrieves liquidation data for all coins on the exchange",
        "operationId": "liquidation-coin-list",
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
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"BTC\", // Token symbol\n      \"liquidation_usd_24h\": 82280481.50425325, // Total liquidation amount in the past 24 hours (USD)\n      \"long_liquidation_usd_24h\": 68437447.33734027, // Long position liquidation in the past 24 hours (USD)\n      \"short_liquidation_usd_24h\": 13843034.16691298, // Short position liquidation in the past 24 hours (USD)\n\n      \"liquidation_usd_12h\": 68331844.36224127, // Total liquidation in the past 12 hours\n      \"long_liquidation_usd_12h\": 66614158.47451427, // Long liquidation (12h)\n      \"short_liquidation_usd_12h\": 1717685.887727, // Short liquidation (12h)\n\n      \"liquidation_usd_4h\": 11381137.080643, // Total liquidation in the past 4 hours\n      \"long_liquidation_usd_4h\": 10921633.272973, // Long liquidation (4h)\n      \"short_liquidation_usd_4h\": 459503.80767, // Short liquidation (4h)\n\n      \"liquidation_usd_1h\": 3283635.95309, // Total liquidation in the past 1 hour\n      \"long_liquidation_usd_1h\": 3182915.16289, // Long liquidation (1h)\n      \"short_liquidation_usd_1h\": 100720.7902 // Short liquidation (1h)\n    }\n  ]\n}\n"
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