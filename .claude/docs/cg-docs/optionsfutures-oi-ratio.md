> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Options/Futures OI Ratio

This endpoint provides data for the options/futures oi ratio

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
      "btc_option_vs_futures_radio": 45.1,
      "eth_option_vs_futures_radio": 21.92,
      "timestamp": 1592956800000
    },
    {
      "btc_option_vs_futures_radio": 45.15,
      "eth_option_vs_futures_radio": 23.16,
      "timestamp": 1593043200000
    },
    {
      "btc_option_vs_futures_radio": 47.27,
      "eth_option_vs_futures_radio": 23.65,
      "timestamp": 1593129600000
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
    "/api/index/option-vs-futures-oi-ratio": {
      "get": {
        "description": "",
        "operationId": "get_apiindexoption-vs-futures-oi-ratio",
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