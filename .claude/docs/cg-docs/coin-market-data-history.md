# Market Data History

This endpoint provides historical data for circulating supply, market capitalization, and price across multiple cryptocurrencies.

***Cache / Update Frequency:*** Updated once a day.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "timestamp": 1278979200000,
      "price": "0.0618333200",
      "circulating_supply": "3344213.1401855564",
      "market_cap": 194510.84
    },
    {
      "timestamp": 1279065600000,
      "price": "0.0581572500",
      "circulating_supply": "3373268.860625196",
      "market_cap": 190259.65
    },
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
    "/api/coin/market-data-history": {
      "get": {
        "description": "",
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
            "required": true,
            "description": "Trading coin (e.g., BTC). Retrieve supported coins via the 'supported-coins' API."
          }
        ],
        "operationId": "get_api-coin-market-data-history"
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