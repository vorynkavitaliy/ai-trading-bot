> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Bitcoin Long Term Holder Realized Price

This endpoint provides data for the bitcoin long term holder realized price

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
      "timestamp": 1325376000000,
      "price": 4.61211781,
      "lth_realized_price": 4.8958766225
    },
    {
      "timestamp": 1325462400000,
      "price": 5.13201225,
      "lth_realized_price": 4.8806352365
    },
    {
      "timestamp": 1325548800000,
      "price": 5.21773083,
      "lth_realized_price": 4.8736945702
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
    "/api/index/bitcoin-lth-realized-price": {
      "get": {
        "description": "",
        "operationId": "get_apiindexbitcoin-lth-realized-price",
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