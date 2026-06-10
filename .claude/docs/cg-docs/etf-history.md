> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# ETF History

This endpoint provides historical data for Bitcoin Exchange-Traded Funds (ETFs), including key information such as market price, Net Asset Value (NAV), premium/discount percentage, shares outstanding, and net assets for each ETF ticker.

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
      "assets_date": 1706486400000,           // Net asset date (timestamp in milliseconds)
      "btc_holdings": 496573.8166,            // BTC holdings
      "market_date": 1706486400000,           // Market price date (timestamp in milliseconds)
      "market_price": 38.51,                  // Market price (USD)
      "name": "Grayscale Bitcoin Trust",      // ETF name
      "nav": 38.57,                           // Net Asset Value per share (USD)
      "net_assets": 21431132778.35,           // Total net assets (USD)
      "premium_discount": -0.16,              // Premium/discount percentage
      "shares_outstanding": 555700100,        // Total shares outstanding
      "ticker": "GBTC"                        // ETF ticker
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
    "/api/etf/bitcoin/history": {
      "get": {
        "summary": "ETF History",
        "description": "This API retrieves a list of key status information regarding the historical premium or discount fluctuations of ETFs.",
        "operationId": "etf-history",
        "parameters": [
          {
            "name": "ticker",
            "in": "query",
            "required": true,
            "description": "ETF ticker symbol (e.g., GBTC, IBIT).",
            "schema": {
              "type": "string",
              "default": "GBTC"
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
                    "value": "{\n  \"code\": \"0\",                                \n  \"msg\": \"success\",                          \n  \"data\": [\n    {\n      \"assets_date\": 1706486400000,           // Net asset date (timestamp in milliseconds)\n      \"btc_holdings\": 496573.8166,            // BTC holdings\n      \"market_date\": 1706486400000,           // Market price date (timestamp in milliseconds)\n      \"market_price\": 38.51,                  // Market price (USD)\n      \"name\": \"Grayscale Bitcoin Trust\",      // ETF name\n      \"nav\": 38.57,                           // Net Asset Value per share (USD)\n      \"net_assets\": 21431132778.35,           // Total net assets (USD)\n      \"premium_discount\": -0.16,              // Premium/discount percentage\n      \"shares_outstanding\": 555700100,        // Total shares outstanding\n      \"ticker\": \"GBTC\"                        // ETF ticker\n    }\n  ]\n}\n"
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