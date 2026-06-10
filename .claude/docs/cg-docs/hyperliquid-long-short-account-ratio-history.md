> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Hyperliquid Long/Short Ratio (Accounts)

This endpoint provides the long/short account ratio history for symbols on Hyperliquid.

***Cache / Update Frequency:*** Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "time": 1751414400000,// Timestamp (in milliseconds)
      "global_account_long_count": 5347,// Long account count
      "global_account_short_count": 3766,// Short account count
      "global_account_total_count": 9113,// Total account count
      "global_account_long_percent": 58.67,// Long percentage (%)
      "global_account_short_percent": 41.33,// Short percentage (%)
      "global_account_long_short_ratio": 1.4195// Long/Short ratio
    },
    {
      "time": 1751500800000,
      "global_account_long_count": 4644,
      "global_account_short_count": 4719,
      "global_account_total_count": 9363,
      "global_account_long_percent": 49.6,
      "global_account_short_percent": 50.4,
      "global_account_long_short_ratio": 0.9841
    },
    {
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
    "/api/hyperliquid/global-long-short-account-ratio/history": {
      "get": {
        "description": "This endpoint provides the long/short account ratio history for symbols on Hyperliquid.",
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
            "required": false,
            "description": "Trading coin (e.g., BTC).  Retrieve supported coins via the 'supported-coins' API. If not provided, data for all supported symbols will be returned."
          },
          {
            "in": "query",
            "name": "interval",
            "schema": {
              "type": "string",
              "default": "1d"
            },
            "required": true,
            "description": "Time interval for data aggregation.  Supported values: 5m, 1h,1d"
          },
          {
            "in": "query",
            "name": "limit",
            "schema": {
              "type": "integer",
              "format": "int32"
            },
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
        "operationId": "get_api-hyperliquid-global-long-short-account-ratio-history",
        "summary": "Hyperliquid Long/Short Ratio (Accounts)"
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