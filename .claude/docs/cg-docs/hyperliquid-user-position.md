> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Wallet Positions by Address

This endpoint provides Hyperliquid user position data, including margin summaries, withdrawable balance, and open asset positions.

**Cache / Update Frequency:** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": {
    "margin_summary": {
      "account_value": 179250588.896754,
      "total_ntl_pos": 679947383.29435,
      "total_raw_usd": -500696794.397596,
      "total_margin_used": 131236726.65887
    },
    "cross_margin_summary": {
      "account_value": 179250588.896754,
      "total_ntl_pos": 679947383.29435,
      "total_raw_usd": -500696794.397596,
      "total_margin_used": 131236726.65887
    },
    "cross_maintenance_margin_used": 19278725.276478,
    "withdrawable": 46429612.237884,
    "asset_positions": [
      {
        "type": "oneWay",
        "position": {
          "coin": "BTC",
          "szi": 1000,
          "leverage": {
            "type": "cross",
            "value": 5
          },
          "entry_px": 91506.7,
          "position_value": 86265000,
          "unrealized_pnl": -5643767.29312,
          "return_on_equity": -0.3083797767,
          "max_leverage": 5,
          "cum_funding": {
            "all_time": -104732.177706,
            "since_open": 87958.233078,
            "since_change": 84811.539668
          }
        }
      },
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
    "/api/hyperliquid/user-position": {
      "get": {
        "description": "",
        "operationId": "get_apihyperliquiduser-position",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "user_address",
            "schema": {
              "type": "string",
              "default": ""
            },
            "required": true,
            "description": "User Address"
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