> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Options Info

This endpoint provides detailed information about open interest and trading volume for options across different exchanges

***Cache / Update Frequency:*** every 30 seconds for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

<br />

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "exchange_name": "All",                           // Exchange name
      "open_interest": 361038.78,                       // Open interest (contracts)
      "oi_market_share": 100,                           // Market share (%)
      "open_interest_change_24h": 2.72,                 // 24h open interest change (%)
      "open_interest_usd": 31623069708.138245,          // Open interest value (USD)
      "volume_usd_24h": 2764676957.0569425,             // 24h trading volume (USD)
      "volume_change_percent_24h": 303.1                // 24h volume change (%)
    },
    {
      "exchange_name": "Deribit",                       // Exchange name
      "open_interest": 262641.9,                        // Open interest (contracts)
      "oi_market_share": 72.74,                         // Market share (%)
      "open_interest_change_24h": 2.57,                 // 24h open interest change (%)
      "open_interest_usd": 23005403973.349,             // Open interest value (USD)
      "volume_usd_24h": 2080336672.709                  // 24h trading volume (USD)
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
    "/api/option/info": {
      "get": {
        "summary": "Info",
        "description": "",
        "operationId": "info",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC,ETH). ",
            "schema": {
              "type": "string",
              "default": "BTC"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"exchange_name\": \"All\",                           // Exchange name\n      \"open_interest\": 361038.78,                       // Open interest (contracts)\n      \"oi_market_share\": 100,                           // Market share (%)\n      \"open_interest_change_24h\": 2.72,                 // 24h open interest change (%)\n      \"open_interest_usd\": 31623069708.138245,          // Open interest value (USD)\n      \"volume_usd_24h\": 2764676957.0569425,             // 24h trading volume (USD)\n      \"volume_change_percent_24h\": 303.1                // 24h volume change (%)\n    },\n    {\n      \"exchange_name\": \"Deribit\",                       // Exchange name\n      \"open_interest\": 262641.9,                        // Open interest (contracts)\n      \"oi_market_share\": 72.74,                         // Market share (%)\n      \"open_interest_change_24h\": 2.57,                 // 24h open interest change (%)\n      \"open_interest_usd\": 23005403973.349,             // Open interest value (USD)\n      \"volume_usd_24h\": 2080336672.709                  // 24h trading volume (USD)\n    }\n  ]\n}\n"
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