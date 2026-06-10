> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Bitcoin Reserve Risk

This endpoint provides data for the bitcoin reserve risk

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
      "price": 0.07,
      "reserve_risk_index": 1.0463483830080946,
      "movcd": 0.0031006755142484214,
      "hodl_bank": 0.06689932448575159,
      "vocd": 0.0031006755142484214,
      "timestamp": 1282003200000
    },
    {
      "price": 0.068,
      "reserve_risk_index": 0.5285777367358181,
      "movcd": 0.006252211158717467,
      "hodl_bank": 0.12864711332703413,
      "vocd": 0.009403746803186513,
      "timestamp": 1282089600000
    },
    {
      "price": 0.0667,
      "reserve_risk_index": 0.3469505118474761,
      "movcd": 0.0031006755142484214,
      "hodl_bank": 0.19224643781278572,
      "vocd": 0.0018287503434234224,
      "timestamp": 1282176000000
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
    "/api/index/bitcoin-reserve-risk": {
      "get": {
        "description": "",
        "operationId": "get_apiindexbitcoin-reserve-risk",
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