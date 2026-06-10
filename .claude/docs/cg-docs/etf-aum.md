# ETF AUM

This endpoint provides historical Assets Under Management (AUM) data for Bitcoin ETFs

***Cache / Update Frequency:*** every 1 day for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "time": 1704153600000,
      "aum_usd": 0
    },
    {
      "time": 1704240000000,
      "aum_usd": 0
    },
    ....
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
    "/api/etf/bitcoin/aum": {
      "get": {
        "description": "",
        "operationId": "etf-aum",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "name": "ticker",
            "in": "query",
            "required": false,
            "description": "ETF ticker symbol (e.g., GBTC, IBIT).",
            "schema": {
              "type": "string",
              "default": ""
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