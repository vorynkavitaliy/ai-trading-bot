# Bitcoin-Rainbow-Chart

This endpoint provides data for the Bitcoin Rainbow Chart

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
    [
      0.07,                                 // Current price
      0.033065,                             // Minimum value of shadow
      0.044064,                             // First layer
      0.059892,                             // Second layer
      0.082219,                             // Third layer
      0.110996,                             // Fourth layer
      0.149845,                             // Fifth layer
      0.205865,                             // Sixth layer
      0.283454,                             // Seventh layer
      0.380525,                             // Eighth layer
      0.517626,                             // Ninth layer
      1282003200000                        // Timestamp
    ]
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
    "/api/index/bitcoin/rainbow-chart": {
      "get": {
        "summary": "Bitcoin-Rainbow-Chart",
        "description": "",
        "operationId": "bitcoin-rainbow-chart",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                              \n  \"msg\": \"success\",                        \n  \"data\": [\n    [\n      0.07,                                 // Current price\n      0.033065,                             // Minimum value of shadow\n      0.044064,                             // First layer\n      0.059892,                             // Second layer\n      0.082219,                             // Third layer\n      0.110996,                             // Fourth layer\n      0.149845,                             // Fifth layer\n      0.205865,                             // Sixth layer\n      0.283454,                             // Seventh layer\n      0.380525,                             // Eighth layer\n      0.517626,                             // Ninth layer\n      1282003200000                        // Timestamp\n    ]\n  ]\n}\n"
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