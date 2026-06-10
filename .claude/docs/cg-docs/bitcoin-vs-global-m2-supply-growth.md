# Bitcoin vs Global M2 Supply & Growth

This endpoint provides data for the bitcoin vs global m2 supply & growth

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
      "timestamp": 1369008000000,
      "price": 117.8186364699,
      "global_m2_yoy_growth": 5.5654014717,
      "global_m2_supply": 59166686473105
    },
    {
      "timestamp": 1369612800000,
      "price": 126.392905903,
      "global_m2_yoy_growth": 5.8571414345,
      "global_m2_supply": 59490171457382
    },
    {
      "timestamp": 1370217600000,
      "price": 122.9491879018,
      "global_m2_yoy_growth": 6.7670545757,
      "global_m2_supply": 60072386054198
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
    "/api/index/bitcoin-vs-global-m2-growth": {
      "get": {
        "description": "",
        "operationId": "get_apiindexbitcoin-vs-global-m2-growth",
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