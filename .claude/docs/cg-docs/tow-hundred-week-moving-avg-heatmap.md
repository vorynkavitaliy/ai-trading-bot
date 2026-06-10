> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 200-Week Moving Avg Heatmap

This endpoint provides data for the 200-Week Moving Avg Heatmap

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
      "timestamp": 1325203200000,          // Timestamp (in milliseconds)
      "price": 4.31063509000584,           // Current price
      "moving_average_1440": 4.143619070636635, // 200-week moving average (1440 represents the period)
      "moving_average_1440_ip": 0,         // Position of the moving average (IP indicator)
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
    "/api/index/200-week-moving-average-heatmap": {
      "get": {
        "summary": "200-Week Moving Avg Heatmap",
        "description": "",
        "operationId": "tow-hundred-week-moving-avg-heatmap",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                              \n  \"msg\": \"success\",                         \n  \"data\": [\n    {\n      \"timestamp\": 1325203200000,          // Timestamp (in milliseconds)\n      \"price\": 4.31063509000584,           // Current price\n      \"moving_average_1440\": 4.143619070636635, // 200-week moving average (1440 represents the period)\n      \"moving_average_1440_ip\": 0,         // Position of the moving average (IP indicator)\n    }\n  ]\n}\n"
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