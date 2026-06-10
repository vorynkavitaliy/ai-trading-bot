> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Ethereum ETF List

This endpoint provides a list of key status information for Ethereum Exchange-Traded Funds (ETFs).

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
      "ticker": "ETHA",                                  // ETF ticker
      "name": "iShares Ethereum Trust ETF",              // ETF name
      "region": "us",                                    // Region
      "market_status": "closed",                         // Market status
      "primary_exchange": "XNAS",                        // Primary exchange
      "cik_code": "0002000638",                          // CIK code
      "type": "Spot",                                    // Type
      "market_cap": "544896000.00",                      // Market capitalization
      "list_date": 1721692800000,                        // Listing date
      "shares_outstanding": "28800000",                  // Shares outstanding
      "aum": "",                                         // Assets under management
      "management_fee_percent": "0.25",                  // Management fee percentage
      "last_trade_time": 1722988779939,                  // Last trade time
      "last_quote_time": 1722988799379,                  // Last quote time
      "volume_quantity": 5592645,                        // Volume quantity
      "volume_usd": 106447049.343,                       // Volume in USD
      "price": 18.92,                                    // Market price
      "price_change": 0.67,                              // Price change
      "price_change_percent": 3.67,                      // Price change percentage
      "asset_info": {
        "nav": 18.11,                                  // Net asset value
        "premium_discount": 0.77,                      // Premium/discount
        "holding_quantity": 237882.8821,                 // Holding quantity
        "change_percent_1d": 0,                        // 1-day change percentage
        "change_quantity_1d": 0,                         // 1-day change quantity
        "change_percent_7d": 56.69,                    // 7-day change percentage
        "change_quantity_7d": 86060.9115,                // 7-day change quantity
        "date": "2024-08-05"                           // Data date
      },
      "update_time": 1722995656637                       // Update time
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
    "/api/etf/ethereum/list": {
      "get": {
        "summary": "Ethereum ETF List",
        "description": "This API retrieves a list of key status information for Ethereum Exchange-Traded Funds (ETFs).",
        "operationId": "ethereum-etf-list",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"ticker\": \"ETHA\",                                  // ETF ticker\n      \"name\": \"iShares Ethereum Trust ETF\",              // ETF name\n      \"region\": \"us\",                                    // Region\n      \"market_status\": \"closed\",                         // Market status\n      \"primary_exchange\": \"XNAS\",                        // Primary exchange\n      \"cik_code\": \"0002000638\",                          // CIK code\n      \"type\": \"Spot\",                                    // Type\n      \"market_cap\": \"544896000.00\",                      // Market capitalization\n      \"list_date\": 1721692800000,                        // Listing date\n      \"shares_outstanding\": \"28800000\",                  // Shares outstanding\n      \"aum\": \"\",                                         // Assets under management\n      \"management_fee_percent\": \"0.25\",                  // Management fee percentage\n      \"last_trade_time\": 1722988779939,                  // Last trade time\n      \"last_quote_time\": 1722988799379,                  // Last quote time\n      \"volume_quantity\": 5592645,                        // Volume quantity\n      \"volume_usd\": 106447049.343,                       // Volume in USD\n      \"price\": 18.92,                                    // Market price\n      \"price_change\": 0.67,                              // Price change\n      \"price_change_percent\": 3.67,                      // Price change percentage\n      \"asset_info\": {\n        \"nav\": 18.11,                                  // Net asset value\n        \"premium_discount\": 0.77,                      // Premium/discount\n        \"holding_quantity\": 237882.8821,                 // Holding quantity\n        \"change_percent_1d\": 0,                        // 1-day change percentage\n        \"change_quantity_1d\": 0,                         // 1-day change quantity\n        \"change_percent_7d\": 56.69,                    // 7-day change percentage\n        \"change_quantity_7d\": 86060.9115,                // 7-day change quantity\n        \"date\": \"2024-08-05\"                           // Data date\n      },\n      \"update_time\": 1722995656637                       // Update time\n    }\n  ]\n}\n"
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