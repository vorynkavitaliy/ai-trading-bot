> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Tow Year Ma Multiplier

This endpoint provides data for the Tow Year Ma Multiplier

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
      "timestamp": 1282003200000,               // Timestamp (in milliseconds)
      "price": 0.07,                            // Current price
      "moving_average_730": 0.07,               // 2-year moving average (730 represents the period)
      "moving_average_730_multiplier_5": 0.35000000000000003, // 5 times the 2-year moving average (Multiplier)
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
    "/api/index/2-year-ma-multiplier": {
      "get": {
        "summary": "Tow Year Ma Multiplier",
        "description": "",
        "operationId": "tow-year-ma-multiplier",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                              \n  \"msg\": \"success\",                         \n  \"data\": [\n    {\n      \"timestamp\": 1282003200000,               // Timestamp (in milliseconds)\n      \"price\": 0.07,                            // Current price\n      \"moving_average_730\": 0.07,               // 2-year moving average (730 represents the period)\n      \"moving_average_730_multiplier_5\": 0.35000000000000003, // 5 times the 2-year moving average (Multiplier)\n    }\n  ]\n}\n"
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