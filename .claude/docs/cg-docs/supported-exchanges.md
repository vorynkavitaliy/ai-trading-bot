# Supported Exchanges

This endpoint allows you to query all the supported exchanges on CoinGlass

**_This endpoint is available on the following_** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅       | ✅      | ✅       | ✅           | ✅         |

### Response Data

```json
{
  "code": "0",
  "data": [
    "OKX",
    "Binance",
    "HTX",
    "Bitmex",
    "Bitfinex",
    "Bybit",
    "Deribit",
    "Gate",
    "Kraken",
    "KuCoin",
    "CME",
    "Bitget",
    "dYdX",
    "CoinEx",
    "BingX",
    "Coinbase",
    "Gemini",
    "Crypto.com",
    "Hyperliquid",
    "Bitunix",
    "MEXC",
    "WhiteBIT",
    "Aster",
    "Lighter",
    "EdgeX",
    "Drift",
    "Paradex",
    "Extended",
    "ApeX Omni"
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
    "/api/futures/supported-exchanges": {
      "get": {
        "description": "",
        "operationId": "get_apifuturessupported-exchanges",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": []
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
