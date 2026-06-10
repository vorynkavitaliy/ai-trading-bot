> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coin Average True Range (ATR) List

This API provides Average True Range (ATR) indicator data for multiple coins across different time intervals.

**Cache / Update Frequency:** Updates every 10 seconds.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "symbol": "BTC",
      "avg_true_range_1m": 29.96118,
      "avg_true_range_5m": 81.93299,
      "avg_true_range_15m": 170.15648,
      "avg_true_range_30m": 279.27184,
      "avg_true_range_1h": 495.52303,
      "avg_true_range_4h": 1080.68816,
      "avg_true_range_1d": 2998.03821,
      "avg_true_range_1w": 9003.12081
    },
    {
      "symbol": "ETH",
      "avg_true_range_1m": 1.25441,
      "avg_true_range_5m": 3.40808,
      "avg_true_range_15m": 6.68785,
      "avg_true_range_30m": 11.25638,
      "avg_true_range_1h": 20.12117,
      "avg_true_range_4h": 44.65185,
      "avg_true_range_1d": 123.54839,
      "avg_true_range_1w": 436.83828
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
    "/api/futures/avg-true-range/list": {
      "get": {
        "description": "",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [],
        "operationId": "get_api-futures-avg-true-range-list"
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