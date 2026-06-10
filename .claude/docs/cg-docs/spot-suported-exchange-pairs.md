> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Suported Exchange and Pairs

This endpoint allows you to query all supported spot trading exchanges and their corresponding trading pairs on CoinGlass.

***Cache / Update Frequency:*** every 1 minutes for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "msg": "success",
  "data": {
    "Binance": [ // exchange name
      {
        "instrument_id": "BTCUSD_USDT",// Spot pair
        "base_asset": "BTC",// base asset
        "quote_asset": "USDT"// quote asset
      },
      {
        "instrument_id": "ETHUSD_USDT",
        "base_asset": "ETH",
        "quote_asset": "USDT"
      },
      ....
      ],
    "Bitget": [
      {
        "instrument_id": "AAVE:USD",
        "base_asset": "AAVE",
        "quote_asset": "USD"
      },
      {
        "instrument_id": "ADAUSD",
        "base_asset": "ADA",
        "quote_asset": "USD"
      },
      ...
      ]
      ...
   }
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
    "/api/spot/supported-exchange-pairs": {
      "get": {
        "summary": "Suported Exchange and Pairs",
        "description": "Check the supported exchange and trading pairs in the API documentation",
        "operationId": "spot-suported-exchange-pairs",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"Binance\": [ // exchange name\n      {\n        \"instrument_id\": \"BTCUSD_USDT\",// Spot pair\n        \"base_asset\": \"BTC\",// base asset\n        \"quote_asset\": \"USDT\"// quote asset\n      },\n      {\n        \"instrument_id\": \"ETHUSD_USDT\",\n        \"base_asset\": \"ETH\",\n        \"quote_asset\": \"USDT\"\n      },\n      ....\n      ],\n    \"Bitget\": [\n      {\n        \"instrument_id\": \"AAVE:USD\",\n        \"base_asset\": \"AAVE\",\n        \"quote_asset\": \"USD\"\n      },\n      {\n        \"instrument_id\": \"ADAUSD\",\n        \"base_asset\": \"ADA\",\n        \"quote_asset\": \"USD\"\n      },\n      ...\n      ]\n      ...\n   }\n}"
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