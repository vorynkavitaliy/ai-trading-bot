# Puell-Multiple

This endpoint provides the Puell-Multiple index, which includes data on buy and sell quantities, the price, and the Puell-Multiple value at specific timestamps.

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
      "timestamp": 1282003200000,           // Timestamp (in milliseconds)
      "price": 0.07,                         // Price on the given day
      "puell_multiple": 1                   // Puell Multiple value
    },
    {
      "timestamp": 1282089600000,           // Timestamp (in milliseconds)
      "price": 0.068,                        // Price on the given day
      "puell_multiple": 1.0007745933384973  // Puell Multiple value
    }
    ...
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
    "/api/index/puell-multiple": {
      "get": {
        "summary": "Puell-Multiple",
        "description": "",
        "operationId": "puell-multiple",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                              \n  \"msg\": \"success\",                        \n  \"data\": [\n    {\n      \"timestamp\": 1282003200000,           // Timestamp (in milliseconds)\n      \"price\": 0.07,                         // Price on the given day\n      \"puell_multiple\": 1                   // Puell Multiple value\n    },\n    {\n      \"timestamp\": 1282089600000,           // Timestamp (in milliseconds)\n      \"price\": 0.068,                        // Price on the given day\n      \"puell_multiple\": 1.0007745933384973  // Puell Multiple value\n    }\n    ...\n  ]\n}\n"
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