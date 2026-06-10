# Exchange Open Interest History

This endpoint provides historical open interest data for options across different exchanges

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
      "time_list": [1691460000000, ...],       // Array of timestamps (in milliseconds)
      "price_list": [29140.9, ...],            // Array of prices corresponding to each timestamp
      "data_map": {                            // Open Interest (OI) data by exchange
        "huobi": [15167.03527, ...],           // OI data from Huobi exchange
        "gate": [23412.723, ...],              // OI data from Gate exchange
        ...
      }
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
    "/api/option/exchange-oi-history": {
      "get": {
        "summary": "Exchange Open Interest History",
        "description": "",
        "operationId": "exchange-open-interest-history",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC,ETH). ",
            "schema": {
              "type": "string",
              "default": "BTC"
            }
          },
          {
            "name": "unit",
            "in": "query",
            "required": true,
            "description": "Specify the unit for the returned data. Supported values depend on the symbol. If symbol is BTC, choose between USD or BTC. For ETH, choose between USD or ETH.",
            "schema": {
              "type": "string",
              "default": "USD"
            }
          },
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for the data. Supported values: 1h, 4h, 12h, all.",
            "schema": {
              "type": "string",
              "default": "1h"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",                                 \n  \"msg\": \"success\",                            \n  \"data\": [\n    {\n      \"time_list\": [1691460000000, ...],       // Array of timestamps (in milliseconds)\n      \"price_list\": [29140.9, ...],            // Array of prices corresponding to each timestamp\n      \"data_map\": {                            // Open Interest (OI) data by exchange\n        \"huobi\": [15167.03527, ...],           // OI data from Huobi exchange\n        \"gate\": [23412.723, ...],              // OI data from Gate exchange\n        ...\n      }\n    }\n  ]\n}\n"
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