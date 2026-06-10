> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Option Max Pain

This endpoint provides the max pain price for options.

***Cache / Update Frequency:*** every 1 minute for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

&#x20;

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "date": "250422",                                   // Date (YYMMDD format)
      "call_open_interest_market_value": 1616749.22,      // Call option market value (USD)
      "put_open_interest": 512.5,                         // Put option open interest (contracts)
      "put_open_interest_market_value": 49687.62,         // Put option market value (USD)
      "max_pain_price": "84000",                          // Max pain price
      "call_open_interest": 953.7,                        // Call option open interest (contracts)
      "call_open_interest_notional": 83519113.56,         // Call option notional value (USD)
      "put_open_interest_notional": 44881569.13           // Put option notional value (USD)
    },
    {
      "date": "250423",                                   // Date (YYMMDD format)
      "call_open_interest_market_value": 2274700.52,      // Call option market value (USD)
      "put_open_interest": 1204.3,                        // Put option open interest (contracts)
      "put_open_interest_market_value": 374536.01,        // Put option market value (USD)
      "max_pain_price": "85000",                          // Max pain price
      "call_open_interest": 1302.2,                       // Call option open interest (contracts)
      "call_open_interest_notional": 114040373.53,        // Call option notional value (USD)
      "put_open_interest_notional": 105465691.73          // Put option notional value (USD)
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
    "/api/option/max-pain": {
      "get": {
        "summary": "Option Max Pain",
        "description": "",
        "operationId": "option-max-pain",
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
            "name": "exchange",
            "in": "query",
            "required": true,
            "description": "Exchange name (e.g., Deribit, Binance, OKX). ",
            "schema": {
              "type": "string",
              "default": "Deribit"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"date\": \"250422\",                                   // Date (YYMMDD format)\n      \"call_open_interest_market_value\": 1616749.22,      // Call option market value (USD)\n      \"put_open_interest\": 512.5,                         // Put option open interest (contracts)\n      \"put_open_interest_market_value\": 49687.62,         // Put option market value (USD)\n      \"max_pain_price\": \"84000\",                          // Max pain price\n      \"call_open_interest\": 953.7,                        // Call option open interest (contracts)\n      \"call_open_interest_notional\": 83519113.56,         // Call option notional value (USD)\n      \"put_open_interest_notional\": 44881569.13           // Put option notional value (USD)\n    },\n    {\n      \"date\": \"250423\",                                   // Date (YYMMDD format)\n      \"call_open_interest_market_value\": 2274700.52,      // Call option market value (USD)\n      \"put_open_interest\": 1204.3,                        // Put option open interest (contracts)\n      \"put_open_interest_market_value\": 374536.01,        // Put option market value (USD)\n      \"max_pain_price\": \"85000\",                          // Max pain price\n      \"call_open_interest\": 1302.2,                       // Call option open interest (contracts)\n      \"call_open_interest_notional\": 114040373.53,        // Call option notional value (USD)\n      \"put_open_interest_notional\": 105465691.73          // Put option notional value (USD)\n    }\n  ]\n}\n"
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