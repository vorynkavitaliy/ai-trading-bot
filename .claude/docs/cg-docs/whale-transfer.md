# Whale Transfer

This endpoint provides large on-chain transfers (minimum $10M) within the past six months across major blockchains, including Bitcoin, Ethereum, Tron, Ripple, Dogecoin, Litecoin, Polygon, Algorand, Bitcoin Cash, and Solana.

Cache / Update Frequency: Real time for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0", // status: "0" = success
  "data": [
    {
      "transaction_hash": "0x910ade7323eae57017c1894078ff1ce319fe908709ba185d81147588ceb06dcc",//transaction hash
      "amount_usd": "18403606.873493258", // transfer value in USD
      "asset_quantity": "10081.791421235566", // transferred amount
      "asset_symbol": "WETH", // asset symbol
      "from": "unknown wallet", // sender 
      "to": "unknown wallet", // receiver 
      "blockchain_name": "ethereum", // blockchain name
      "block_height": 22402402, // block number
      "block_timestamp": 1746265043 // block time (unix)
    },
    {
      "transaction_hash": "7b1fa0327a1e68fbcc397eee0a75ae8ced8c19c08d32f5cfd2ec5d3ba04e59fe",//transaction hash
      "amount_usd": "18413630.94247512", // transfer value in USD
      "asset_quantity": "10087.28276721801", // transferred amount
      "asset_symbol": "WETH", // asset symbol
      "from": "unknown wallet", // sender 
      "to": "unknown wallet", // receiver 
      "blockchain_name": "ethereum", // blockchain name
      "block_height": 22402402, // block number
      "block_timestamp": 1746265043 // block time (unix)
    }
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
    "/api/chain/v2/whale-transfer": {
      "get": {
        "description": "",
        "operationId": "get_apichainwhale-transfer",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "symbol",
            "schema": {
              "type": "string"
            },
            "description": "Trading coin (e.g., BTC). Retrieve supported coins via the 'supported-coins' API."
          },
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "string"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "string"
            },
            "description": "End timestamp in milliseconds (e.g., 1641522717000)."
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