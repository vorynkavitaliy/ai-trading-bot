# Exchange Balance Chart

This endpoint provides historical chart data of exchange asset balances over time, along with corresponding price data.

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
      "data_map": {                            // Balance data by exchange
        "huobi": [15167.03527, ...],           // Balance data from Huobi exchange
        "gate": [23412.723, ...],              // Balance data from Gate exchange
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
    "/api/exchange/balance/chart": {
      "get": {
        "summary": "Exchange Balance Chart",
        "description": "",
        "operationId": "exchange-balance-chart",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin eg. BTC, ETH,  USDT(ETH).    Trading coin eg. BTC , ETH , USDT(ETH).   Supported symbol: BTC, ETH, 1INCH, AAVE, AMP, BAL, BLZ, BNT, BUSD, CRV, DAI, DODO, ENS, FET, FTT, GRT, GTC, GUSD, HOT, HUSD, JASMY, KNC, LINK, MASK, MATIC, OCEAN, OMG, POLY, QNT, SAI, SKL, SRM, STORJ, SUSD, SUSHI, TUSD, UNI, USDC, USDK, USDP, USDT(ETH), VGX, XRP, YFI, ZRX",
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
                    "value": "{\n  \"code\": \"0\",                                 \n  \"msg\": \"success\",                            \n  \"data\": [\n    {\n      \"time_list\": [1691460000000, ...],       // Array of timestamps (in milliseconds)\n      \"price_list\": [29140.9, ...],            // Array of prices corresponding to each timestamp\n      \"data_map\": {                            // Balance data by exchange\n        \"huobi\": [15167.03527, ...],           // Balance data from Huobi exchange\n        \"gate\": [23412.723, ...],              // Balance data from Gate exchange\n        ...\n      }\n    }\n  ]\n}\n"
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