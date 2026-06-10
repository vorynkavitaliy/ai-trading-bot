> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Wallet Positions by Coin

This endpoint provides real-time wallet position data by coin on Hyperliquid, including user addresses, position size, margin balance, and unrealized PnL for each account.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",                     // Status code (0 = success)
  "data": {
    "total_pages": 10,          // Total pages of position data
    "current_page":1,   // Current page number being returned
    "list": [
      {
        "user": "0x5b5d51203a0f9079f8aeb098a6523a13f298c060",           //User Wallet address
        "symbol": "BTC",           // Symbol
        "position_size": -2683.14, // Position size (positive = long, negative = short)
        "entry_price": 111459.6,   // Entry price
        "mark_price": 116638,      // Current price
        "liq_price": 150629.52,    // Liquidation price
        "leverage": 10,            // Leverage
        "margin_balance": 31263482.07,        // Margin balance (USD)
        "position_value_usd": 312634820.77,   // Position value (USD)
        "unrealized_pnl": -13572345.06,       // Unrealized profit/loss (USD)
        "funding_fee": -12534553.66,          // Funding fee (USD)
        "margin_mode": "cross",               // Margin mode ("cross" or "isolated")
        "create_time": 1752152867098,         // Open time (timestamp)
        "update_time": 1758162698266          // Last update (timestamp)
      }
    ]
  }
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
    "/api/hyperliquid/position": {
      "get": {
        "description": "",
        "operationId": "get_apihyperliquidposition",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string",
              "default": "BTC"
            },
            "required": true,
            "description": "Trading coin (e.g., BTC). Retrieve supported coins via the 'supported-coins' API."
          },
          {
            "in": "query",
            "name": "current_page",
            "schema": {
              "type": "string",
              "default": "1"
            },
            "required": false,
            "description": "Current page number being returned"
          }
        ]
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