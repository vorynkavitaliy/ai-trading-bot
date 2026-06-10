# Exchange Balance List

This endpoint provides exchange-level asset balance data, including total holdings and percentage changes over 1-day, 7-day, and 30-day periods.

***Cache / Update Frequency:*** every 1 hour for all the API plans.

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
      "exchange_name": "Coinbase",               // Exchange name
      "total_balance": 716590.351233,            // Total balance
      "balance_change_1d": 638.797302,           // Balance change in 24 hours
      "balance_change_percent_1d": 0.09,         // Balance change percentage in 24 hours (%)
      "balance_change_7d": 799.967408,           // Balance change in 7 days
      "balance_change_percent_7d": 0.11,         // Balance change percentage in 7 days (%)
      "balance_change_30d": -29121.977486,       // Balance change in 30 days
      "balance_change_percent_30d": -3.91        // Balance change percentage in 30 days (%)
    },
    {
      "exchange_name": "Binance",                // Exchange name
      "total_balance": 582344.497738,            // Total balance
      "balance_change_1d": 505.682778,           // Balance change in 24 hours
      "balance_change_percent_1d": 0.09,         // Balance change percentage in 24 hours (%)
      "balance_change_7d": -3784.88544,          // Balance change in 7 days
      "balance_change_percent_7d": -0.65,        // Balance change percentage in 7 days (%)
      "balance_change_30d": 3753.870055,         // Balance change in 30 days
      "balance_change_percent_30d": 0.65         // Balance change percentage in 30 days (%)
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
    "/api/exchange/balance/list": {
      "get": {
        "summary": "Exchange Balance List",
        "description": "",
        "operationId": "exchange-balance-list",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin eg. BTC , ETH , USDT(ETH).   Supported symbol: BTC, ETH, 1INCH, AAVE, AMP, BAL, BLZ, BNT, BUSD, CRV, DAI, DODO, ENS, FET, FTT, GRT, GTC, GUSD, HOT, HUSD, JASMY, KNC, LINK, MASK, MATIC, OCEAN, OMG, POLY, QNT, SAI, SKL, SRM, STORJ, SUSD, SUSHI, TUSD, UNI, USDC, USDK, USDP, USDT(ETH), VGX, XRP, YFI, ZRX",
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
                    "value": "{}"
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