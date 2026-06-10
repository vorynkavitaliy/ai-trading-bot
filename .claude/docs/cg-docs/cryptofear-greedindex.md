# Crypto Fear & Greed Index

This endpoint provides data for the Crypto Fear & Greed Index

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
      "data_list": [4611285.1141, ...],         // Fear and Greed Index values
      "price_list": [4788636.51145, ...],         // Corresponding price data
      "time_list": [1636588800, ...]        // Timestamps
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
    "/api/index/fear-greed-history": {
      "get": {
        "summary": "Crypto Fear & Greed Index",
        "description": "",
        "operationId": "cryptofear-greedindex",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                             \n  \"msg\": \"success\",                        \n  \"data\": [\n    {\n      \"data_list\": [4611285.1141, ...],         // Fear and Greed Index values\n      \"price_list\": [4788636.51145, ...],         // Corresponding price data\n      \"time_list\": [1636588800, ...]        // Timestamps\n    }\n  ]\n}"
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