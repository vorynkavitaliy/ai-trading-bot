# ETF NetAssets History

This endpoint provides historical data on the net assets of Bitcoin Exchange-Traded Funds (ETFs).

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
      "net_assets_usd": 51671409241.39,         // Net asset value (USD)
      "change_usd": 655300000,                  // Daily capital change (USD)
      "timestamp": 1704931200000,               // Date (timestamp in milliseconds)
      "price_usd": 46337.8                      // BTC price on that date (USD)
    },
    {
      "net_assets_usd": 51874409241.39,         // Net asset value (USD)
      "change_usd": 203000000,                  // Daily capital change (USD)
      "timestamp": 1705017600000,               // Date (timestamp in milliseconds)
      "price_usd": 42788.9                      // BTC price on that date (USD)
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
    "/api/etf/bitcoin/net-assets/history": {
      "get": {
        "summary": "ETF NetAssets History",
        "description": "This API retrieves the historical net assets data for ETFs (Exchange-Traded Funds)",
        "operationId": "bitcoin-etf-netassets-history",
        "parameters": [
          {
            "name": "ticker",
            "in": "query",
            "required": false,
            "description": "ETF ticker symbol (e.g., GBTC, IBIT).",
            "schema": {
              "type": "string",
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"net_assets_usd\": 51671409241.39,         // Net asset value (USD)\n      \"change_usd\": 655300000,                  // Daily capital change (USD)\n      \"timestamp\": 1704931200000,               // Date (timestamp in milliseconds)\n      \"price_usd\": 46337.8                      // BTC price on that date (USD)\n    },\n    {\n      \"net_assets_usd\": 51874409241.39,         // Net asset value (USD)\n      \"change_usd\": 203000000,                  // Daily capital change (USD)\n      \"timestamp\": 1705017600000,               // Date (timestamp in milliseconds)\n      \"price_usd\": 42788.9                      // BTC price on that date (USD)\n    }\n  ]\n}\n"
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