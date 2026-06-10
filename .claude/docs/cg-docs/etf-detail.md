# ETF Detail

This endpoint provides detailed information on a Bitcoin Exchange-Traded Fund (ETF), including its key attributes and status.

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
    "ticker_info": {
      "id": 1,                                         // ETF ID
      "ticker": "GBTC",                                // ETF ticker symbol
      "name": "Grayscale Bitcoin Trust ETF",           // ETF name
      "market": "stocks",                              // Market type
      "region": "us",                                  // Region
      "primary_exchange": "ARCX",                      // Primary exchange
      "fund_type": "ETV",                              // Fund type
      "active": "true",                                // Whether the ETF is active
      "currency_name": "usd",                          // Currency name
      "cik_code": "0001588489",                        // CIK code
      "composite_figi": "BBG008748J88",                // Composite FIGI
      "share_class_figi": "BBG008748J97",              // Share class FIGI
      "phone_number": "212-668-1427",                  // Contact phone number
      "tag": "BTC",                                    // Asset tag
      "type2": "Spot",                                 // Additional product type
      "address": {
        "address_1": "{\"address2\":\"4TH FLOOR\",\"city\":\"STAMFORD\",\"address1\":\"290 HARBOR DRIVE\",\"state\":\"CT\",\"postal_code\":\"06902\"}"
      },                                               // Company address (as a JSON string)
      "sic_code": "6221",                              // SIC code
      "sic_description": "COMMODITY CONTRACTS BROKERS & DEALERS", // Industry description
      "ticker_root": "GBTC",                           // Ticker root
      "list_date": 1424822400000,                      // Listing date (timestamp in ms)
      "share_class_shares_outstanding": "240750100",   // Shares outstanding
      "round_lot": "100",                              // Round lot size
      "status": 1,                                     // Status
      "update_time": 1745224505000                     // Last update time (timestamp in ms)
    },
    "market_status": "early_trading",                  // Market status
    "name": "Grayscale Bitcoin Trust ETF",             // ETF name
    "ticker": "GBTC",                                  // ETF ticker
    "type": "stocks",                                  // Market type
    "session": {
      "change": 2.22,                                  // Price change
      "change_percent": 3.309,                         // Change percentage (%)
      "early_trading_change": 2.22,                    // Pre-market change
      "early_trading_change_percent": 3.309,           // Pre-market change percentage (%)
      "close": 67.09,                                  // Previous closing price
      "high": 67.56,                                   // Highest price
      "low": 66.15,                                    // Lowest price
      "open": 66.86,                                   // Opening price
      "volume": 1068092,                               // Trading volume
      "previous_close": 67.09,                         // Previous close
      "price": 69.31                                   // Latest price
    },
    "last_quote": {
      "last_updated": 1745226801708029700,             // Last update time (timestamp in nanoseconds)
      "timeframe": "REAL-TIME",                        // Timeframe type
      "ask": 69.29,                                    // Ask price
      "ask_size": 34,                                  // Ask size
      "ask_exchange": 8,                               // Ask exchange code
      "bid": 69.18,                                    // Bid price
      "bid_size": 3,                                   // Bid size
      "bid_exchange": 11                               // Bid exchange code
    },
    "last_trade": {
      "last_updated": 1745226730467043600,             // Last trade update time (timestamp in nanoseconds)
      "timeframe": "REAL-TIME",                        // Timeframe type
      "id": "62879131651684",                          // Trade ID
      "price": 69.31,                                  // Trade price
      "size": 30,                                      // Trade volume
      "exchange": 12,                                  // Exchange code
      "conditions": [12, 37]                           // Trade condition codes
    },
    "performance": {
      "low_price_52week": 39.56,                       // 52-week low
      "high_price_52week": 86.11,                      // 52-week high
      "high_price_52week_date": 1734238800000,         // 52-week high date (timestamp)
      "low_price_52week_date": 1722744000000,          // 52-week low date (timestamp)
      "ydt_change_percent": -12.23,                    // Year-to-date change (%)
      "year_change_percent": 13.98,                    // 1-year change (%)
      "avg_vol_usd_10d": 518227                        // 10-day average trading value (USD)
    }
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
    "/api/etf/bitcoin/detail": {
      "get": {
        "summary": "ETF Detail",
        "description": "This API retrieves detailed information on an ETF.",
        "operationId": "etf-detail",
        "parameters": [
          {
            "name": "ticker",
            "in": "query",
            "required": true,
            "description": "ETF ticker symbol (e.g., GBTC, IBIT).",
            "schema": {
              "type": "string",
              "default": "GBTC"
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
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": {\n    \"ticker_info\": {\n      \"id\": 1,                                         // ETF ID\n      \"ticker\": \"GBTC\",                                // ETF ticker symbol\n      \"name\": \"Grayscale Bitcoin Trust ETF\",           // ETF name\n      \"market\": \"stocks\",                              // Market type\n      \"region\": \"us\",                                  // Region\n      \"primary_exchange\": \"ARCX\",                      // Primary exchange\n      \"fund_type\": \"ETV\",                              // Fund type\n      \"active\": \"true\",                                // Whether the ETF is active\n      \"currency_name\": \"usd\",                          // Currency name\n      \"cik_code\": \"0001588489\",                        // CIK code\n      \"composite_figi\": \"BBG008748J88\",                // Composite FIGI\n      \"share_class_figi\": \"BBG008748J97\",              // Share class FIGI\n      \"phone_number\": \"212-668-1427\",                  // Contact phone number\n      \"tag\": \"BTC\",                                    // Asset tag\n      \"type2\": \"Spot\",                                 // Additional product type\n      \"address\": {\n        \"address_1\": \"{\\\"address2\\\":\\\"4TH FLOOR\\\",\\\"city\\\":\\\"STAMFORD\\\",\\\"address1\\\":\\\"290 HARBOR DRIVE\\\",\\\"state\\\":\\\"CT\\\",\\\"postal_code\\\":\\\"06902\\\"}\"\n      },                                               // Company address (as a JSON string)\n      \"sic_code\": \"6221\",                              // SIC code\n      \"sic_description\": \"COMMODITY CONTRACTS BROKERS & DEALERS\", // Industry description\n      \"ticker_root\": \"GBTC\",                           // Ticker root\n      \"list_date\": 1424822400000,                      // Listing date (timestamp in ms)\n      \"share_class_shares_outstanding\": \"240750100\",   // Shares outstanding\n      \"round_lot\": \"100\",                              // Round lot size\n      \"status\": 1,                                     // Status\n      \"update_time\": 1745224505000                     // Last update time (timestamp in ms)\n    },\n    \"market_status\": \"early_trading\",                  // Market status\n    \"name\": \"Grayscale Bitcoin Trust ETF\",             // ETF name\n    \"ticker\": \"GBTC\",                                  // ETF ticker\n    \"type\": \"stocks\",                                  // Market type\n    \"session\": {\n      \"change\": 2.22,                                  // Price change\n      \"change_percent\": 3.309,                         // Change percentage (%)\n      \"early_trading_change\": 2.22,                    // Pre-market change\n      \"early_trading_change_percent\": 3.309,           // Pre-market change percentage (%)\n      \"close\": 67.09,                                  // Previous closing price\n      \"high\": 67.56,                                   // Highest price\n      \"low\": 66.15,                                    // Lowest price\n      \"open\": 66.86,                                   // Opening price\n      \"volume\": 1068092,                               // Trading volume\n      \"previous_close\": 67.09,                         // Previous close\n      \"price\": 69.31                                   // Latest price\n    },\n    \"last_quote\": {\n      \"last_updated\": 1745226801708029700,             // Last update time (timestamp in nanoseconds)\n      \"timeframe\": \"REAL-TIME\",                        // Timeframe type\n      \"ask\": 69.29,                                    // Ask price\n      \"ask_size\": 34,                                  // Ask size\n      \"ask_exchange\": 8,                               // Ask exchange code\n      \"bid\": 69.18,                                    // Bid price\n      \"bid_size\": 3,                                   // Bid size\n      \"bid_exchange\": 11                               // Bid exchange code\n    },\n    \"last_trade\": {\n      \"last_updated\": 1745226730467043600,             // Last trade update time (timestamp in nanoseconds)\n      \"timeframe\": \"REAL-TIME\",                        // Timeframe type\n      \"id\": \"62879131651684\",                          // Trade ID\n      \"price\": 69.31,                                  // Trade price\n      \"size\": 30,                                      // Trade volume\n      \"exchange\": 12,                                  // Exchange code\n      \"conditions\": [12, 37]                           // Trade condition codes\n    },\n    \"performance\": {\n      \"low_price_52week\": 39.56,                       // 52-week low\n      \"high_price_52week\": 86.11,                      // 52-week high\n      \"high_price_52week_date\": 1734238800000,         // 52-week high date (timestamp)\n      \"low_price_52week_date\": 1722744000000,          // 52-week low date (timestamp)\n      \"ydt_change_percent\": -12.23,                    // Year-to-date change (%)\n      \"year_change_percent\": 13.98,                    // 1-year change (%)\n      \"avg_vol_usd_10d\": 518227                        // 10-day average trading value (USD)\n    }\n  }\n}\n"
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