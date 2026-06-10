> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# ETF Flows History

This endpoint provides a list of key status information regarding the history of ETF flows.

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
      "timestamp": 1778544000000,
      "flow_usd": 1200000,
      "price_usd": 41.995,
      "etf_flows": [
        {
          "etf_ticker": "BHYP"
        },
        {
          "etf_ticker": "THYP",
          "flow_usd": 1200000
        }
      ]
    },
    {
      "timestamp": 1778630400000,
      "flow_usd": 1400000,
      "price_usd": 40.243,
      "etf_flows": [
        {
          "etf_ticker": "BHYP"
        },
        {
          "etf_ticker": "THYP",
          "flow_usd": 1400000
        }
      ]
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
    "/api/etf/hype/flow-history": {
      "get": {
        "description": "This endpoint provides a list of key status information regarding the history of ETF flows.",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [],
        "operationId": "get_api-etf-hype-flow-history",
        "summary": "ETF Flows History"
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