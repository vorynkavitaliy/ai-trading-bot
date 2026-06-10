# Hong Kong ETF Flows History

This endpoint provides historical data on ETF flow activity for Bitcoin ETFs in the Hong Kong market.

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
      "timestamp": 1714435200000,                     // Date (timestamp in milliseconds)
      "flow_usd": 247866000,                          // Total capital inflow (USD)
      "price_usd": 63842.4,                           // BTC price on that date (USD)
      "etf_flows": [                                  // ETF capital flow details
        {
          "etf_ticker": "CHINAAMC",                   // ETF ticker
          "flow_usd": 123610690                       // Capital inflow for this ETF (USD)
        },
        {
          "etf_ticker": "HARVEST",                    // ETF ticker
          "flow_usd": 63138000                        // Capital inflow for this ETF (USD)
        },
        {
          "etf_ticker": "BOSERA&HASHKEY",             // ETF ticker
          "flow_usd": 61117310                        // Capital inflow for this ETF (USD)
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
    "/api/hk-etf/bitcoin/flow-history": {
      "get": {
        "summary": "Hong Kong ETF Flows History",
        "description": "This API retrieves a list of key status information regarding the history of ETF flows.",
        "operationId": "hong-kong-bitcoin-etf-flow-history",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"timestamp\": 1714435200000,                     // Date (timestamp in milliseconds)\n      \"flow_usd\": 247866000,                          // Total capital inflow (USD)\n      \"price_usd\": 63842.4,                           // BTC price on that date (USD)\n      \"etf_flows\": [                                  // ETF capital flow details\n        {\n          \"etf_ticker\": \"CHINAAMC\",                   // ETF ticker\n          \"flow_usd\": 123610690                       // Capital inflow for this ETF (USD)\n        },\n        {\n          \"etf_ticker\": \"HARVEST\",                    // ETF ticker\n          \"flow_usd\": 63138000                        // Capital inflow for this ETF (USD)\n        },\n        {\n          \"etf_ticker\": \"BOSERA&HASHKEY\",             // ETF ticker\n          \"flow_usd\": 61117310                        // Capital inflow for this ETF (USD)\n        }\n      ]\n    }\n  ]\n}\n"
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