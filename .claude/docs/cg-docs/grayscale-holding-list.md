# Holdings List

This endpoint provides a list of holdings managed by Grayscale Investments.

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
      "symbol": "ETH",                                  // Token symbol, 
      "primary_market_price": 29.89,                    // Price in the primary market 
      "secondary_market_price": 29.71,                  // Price in the secondary market 
      "premium_rate": -0.6,                             // Premium rate (%),
      "holdings_amount": 2630007.61026,                 // Current holding amount (in tokens)
      "holdings_usd": 4290752215.8347797,               // Total market value of holdings in USD
      "holdings_amount_change_30d": 0,                  // Change in holding amount over the past 30 days (in tokens)
      "holdings_amount_change_7d": 0,                   // Change in holding amount over the past 7 days (in tokens)
      "holdings_amount_change1d": 0,                    // Change in holding amount over the past 1 day (in tokens)
      "close_time": 1721422800000,                      // Market close timestamp (milliseconds)
      "update_time": 1745203812007                      // Data update timestamp (milliseconds)
    },
    {
      "symbol": "ETC",                                  // Token symbol, e.g., ETC = Ethereum Classic
      "primary_market_price": 11.99,                    // Price in the primary market
      "secondary_market_price": 6.63,                   // Price in the secondary market
      "premium_rate": -44.7,                            // Premium rate, currently at a significant discount
      "holdings_amount": 11181376.733556,               // Current holding amount (in tokens)
      "holdings_usd": 181440200.2554132,                // Total market value of holdings in USD
      "holdings_amount_change_30d": -20697.669828,      // Change in holding amount over the past 30 days
      "holdings_amount_change_7d": -4596.123672,        // Change in holding amount over the past 7 days
      "holdings_amount_change1d": 0,                    // Change in holding amount over the past 1 day
      "close_time": 1744923600000,                      // Market close timestamp
      "update_time": 1745203812168                      // Data update timestamp
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
    "/api/grayscale/holdings-list": {
      "get": {
        "summary": "Holdings List",
        "description": "The API retrieves a list of holdings managed by Grayscale Investments.",
        "operationId": "grayscale-holding-list",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"symbol\": \"ETH\",                                  // Token symbol, e.g., ETH = Ethereum\n      \"primary_market_price\": 29.89,                    // Price in the primary market \n      \"secondary_market_price\": 29.71,                  // Price in the secondary market \n      \"premium_rate\": -0.6,                             // Premium rate (%),\n      \"holdings_amount\": 2630007.61026,                 // Current holding amount (in tokens)\n      \"holdings_usd\": 4290752215.8347797,               // Total market value of holdings in USD\n      \"holdings_amount_change_30d\": 0,                  // Change in holding amount over the past 30 days (in tokens)\n      \"holdings_amount_change_7d\": 0,                   // Change in holding amount over the past 7 days (in tokens)\n      \"holdings_amount_change1d\": 0,                    // Change in holding amount over the past 1 day (in tokens)\n      \"close_time\": 1721422800000,                      // Market close timestamp (milliseconds)\n      \"update_time\": 1745203812007                      // Data update timestamp (milliseconds)\n    },\n    {\n      \"symbol\": \"ETC\",                                  // Token symbol, e.g., ETC = Ethereum Classic\n      \"primary_market_price\": 11.99,                    // Price in the primary market\n      \"secondary_market_price\": 6.63,                   // Price in the secondary market\n      \"premium_rate\": -44.7,                            // Premium rate, currently at a significant discount\n      \"holdings_amount\": 11181376.733556,               // Current holding amount (in tokens)\n      \"holdings_usd\": 181440200.2554132,                // Total market value of holdings in USD\n      \"holdings_amount_change_30d\": -20697.669828,      // Change in holding amount over the past 30 days\n      \"holdings_amount_change_7d\": -4596.123672,        // Change in holding amount over the past 7 days\n      \"holdings_amount_change1d\": 0,                    // Change in holding amount over the past 1 day\n      \"close_time\": 1744923600000,                      // Market close timestamp\n      \"update_time\": 1745203812168                      // Data update timestamp\n    }\n  ]\n}\n"
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