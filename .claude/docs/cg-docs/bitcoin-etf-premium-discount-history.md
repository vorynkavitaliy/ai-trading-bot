# ETF Premium/Discount History

This endpoint provides historical data on the premium or discount rates of Bitcoin Exchange-Traded Funds (ETFs), including Net Asset Value (NAV), market price, and premium/discount percentages for each ETF ticker.

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
      "timestamp": 1706227200000,                 // Date (timestamp in milliseconds)
      "list": [
        {
          "ticker": "GBTC",                       // ETF ticker
          "nav_usd": 37.51,                        // Net Asset Value (USD)
          "market_price_usd": 37.51,               // Market price (USD)
          "premium_discount_details": 0            // Premium/Discount percentage
        },
        {
          "ticker": "IBIT",                       // ETF ticker
          "nav_usd": 23.94,                        // Net Asset Value (USD)
          "market_price_usd": 23.99,               // Market price (USD)
          "premium_discount_details": 0.22         // Premium/Discount percentage
        },
        {
          "ticker": "FBTC",                       // ETF ticker
          "nav_usd": 36.720807,                    // Net Asset Value (USD)
          "market_price_usd": 36.75,               // Market price (USD)
          "premium_discount_details": 0.0795       // Premium/Discount percentage
        }
      ]
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
    "/api/etf/bitcoin/premium-discount/history": {
      "get": {
        "summary": "ETF Premium/Discount History",
        "description": "This API retrieves a list of key status information regarding the historical premium or discount fluctuations of ETFs.",
        "operationId": "bitcoin-etf-premium-discount-history",
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
                    "value": "{\n  \"code\": \"0\",                                    \n  \"msg\": \"success\",                               \n  \"data\": [\n    {\n      \"timestamp\": 1706227200000,                 // Date (timestamp in milliseconds)\n      \"list\": [\n        {\n          \"ticker\": \"GBTC\",                       // ETF ticker\n          \"nav_usd\": 37.51,                        // Net Asset Value (USD)\n          \"market_price_usd\": 37.51,               // Market price (USD)\n          \"premium_discount_details\": 0            // Premium/Discount percentage\n        },\n        {\n          \"ticker\": \"IBIT\",                       // ETF ticker\n          \"nav_usd\": 23.94,                        // Net Asset Value (USD)\n          \"market_price_usd\": 23.99,               // Market price (USD)\n          \"premium_discount_details\": 0.22         // Premium/Discount percentage\n        },\n        {\n          \"ticker\": \"FBTC\",                       // ETF ticker\n          \"nav_usd\": 36.720807,                    // Net Asset Value (USD)\n          \"market_price_usd\": 36.75,               // Market price (USD)\n          \"premium_discount_details\": 0.0795       // Premium/Discount percentage\n        }\n      ]\n    }\n  ]\n}\n"
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