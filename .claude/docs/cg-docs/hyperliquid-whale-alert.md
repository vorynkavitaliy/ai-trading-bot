> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Whale Alert

This endpoint provides real-time whale alerts on Hyperliquid, highlighting positions with a notional value over $1 million.(Returns up to approximately 200 most recent records)

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

<br />

<br />

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "user": "0x3fd4444154242720c0d0c61c74a240d90c127d33", // User address
      "symbol": "ETH",                                     // Symbol
      "position_size": 12700,                              // Position size (positive: long, negative: short)
      "entry_price": 1611.62,                              // Entry price
      "liq_price": 527.2521,                               // Liquidation price
      "position_value_usd": 21003260,                      // Position value (USD)
      "position_action": 2,                                // Position action type (1: open, 2: close)
      "create_time": 1745219517000                         // Entry time (timestamp in milliseconds)
    },
    {
      "user": "0x1cadadf0e884ac5527ae596a4fc1017a4ffd4e2c",
      "symbol": "BTC",
      "position_size": 33.54032,
      "entry_price": 87486.2,
      "liq_price": 44836.8126,
      "position_value_usd": 2936421.4757,
      "position_action": 2,
      "create_time": 1745219477000
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
    "/api/hyperliquid/whale-alert": {
      "get": {
        "summary": "Hyperliquid Whale Alert",
        "description": "This API retrieves real-time whale alerts on Hyperliquid, and position value over $1M.",
        "operationId": "hyperliquid-whale-alert",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"user\": \"0x3fd4444154242720c0d0c61c74a240d90c127d33\", // User address\n      \"symbol\": \"ETH\",                                     // Symbol\n      \"position_size\": 12700,                              // Position size (positive: long, negative: short)\n      \"entry_price\": 1611.62,                              // Entry price\n      \"liq_price\": 527.2521,                               // Liquidation price\n      \"position_value_usd\": 21003260,                      // Position value (USD)\n      \"position_action\": 2,                                // Position action type (1: open, 2: close)\n      \"create_time\": 1745219517000                         // Entry time (timestamp in milliseconds)\n    },\n    {\n      \"user\": \"0x1cadadf0e884ac5527ae596a4fc1017a4ffd4e2c\",\n      \"symbol\": \"BTC\",\n      \"position_size\": 33.54032,\n      \"entry_price\": 87486.2,\n      \"liq_price\": 44836.8126,\n      \"position_value_usd\": 2936421.4757,\n      \"position_action\": 2,\n      \"create_time\": 1745219477000\n    }\n  ]\n}\n"
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