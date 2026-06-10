> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Golden-Ratio-Multiplier

This endpoint provides data for the Golden Ratio Multiplier

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
      "low_bull_high_2": 0.14,                       // Bull market low-high ratio coefficient
      "timestamp": 1282003200000,                    // Timestamp (in milliseconds)
      "price": 0.07,                                 // Current price
      "ma_350": 0.07,                                // 350-day moving average
      "accumulation_high_1_6": 0.11200000000000002,  // Accumulation high ratio (1/6 golden ratio)
      "x_3": 0.21000000000000002,                    // Golden ratio multiple x3
      "x_5": 0.35000000000000003,                    // Golden ratio multiple x5
      "x_8": 0.56,                                   // Golden ratio multiple x8
      "x_13": 0.9100000000000001,                    // Golden ratio multiple x13
      "x_21": 1.4700000000000002                     // Golden ratio multiple x21
    },
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
    "/api/index/golden-ratio-multiplier": {
      "get": {
        "summary": "Golden-Ratio-Multiplier",
        "description": "",
        "operationId": "golden-ratio-multiplier",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"low_bull_high_2\": 0.14,                       // Bull market low-high ratio coefficient\n      \"timestamp\": 1282003200000,                    // Timestamp (in milliseconds)\n      \"price\": 0.07,                                 // Current price\n      \"ma_350\": 0.07,                                // 350-day moving average\n      \"accumulation_high_1_6\": 0.11200000000000002,  // Accumulation high ratio (1/6 golden ratio)\n      \"x_3\": 0.21000000000000002,                    // Golden ratio multiple x3\n      \"x_5\": 0.35000000000000003,                    // Golden ratio multiple x5\n      \"x_8\": 0.56,                                   // Golden ratio multiple x8\n      \"x_13\": 0.9100000000000001,                    // Golden ratio multiple x13\n      \"x_21\": 1.4700000000000002                     // Golden ratio multiple x21\n    },\n    ...\n  ]\n}\n"
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