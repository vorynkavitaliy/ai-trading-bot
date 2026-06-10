> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Exchange Assets

This endpoint provides asset holdings data for exchange wallets, including wallet address, asset balance, USD value, and real-time price information for each asset.

***Cache / Update Frequency:*** every 1 hour for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Respones Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "wallet_address": "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
      "balance": 248597.54,
      "balance_usd": 21757721869.92,
      "symbol": "BTC",
      "assets_name": "Bitcoin",
      "price": 87521.87117346626
    },
    {
      "wallet_address": "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6",
      "balance": 139456.08,
      "balance_usd": 12205457068.12,
      "symbol": "BTC",
      "assets_name": "Bitcoin",
      "price": 87521.87117346626
    },
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
    "/api/exchange/assets": {
      "get": {
        "description": "",
        "operationId": "get_apiexchangeassets",
        "responses": {
          "200": {
            "description": "",
            "content": {
              "application/json": {
                "examples": {
                  "New Example": {
                    "summary": "New Example",
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"wallet_address\": \"34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo\",\n      \"balance\": 248597.54,\n      \"balance_usd\": 21757721869.92,\n      \"symbol\": \"BTC\",\n      \"assets_name\": \"Bitcoin\",\n      \"price\": 87521.87117346626\n    },\n    {\n      \"wallet_address\": \"3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6\",\n      \"balance\": 139456.08,\n      \"balance_usd\": 12205457068.12,\n      \"symbol\": \"BTC\",\n      \"assets_name\": \"Bitcoin\",\n      \"price\": 87521.87117346626\n    },"
                  }
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "exchange",
            "in": "query",
            "required": true,
            "description": "Exchange name (e.g., Binance). Retrieve supported exchanges via the 'supported-exchange-pair' API.",
            "schema": {
              "type": "string",
              "default": "Binance"
            }
          },
          {
            "name": "per_page",
            "in": "query",
            "required": false,
            "description": "Number of results per page.",
            "schema": {
              "type": "string",
              "default": "10"
            }
          },
          {
            "name": "page",
            "in": "query",
            "required": false,
            "description": "Page number for pagination, default: 1",
            "schema": {
              "type": "string",
              "default": "1"
            }
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