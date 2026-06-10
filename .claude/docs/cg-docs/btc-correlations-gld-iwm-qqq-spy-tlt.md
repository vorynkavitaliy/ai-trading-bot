# Bitcoin Correlations 

This endpoint provides data for the bitcoin correlations (GLD, IWM, QQQ, SPY, TLT)

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
      "timestamp": 1284508800000,
      "price": 0.06080235,
      "gld": -0.5150866328682138,
      "iwm": -0.4464952558926045,
      "qqq": 0,
      "spy": -0.38000905719099726,
      "tlt": 0.32525293786188403
    },
    {
      "timestamp": 1284595200000,
      "price": 0.0805732,
      "gld": -0.1441145695322488,
      "iwm": -0.390257896507018,
      "qqq": 0,
      "spy": -0.3562006006485584,
      "tlt": 0.25421749956089384
    },
    {
      "timestamp": 1284681600000,
      "price": 0.09079794,
      "gld": 0.18856803587350612,
      "iwm": -0.06826869030058404,
      "qqq": 0,
      "spy": -0.03849870412867858,
      "tlt": -0.02643535666282007
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
    "/api/index/bitcoin-correlation": {
      "get": {
        "description": "",
        "operationId": "get_apiindexbitcoin-correlation",
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