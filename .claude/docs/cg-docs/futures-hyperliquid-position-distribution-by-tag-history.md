> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Position Distribution (By Tag)

This API provides position distribution data for each symbol on Hyperliquid across different tag-based groups, including address counts, position sizes, profit and loss status, and long/short information.

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
      "group_name": "shrimp",
      "all_address_count": 437459,
      "position_address_count": 24211,
      "bias_score": -0.46,
      "bias_remark": "bearish",
      "minimum_amount": 0,
      "maximum_amount": 250,
      "long_position_usd": 35743441.157706,
      "short_position_usd": 14388750.286128,
      "position_usd": 50132191.443834,
      "profit_address_count": 12307,
      "loss_address_count": 12558
    },
    {
      "group_name": "shrimp",
      "all_address_count": 437468,
      "position_address_count": 24287,
      "bias_score": -0.45,
      "bias_remark": "bearish",
      "minimum_amount": 0,
      "maximum_amount": 250,
      "long_position_usd": 36145526.276199,
      "short_position_usd": 15119941.085077,
      "position_usd": 51265467.361276,
      "profit_address_count": 12349,
      "loss_address_count": 12586
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
    "/api/futures/hyperliquid/position-distribution-by-tag/history": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "10m"
            },
            "description": "Time interval for data aggregation. Supported values: 10m, 1h,1d",
            "required": true
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
              "type": "string"
            },
            "description": "Number of results per request. Default: 1000, Maximum: 1000"
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer",
              "format": "int64"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000).",
            "required": false
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
        "operationId": "get_api-futures-hyperliquid-position-distribution-by-tag-history"
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