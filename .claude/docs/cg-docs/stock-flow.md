> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stock-to-Flow Model

This endpoint provides data for the Stock-to-Flow model, including the price and the number of days remaining until the next halving event for specific timestamps.

***Cache / Update Frequency:*** every day for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "timestamp": 1282003200000,       // Timestamp (in milliseconds)
      "price": 0.07,                     // Price on the given day
      "next_halving": 834               // Days remaining until the next halving
    },
    {
      "timestamp": 1282089600000,       // Timestamp (in milliseconds)
      "price": 0.068,                    // Price on the given day
      "next_halving": 833               // Days remaining until the next halving
    }

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
    "/api/index/stock-flow": {
      "get": {
        "summary": "Stock-to-Flow Model",
        "description": "",
        "operationId": "stock-flow",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"timestamp\": 1282003200000,       // Timestamp (in milliseconds)\n      \"price\": 0.07,                     // Price on the given day\n      \"next_halving\": 834               // Days remaining until the next halving\n    },\n    {\n      \"timestamp\": 1282089600000,       // Timestamp (in milliseconds)\n      \"price\": 0.068,                    // Price on the given day\n      \"next_halving\": 833               // Days remaining until the next halving\n    }\n\n  ]\n}\n"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          }
        },
        "deprecated": false
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