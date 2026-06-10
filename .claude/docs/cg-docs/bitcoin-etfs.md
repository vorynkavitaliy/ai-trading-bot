> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Bitcoin ETF List

This endpoint provides a list of key status information for Bitcoin Exchange-Traded Funds (ETFs).

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
      "ticker": "GBTC",                                // ETF identifier
      "fund_name": "Grayscale Bitcoin Trust ETF",      // Fund name
      "region": "us",                                  // Region
      "market_status": "early_trading",                // Market status (open/closed/early_trading, etc.)
      "primary_exchange": "ARCX",                      // Primary exchange
      "cik_code": "0001588489",                        // CIK code (unique identifier)
      "fund_type": "Spot",                             // Fund type (Spot/ETF/Futures, etc.)
      "list_date": 1424822400000,                      // Listing date (timestamp in milliseconds)
      "shares_outstanding": "240750100",               // Shares outstanding
      "aum_usd": "16137543152.34",                     // Assets under management (USD)
      "management_fee_percent": "1.5",                 // Management fee (%)
      "last_trade_time": 1745225312958,                // Last trade time (timestamp in milliseconds)
      "last_quote_time": 1745225389483,                // Last quote time (timestamp in milliseconds)
      "volume_quantity": 1068092,                      // Volume quantity
      "volume_usd": 71485902.2312,                     // Volume in USD
      "price_change_usd": 0.47,                        // Price change (USD)
      "price_change_percent": 0.71,                    // Price change (%)
      "asset_details": {
        "net_asset_value_usd": 67.03,                  // Net asset value (USD)
        "premium_discount_percent": 0.09,              // Premium/discount rate (%)
        "btc_holding": 190124.5441,                    // BTC balance
        "btc_change_percent_24h": 0,                   // 24h BTC change (%)
        "btc_change_24h": -7.8136,                     // 24h BTC change amount
        "btc_change_percent_7d": -0.32,                // 7d BTC change (%)
        "btc_change_7d": -615.563,                     // 7d BTC change amount
        "update_date": "2025-04-17"                    // Update date
      },
      "update_timestamp": 1745224505000                // Data update timestamp (milliseconds)
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
    "/api/etf/bitcoin/list": {
      "get": {
        "summary": "Bitcoin ETF List",
        "description": "This API retrieves a list of key status information for Bitcoin Exchange-Traded Funds (ETFs).",
        "operationId": "bitcoin-etfs",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"ticker\": \"GBTC\",                                // ETF identifier\n      \"fund_name\": \"Grayscale Bitcoin Trust ETF\",      // Fund name\n      \"region\": \"us\",                                  // Region\n      \"market_status\": \"early_trading\",                // Market status (open/closed/early_trading, etc.)\n      \"primary_exchange\": \"ARCX\",                      // Primary exchange\n      \"cik_code\": \"0001588489\",                        // CIK code (unique identifier)\n      \"fund_type\": \"Spot\",                             // Fund type (Spot/ETF/Futures, etc.)\n      \"list_date\": 1424822400000,                      // Listing date (timestamp in milliseconds)\n      \"shares_outstanding\": \"240750100\",               // Shares outstanding\n      \"aum_usd\": \"16137543152.34\",                     // Assets under management (USD)\n      \"management_fee_percent\": \"1.5\",                 // Management fee (%)\n      \"last_trade_time\": 1745225312958,                // Last trade time (timestamp in milliseconds)\n      \"last_quote_time\": 1745225389483,                // Last quote time (timestamp in milliseconds)\n      \"volume_quantity\": 1068092,                      // Volume quantity\n      \"volume_usd\": 71485902.2312,                     // Volume in USD\n      \"price_change_usd\": 0.47,                        // Price change (USD)\n      \"price_change_percent\": 0.71,                    // Price change (%)\n      \"asset_details\": {\n        \"net_asset_value_usd\": 67.03,                  // Net asset value (USD)\n        \"premium_discount_percent\": 0.09,              // Premium/discount rate (%)\n        \"btc_holding\": 190124.5441,                    // BTC balance\n        \"btc_change_percent_24h\": 0,                   // 24h BTC change (%)\n        \"btc_change_24h\": -7.8136,                     // 24h BTC change amount\n        \"btc_change_percent_7d\": -0.32,                // 7d BTC change (%)\n        \"btc_change_7d\": -615.563,                     // 7d BTC change amount\n        \"update_date\": \"2025-04-17\"                    // Update date\n      },\n      \"update_timestamp\": 1745224505000                // Data update timestamp (milliseconds)\n    }\n  ]\n}\n"
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