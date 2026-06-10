> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# ETF Flows History

This endpoint provides historical flow data for Bitcoin Exchange-Traded Funds (ETFs), including daily net inflows and outflows in USD, closing prices, and flow breakdowns by individual ETF tickers.

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
      "timestamp": 1704931200000,                   // Date (timestamp in milliseconds)
      "flow_usd": 655300000,                         // Total daily capital flow (USD)
      "price_usd": 46663,                            // BTC current price (USD)
      "etf_flows": [                                 // ETF capital flow breakdown
        {
          "etf_ticker": "GBTC",                      // ETF ticker
          "flow_usd": -95100000                      // Capital outflow (USD)
        },
        {
          "etf_ticker": "IBIT",                      // ETF ticker
          "flow_usd": 111700000                      // Capital inflow (USD)
        },
        {
          "etf_ticker": "FBTC",                      // ETF ticker
          "flow_usd": 227000000                      // Capital inflow (USD)
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
    "/api/etf/bitcoin/flow-history": {
      "get": {
        "summary": "ETF Flows History",
        "description": "This API retrieves a list of key status information regarding the history of ETF flows.",
        "operationId": "etf-flows-history",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"timestamp\": 1704931200000,                   // Date (timestamp in milliseconds)\n      \"flow_usd\": 655300000,                         // Total daily capital flow (USD)\n      \"price_usd\": 46663,                            // BTC current price (USD)\n      \"etf_flows\": [                                 // ETF capital flow breakdown\n        {\n          \"etf_ticker\": \"GBTC\",                      // ETF ticker\n          \"flow_usd\": -95100000                      // Capital outflow (USD)\n        },\n        {\n          \"etf_ticker\": \"IBIT\",                      // ETF ticker\n          \"flow_usd\": 111700000                      // Capital inflow (USD)\n        },\n        {\n          \"etf_ticker\": \"FBTC\",                      // ETF ticker\n          \"flow_usd\": 227000000                      // Capital inflow (USD)\n        }\n      ]\n    }\n  ]\n}\n"
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