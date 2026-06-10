> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Whale Position

This endpoint provides whale positions on Hyperliquid with a notional value exceeding $1 million.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

<br />

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "user": "0x20c2d95a3dfdca9e9ad12794d5fa6fad99da44f5", // User address
      "symbol": "ETH",                                   // Token symbol
      "position_size": -44727.1273,                      // Position size (positive: long, negative: short)
      "entry_price": 2249.7,                             // Entry price
      "mark_price": 1645.8,                              // Current mark price
      "liq_price": 2358.2766,                            // Liquidation price
      "leverage": 25,                                    // Leverage
      "margin_balance": 2943581.7019,                    // Margin balance (USD)
      "position_value_usd": 73589542.5467,               // Position value (USD)
      "unrealized_pnl": 27033236.424,                    // Unrealized PnL (USD)
      "funding_fee": -3107520.7373,                      // Funding fee (USD)
      "margin_mode": "cross",                            // Margin mode (e.g., cross / isolated)
      "create_time": 1741680802000,                      // Entry time (timestamp in ms)
      "update_time": 1745219966000                       // Last updated time (timestamp in ms)
    },
    {
      "user": "0xf967239debef10dbc78e9bbbb2d8a16b72a614eb",
      "symbol": "BTC",
      "position_size": -800,
      "entry_price": 84931.3,
      "mark_price": 87427,
      "liq_price": 92263.798,
      "leverage": 15,
      "margin_balance": 4812076.3896,
      "position_value_usd": 69921600,
      "unrealized_pnl": -1976493.6819,
      "funding_fee": 14390.0346,
      "margin_mode": "isolated",
      "create_time": 1743982804000,
      "update_time": 1745219969000
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
    "/api/hyperliquid/whale-position": {
      "get": {
        "summary": "Hyperliquid Whale Position",
        "description": "This API retrieves whale positions on Hyperliquid with a value over $1M.",
        "operationId": "hyperliquid-whale-position",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"user\": \"0x20c2d95a3dfdca9e9ad12794d5fa6fad99da44f5\", // User address\n      \"symbol\": \"ETH\",                                   // Token symbol\n      \"position_size\": -44727.1273,                      // Position size (positive: long, negative: short)\n      \"entry_price\": 2249.7,                             // Entry price\n      \"mark_price\": 1645.8,                              // Current mark price\n      \"liq_price\": 2358.2766,                            // Liquidation price\n      \"leverage\": 25,                                    // Leverage\n      \"margin_balance\": 2943581.7019,                    // Margin balance (USD)\n      \"position_value_usd\": 73589542.5467,               // Position value (USD)\n      \"unrealized_pnl\": 27033236.424,                    // Unrealized PnL (USD)\n      \"funding_fee\": -3107520.7373,                      // Funding fee (USD)\n      \"margin_mode\": \"cross\",                            // Margin mode (e.g., cross / isolated)\n      \"create_time\": 1741680802000,                      // Entry time (timestamp in ms)\n      \"update_time\": 1745219966000                       // Last updated time (timestamp in ms)\n    },\n    {\n      \"user\": \"0xf967239debef10dbc78e9bbbb2d8a16b72a614eb\",\n      \"symbol\": \"BTC\",\n      \"position_size\": -800,\n      \"entry_price\": 84931.3,\n      \"mark_price\": 87427,\n      \"liq_price\": 92263.798,\n      \"leverage\": 15,\n      \"margin_balance\": 4812076.3896,\n      \"position_value_usd\": 69921600,\n      \"unrealized_pnl\": -1976493.6819,\n      \"funding_fee\": 14390.0346,\n      \"margin_mode\": \"isolated\",\n      \"create_time\": 1743982804000,\n      \"update_time\": 1745219969000\n    }\n  ]\n}\n"
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