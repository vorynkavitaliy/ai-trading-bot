# Bitcoin Profitable Days

This endpoint provides data for the Bitcoin Profitable Days

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
      "side": 1,                              // Trade direction, 1 represents buy, 0 represents sell
      "timestamp": 1282003200000,             // Timestamp (in milliseconds)
      "price": 0.07                           // Price
    },
    {
      "timestamp": 1282089600000,             // Timestamp (in milliseconds)
      "price": 0.068,                         // Price
      "side": 1                               // Trade direction, 1 represents buy, 0 represents sell
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
    "/api/index/bitcoin/profitable-days": {
      "get": {
        "summary": "Bitcoin Profitable Days",
        "description": "",
        "operationId": "bitcoin-profitable-days",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                              \n  \"msg\": \"success\",                        \n  \"data\": [\n    {\n      \"side\": 1,                              // Trade direction, 1 represents buy, 0 represents sell\n      \"timestamp\": 1282003200000,             // Timestamp (in milliseconds)\n      \"price\": 0.07                           // Price\n    },\n    {\n      \"timestamp\": 1282089600000,             // Timestamp (in milliseconds)\n      \"price\": 0.068,                         // Price\n      \"side\": 1                               // Trade direction, 1 represents buy, 0 represents sell\n    }\n  ]\n}\n"
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