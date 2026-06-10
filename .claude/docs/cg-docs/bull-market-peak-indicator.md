# Bull Market Peak Indicators

This endpoint provides a list of Bull Market Peak Indicators

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
      "indicator_name": "Bitcoin Ahr999 Index",  // Indicator name
      "current_value": "0.78",                  // Current value
      "target_value": "4",                      // Target value
      "previous_value": "0.77",                 // Previous value
      "change_value": "0.0009811160359081",     // Change value
      "comparison_type": ">=",                  // Comparison type
      "hit_status": false                       // Hit status (whether the target condition is met)
    },
    {
      "indicator_name": "Pi Cycle Top Indicator",  // Indicator name
      "current_value": "85073.0",                  // Current value
      "target_value": "154582",                    // Target value
      "previous_value": "85127.0",                 // Previous value
      "change_value": "-54.0",                     // Change value
      "comparison_type": ">=",                     // Comparison type
      "hit_status": false                          // Hit status (whether the target condition is met)
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
    "/api/bull-market-peak-indicator": {
      "get": {
        "summary": "Bull Market Peak Indicators",
        "description": "",
        "operationId": "bull-market-peak-indicator",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": ""
                  },
                  "New Example": {
                    "summary": "New Example",
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"indicator_name\": \"Bitcoin Ahr999 Index\",  // Indicator name\n      \"current_value\": \"0.78\",                  // Current value\n      \"target_value\": \"4\",                      // Target value\n      \"previous_value\": \"0.77\",                 // Previous value\n      \"change_value\": \"0.0009811160359081\",     // Change value\n      \"comparison_type\": \">=\",                  // Comparison type\n      \"hit_status\": false                       // Hit status (whether the target condition is met)\n    },\n    {\n      \"indicator_name\": \"Pi Cycle Top Indicator\",  // Indicator name\n      \"current_value\": \"85073.0\",                  // Current value\n      \"target_value\": \"154582\",                    // Target value\n      \"previous_value\": \"85127.0\",                 // Previous value\n      \"change_value\": \"-54.0\",                     // Change value\n      \"comparison_type\": \">=\",                     // Comparison type\n      \"hit_status\": false                          // Hit status (whether the target condition is met)\n    }\n  ]\n}\n"
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