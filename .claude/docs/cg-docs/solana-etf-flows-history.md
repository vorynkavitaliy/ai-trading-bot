> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# ETF Flows History

This endpoint provides a list of key status information regarding the history of ETF flows.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "timestamp": 1762473600000,
      "flow_usd": 12700000,
      "price_usd": 155.2,
      "etf_flows": [
        {
          "etf_ticker": "BSOL",
          "flow_usd": 11700000
        },
        {
          "etf_ticker": "VSOL"
        },
        {
          "etf_ticker": "FSOL"
        },
        {
          "etf_ticker": "TSOL"
        },
        {
          "etf_ticker": "GSOL",
          "flow_usd": 1000000
        }
      ]
    },
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
    "/api/etf/solana/flow-history": {
      "get": {
        "summary": "Copy of ETF Flows History",
        "description": "This API retrieves a list of key status information regarding the history of ETF flows.",
        "operationId": "get_apietfethereumflow-history-1",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"timestamp\": 1721692800000,            // Timestamp\n      \"change_usd\": 106600000,              // Flow in/out (USD)\n      \"price\": 3438.09,                     // Current price\n      \"close_price\": 3481.01,               // Close price\n      \"etf_flows\": [                        // ETF flow list\n        {\n          \"ticker\": \"ETHA\",             // ETF ticker\n          \"change_usd\": 266500000       // ETF flow (USD)\n        },\n        {\n          \"ticker\": \"FETH\",             // ETF ticker\n          \"change_usd\": 71300000        // ETF flow (USD)\n        }\n      ]\n    }\n  ]\n}\n"
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