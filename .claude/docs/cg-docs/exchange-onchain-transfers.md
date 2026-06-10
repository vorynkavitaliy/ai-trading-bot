> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Exchange On-chain Transfers (ERC-20)

This endpoint provides on-chain transfer records (ERC-20) for exchanges.

***Cache / Update Frequency:*** Real time for all the API plans.

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
      "transaction_hash": "0xb8d08182d2de176ac42dceba9ff82a7a5fe650c1e56285d6810daac9561ff9dc", // Transaction hash
      "asset_symbol": "USDT",                       // Asset symbol
      "amount_usd": 9998.5,                         // Amount in USD
      "asset_quantity": 9998.5,                     // Quantity
      "exchange_name": "Coinbase",                 // Exchange name
      "transfer_type": 1,                           // Transfer type: 1 = Inflow, 2 = Outflow, 3 = Internal transfer
      "from_address": "0x16c6897438c4f0c7894862d884549e8564c4025f", // From address
      "to_address": "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43",   // To address
      "transaction_time": 1745224211                // Transaction time (timestamp in seconds)
    },
    {
      "transaction_hash": "0x033c56cb05654f2c360235eff99c84f0eee9c6330fc7012930adfe0a88789c0f", // Transaction hash
      "asset_symbol": "MANA",                       // Asset symbol
      "amount_usd": 6368.95196834,                  // Amount in USD
      "asset_quantity": 20091.33113044,             // Quantity
      "exchange_name": "Binance",                  // Exchange name
      "transfer_type": 1,                           // Transfer type: 1 = Inflow, 2 = Outflow, 3 = Internal transfer
      "from_address": "0x06fd4ba7973a0d39a91734bbc35bc2bcaa99e3b0", // From address
      "to_address": "0x28c6c06298d514db089934071355e5743bf21d60",   // To address
      "transaction_time": 1745224211                // Transaction time (timestamp in seconds)
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
    "/api/exchange/chain/tx/list": {
      "get": {
        "summary": "Exchange On-chain Transfers (ERC-20)",
        "description": "The API retrieves on-chain transfer records for exchanges.",
        "operationId": "exchange-onchain-transfers",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": false,
            "description": "Must be a token symbol supported by the ERC-20 protocol on the Ethereum (ETH) network.",
            "schema": {
              "type": "string",
              "default": ""
            }
          },
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds (e.g., 1706089927315).",
            "schema": {
              "type": "integer",
              "format": "int64",
              "default": 1706089927315
            }
          },
          {
            "name": "min_usd",
            "in": "query",
            "required": false,
            "description": "Minimum transfer amount filter, specified in USD.",
            "schema": {
              "type": "number",
              "format": "double",
              "default": ""
            }
          },
          {
            "name": "per_page",
            "in": "query",
            "required": false,
            "description": "Number of results per page.  Max:100",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": "10"
            }
          },
          {
            "name": "page",
            "in": "query",
            "required": false,
            "description": "Page number for pagination, default: 1.",
            "schema": {
              "type": "integer",
              "format": "int32",
              "default": "1"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"transaction_hash\": \"0xb8d08182d2de176ac42dceba9ff82a7a5fe650c1e56285d6810daac9561ff9dc\", // Transaction hash\n      \"asset_symbol\": \"USDT\",                       // Asset symbol\n      \"amount_usd\": 9998.5,                         // Amount in USD\n      \"asset_quantity\": 9998.5,                     // Quantity\n      \"exchange_name\": \"Coinbase\",                 // Exchange name\n      \"transfer_type\": 1,                           // Transfer type: 1 = Inflow, 2 = Outflow, 3 = Internal transfer\n      \"from_address\": \"0x16c6897438c4f0c7894862d884549e8564c4025f\", // From address\n      \"to_address\": \"0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43\",   // To address\n      \"transaction_time\": 1745224211                // Transaction time (timestamp in seconds)\n    },\n    {\n      \"transaction_hash\": \"0x033c56cb05654f2c360235eff99c84f0eee9c6330fc7012930adfe0a88789c0f\", // Transaction hash\n      \"asset_symbol\": \"MANA\",                       // Asset symbol\n      \"amount_usd\": 6368.95196834,                  // Amount in USD\n      \"asset_quantity\": 20091.33113044,             // Quantity\n      \"exchange_name\": \"Binance\",                  // Exchange name\n      \"transfer_type\": 1,                           // Transfer type: 1 = Inflow, 2 = Outflow, 3 = Internal transfer\n      \"from_address\": \"0x06fd4ba7973a0d39a91734bbc35bc2bcaa99e3b0\", // From address\n      \"to_address\": \"0x28c6c06298d514db089934071355e5743bf21d60\",   // To address\n      \"transaction_time\": 1745224211                // Transaction time (timestamp in seconds)\n    }\n  ]\n}\n"
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