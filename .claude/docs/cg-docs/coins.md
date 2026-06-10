> ## Documentation Index
>
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Supported Coins

This endpoint allows you to query all the supported coins on CoinGlass

**_Cache / Update Frequency:_** every 1 minutes for all the API plans.

**_This endpoint is available on the following_** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅       | ✅      | ✅       | ✅           | ✅         |

### Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
      "BTC",
      "ETH",
      "SOL",
      "XRP",
      ...
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
    "/api/futures/supported-coins": {
      "get": {
        "summary": "Supported Coins",
        "description": "Check the supported coins in this API documentation",
        "operationId": "coins",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n      \"BTC\",\n      \"ETH\",\n      \"SOL\",\n      \"XRP\",\n      ...\n  ]\n}"
                  }
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {}
          }
        },
        "deprecated": false,
        "x-readme": {
          "code-samples": [
            {
              "language": "text",
              "code": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    \"BTC\",\n    \"ETH\",\n    \"SOL\",\n    \"XRP\",\n    \"BNB\",\n    \"DOGE\",\n    \"1000PEPE\",\n    \"1000BONK\",\n    \"BCH\",\n    \"DOT\",\n    \"LTC\"...."
            }
          ],
          "samples-languages": ["text"]
        },
        "parameters": [],
        "security": [
          {
            "sec0": []
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
