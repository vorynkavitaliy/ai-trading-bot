> ## Documentation Index
>
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Supported Exchange and Pairs

Check the supported exchange and trading pairs in the API documentation

**_Cache / Update Frequency:_** every 1 minutes for all the API plans.

**_This endpoint is available on the following_** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅       | ✅      | ✅       | ✅           | ✅         |

<br />

**Response Data**

```json
{
  "code": "0",
  "msg": "success",
  "data": {
    "Binance": [ // exchange name
      {
        "instrument_id": "BTCUSD_PERP",// futures pair
        "base_asset": "BTC",// base asset
        "quote_asset": "USD"// quote asset
        "settlement_currency": "USDT", // Settlement currency
        "max_leverage": 100, // Maximum supported leverage
        "funding_interval": 1, // Funding rate settlement interval
        "price_tick_size": 0.1 // Price precision & minimum price increment
      },
      {
        "instrument_id": "BTCUSD_250627",
        "base_asset": "BTC",
        "quote_asset": "USD"
        "settlement_currency": "USDT",
        "max_leverage": 100,
        "funding_interval": 1,
        "price_tick_size": 0.1
      },
      ....
      ],
    "Bitget": [
      {
        "instrument_id": "BTCUSDT_UMCBL",
        "base_asset": "BTC",
        "quote_asset": "USDT"
        "settlement_currency": "USDT",
        "max_leverage": 100,
        "funding_interval": 1,
        "price_tick_size": 0.1
      },
      {
        "instrument_id": "ETHUSDT_UMCBL",
        "base_asset": "ETH",
        "quote_asset": "USDT"
        "settlement_currency": "USDT",
        "max_leverage": 100,
        "funding_interval": 1,
        "price_tick_size": 0.1
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
    "/api/futures/supported-exchange-pairs": {
      "get": {
        "summary": "Suported Exchange and Pairs",
        "description": "Check the supported exchange and trading pairs in the API documentation",
        "operationId": "instruments",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"Binance\": [ // exchange name\n      {\n        \"instrument_id\": \"BTCUSD_PERP\",// futures pair\n        \"base_asset\": \"BTC\",// base asset\n        \"quote_asset\": \"USD\"// quote asset\n      },\n      {\n        \"instrument_id\": \"BTCUSD_250627\",\n        \"base_asset\": \"BTC\",\n        \"quote_asset\": \"USD\"\n      },\n      ....\n      ],\n    \"Bitget\": [\n      {\n        \"instrument_id\": \"BTCUSDT_UMCBL\",\n        \"base_asset\": \"BTC\",\n        \"quote_asset\": \"USDT\"\n      },\n      {\n        \"instrument_id\": \"ETHUSDT_UMCBL\",\n        \"base_asset\": \"ETH\",\n        \"quote_asset\": \"USDT\"\n      },\n      ...\n      ]\n      ...\n   }\n}"
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
            "content": {}
          }
        },
        "deprecated": false,
        "x-readme": {
          "code-samples": [
            {
              "language": "text",
              "code": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"Binance\": [\n      {\n        \"instrumentId\": \"BTCUSD_PERP\",\n        \"baseAsset\": \"BTC\",\n        \"quoteAsset\": \"USD\"\n      },\n      {\n        \"instrumentId\": \"BTCUSD_240927\",\n        \"baseAsset\": \"BTC\",\n        \"quoteAsset\": \"USD\"\n      }..."
            }
          ],
          "samples-languages": ["text"]
        },
        "parameters": [
          {
            "in": "query",
            "name": "exchange",
            "schema": {
              "type": "string"
            },
            "description": "Filters the results to return only trading pairs from the specified exchange."
          }
        ]
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
