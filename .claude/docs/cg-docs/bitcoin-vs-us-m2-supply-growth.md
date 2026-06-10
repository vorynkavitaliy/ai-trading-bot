# Bitcoin vs US M2 Supply & Growth

This endpoint provides data for the bitcoin vs US m2 supply & growth

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
      "timestamp": 1278979200000,
      "price": 0.06183332,
      "us_m2_yoy_growth": 0.1321,
      "us_m2_supply": 8639800000000
    },
    {
      "timestamp": 1279065600000,
      "price": 0.05815725,
      "us_m2_yoy_growth": 0.1321,
      "us_m2_supply": 8639800000000
    },
    {
      "timestamp": 1279152000000,
      "price": 0.05640261,
      "us_m2_yoy_growth": 0.1321,
      "us_m2_supply": 8639800000000
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
    "/api/index/bitcoin-vs-us-m2-growth": {
      "get": {
        "description": "",
        "operationId": "get_apiindexbitcoin-vs-us-m2-growth",
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