# Pi Cycle Top Indicator

This endpoint provides data for the Pi Cycle Top Indicator, including the 111-day moving average (ma110), the 350-day moving average multiplied by 2 (ma350Mu2), and the price at specific timestamps.

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
      "ma_110": 0.07,                     // 110-day moving average price
      "timestamp": 1282003200000,        // Timestamp (milliseconds)
      "ma_350_mu_2": 0.14,               // 2x value of 350-day moving average
      "price": 0.07                      // Daily price
    },
    {
      "ma_110": 0.069,                   // 110-day moving average price
      "timestamp": 1282089600000,        // Timestamp (milliseconds)
      "ma_350_mu_2": 0.138,              // 2x value of 350-day moving average
      "price": 0.068                     // Daily price
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
    "/api/index/pi-cycle-indicator": {
      "get": {
        "summary": "Pi Cycle Top Indicator",
        "description": "",
        "operationId": "pi",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                             \n  \"msg\": \"success\",                       \n  \"data\": [\n    {\n      \"ma_110\": 0.07,                     // 110-day moving average price\n      \"timestamp\": 1282003200000,        // Timestamp (milliseconds)\n      \"ma_350_mu_2\": 0.14,               // 2x value of 350-day moving average\n      \"price\": 0.07                      // Daily price\n    },\n    {\n      \"ma_110\": 0.069,                   // 110-day moving average price\n      \"timestamp\": 1282089600000,        // Timestamp (milliseconds)\n      \"ma_350_mu_2\": 0.138,              // 2x value of 350-day moving average\n      \"price\": 0.068                     // Daily price\n    }\n  ]\n}\n"
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