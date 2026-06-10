> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Long/Short Account Ratio (By Tag)

This API provides historical long/short account data for each symbol on Hyperliquid across different tag-based groups, including the number of long and short accounts and their corresponding position sizes.

***Cache / Update Frequency:*** Updated every 15 minutes.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ❌        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "time": 1775467800000,
      "group_name": "shrimp",
      "account_long_count": 6523,
      "account_short_count": 3897,
      "short_position_usd": 10013432.42878,
      "long_position_usd": 13951364.29166
    },
    {
      "time": 1775468400000,
      "group_name": "shrimp",
      "account_long_count": 6518,
      "account_short_count": 3941,
      "short_position_usd": 10150468.22601,
      "long_position_usd": 14950428.88208
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
    "/api/futures/hyperliquid/long-short-account-ratio-by-tag/history": {
      "get": {
        "description": "This API provides historical long/short account data for each symbol on Hyperliquid across different tag-based groups, including the number of long and short accounts and their corresponding position sizes.",
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
            "description": "Trading coin (e.g., BTC).  Retrieve supported coins via the 'supported-coins' API. ",
            "required": true
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "10m"
            },
            "required": true,
            "description": "Time interval for data aggregation.  Supported values: 10m, 1h,1d"
          },
          {
            "in": "query",
            "name": "wallet_tag",
            "schema": {
              "type": "string",
              "default": "Shrimp"
            },
            "required": true,
            "description": "Supported tags: Shrimp, Fish, Dolphin, Apex_Predator, Small_Whale, Whale, Tidal_Whale, Leviathan, Money_Printer, Smart_Money, Grinder, Humble_Earner, Exit_Liquidity, Semi_Rekt, Full_Rekt, Giga_Rekt"
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer"
            },
            "required": false,
            "description": "Number of results per request.  Default: 1000, Maximum: 1000"
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "End timestamp in milliseconds (e.g., 1641522717000)."
          }
        ],
        "operationId": "get_api-futures-hyperliquid-long-short-account-ratio-by-tag-history",
        "summary": "Hyperliquid Long/Short Account Ratio (By Tag)"
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