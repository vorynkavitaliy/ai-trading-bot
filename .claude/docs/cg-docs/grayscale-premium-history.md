> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Premium History

This endpoint provides historical premium/discount data for Grayscale Investment Trusts relative to their NAV.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Respones Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
     {
      "primary_market_price": [     // Primary market price list
        0.14,
        0.14
        // ...
      ],
      "date_list": [                // Date list (timestamps)
        1380171600000,
        1380258000000
        // ...
      ],
      "secondary_market_price_list": [  // Secondary market price list
        0.57,
        0.53
        // ...
      ],
      "premium_rate_list": [          // Premium rate list
        19.37,
        15.59
        // ...
      ]
    },
      ....
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
    "/api/grayscale/premium-history": {
      "get": {
        "summary": "Premium History",
        "description": "The API retrieves historical premium/discount data for Grayscale Investment Trusts relative to their NAV.",
        "operationId": "grayscale-premium-history",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Supported values: ETC, LTC, BCH, SOL, XLM, LINK, ZEC, MANA, ZEN, FIL, BAT, LPT",
            "schema": {
              "type": "string",
              "default": "BTC"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n     {\n      \"primary_market_price\": [     // Primary market price list\n        0.14,\n        0.14\n        // ...\n      ],\n      \"date_list\": [                // Date list (timestamps)\n        1380171600000,\n        1380258000000\n        // ...\n      ],\n      \"secondary_market_price_list\": [  // Secondary market price list\n        0.57,\n        0.53\n        // ...\n      ],\n      \"premium_rate_list\": [          // Premium rate list\n        19.37,\n        15.59\n        // ...\n      ]\n    },\n      ....\n  ]\n}\n"
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