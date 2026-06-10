> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Bitcoin Dominance

This endpoint provides data for the bitcoin dominance

***Cache / Update Frequency:*** 1 day for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

<br />

**Response Data**

```json
{
  "code": "0",
  "data": [
    {
      "timestamp": 1367366400000,
      "price": 139,
      "bitcoin_dominance": 94.3595,
      "market_cap": 1545031856
    },
    {
      "timestamp": 1367625600000,
      "price": 98.0999984741,
      "bitcoin_dominance": 93.8787,
      "market_cap": 1097883152
    },
    {
      "timestamp": 1367884800000,
      "price": 112.25,
      "bitcoin_dominance": 94.3851,
      "market_cap": 1240126128
    },
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
    "/api/index/bitcoin-dominance": {
      "get": {
        "description": "",
        "operationId": "get_apiindexbitcoin-dominance",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": []
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