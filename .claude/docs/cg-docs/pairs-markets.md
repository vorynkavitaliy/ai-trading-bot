# Pairs Markets

This endpoint provides performance-related metrics for all available futures trading pairs

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
      "instrument_id": "BTCUSDT", // Futures trading pair
      "exchange_name": "Binance", // Exchange name
      "symbol": "BTC/USDT", // Trading pair symbol

      "current_price": 84604.3, // Current price
      "index_price": 84646.66222222, // Index price
      "price_change_percent_24h": 0.67, // 24h price change (%)

      "volume_usd": 11317580109.5041, // 24h trading volume (USD)
      "volume_usd_change_percent_24h": -32.13, // 24h volume change (%)

      "long_volume_usd": 5800829746.047, // Long trade volume (USD)
      "short_volume_usd": 5516750363.4571, // Short trade volume (USD)
      "long_volume_quantity": 1130850, // Number of long trades
      "short_volume_quantity": 1162710, // Number of short trades

      "open_interest_quantity": 77881.234, // Open interest quantity (contracts)
      "open_interest_usd": 6589095073.8296, // Open interest value (USD)
      "open_interest_change_percent_24h": 1.9, // 24h open interest change (%)

      "long_liquidation_usd_24h": 3654182.12, // Long liquidations in past 24h (USD)
      "short_liquidation_usd_24h": 4099047.79, // Short liquidations in past 24h (USD)

      "funding_rate": 0.002007, // Current funding rate
      "next_funding_time": 1744963200000, // Next funding time (timestamp)

      "open_interest_volume_radio": 0.5822, // Open interest to volume ratio
      "oi_vol_ratio_change_percent_24h": 50.13 // 24h ratio change (%)
    },
    {
      "instrument_id": "BTC_USDT", // Futures trading pair
      "exchange_name": "Gate.io", // Exchange name
      "symbol": "BTC/USDT", // Trading pair symbol

      "current_price": 84616.3, // Current price
      "index_price": 84643.36, // Index price
      "price_change_percent_24h": 0.69, // 24h price change (%)

      "volume_usd": 1711484049.255, // 24h trading volume (USD)
      "volume_usd_change_percent_24h": -67.03, // 24h volume change (%)

      "long_volume_usd": 870432407.5966, // Long trade volume (USD)
      "short_volume_usd": 841051641.6584, // Short trade volume (USD)
      "long_volume_quantity": 210027, // Number of long trades
      "short_volume_quantity": 218777, // Number of short trades

      "open_interest_quantity": 69477.278, // Open interest quantity (contracts)
      "open_interest_usd": 5878785139.331, // Open interest value (USD)
      "open_interest_change_percent_24h": 3.82, // 24h open interest change (%)

      "long_liquidation_usd_24h": 1502896.68, // Long liquidations in past 24h (USD)
      "short_liquidation_usd_24h": 1037959.7, // Short liquidations in past 24h (USD)

      "funding_rate": 0.0022, // Current funding rate

      "open_interest_volume_radio": 3.4349, // Open interest to volume ratio
      "oi_vol_ratio_change_percent_24h": 214.93 // 24h ratio change (%)
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
    "/api/futures/pairs-markets": {
      "get": {
        "summary": "Pairs Markets",
        "description": "This API retrieves performance-related information for all available coins",
        "operationId": "pairs-markets",
        "parameters": [
          {
            "name": "symbol",
            "in": "query",
            "required": true,
            "description": "Trading coin (e.g., BTC).Retrieve supported coins via the 'supported-coins' API.",
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
                    "value": ""
                  },
                  "Success": {
                    "summary": "Success",
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"instrument_id\": \"BTCUSDT\", // Futures trading pair\n      \"exchange_name\": \"Binance\", // Exchange name\n      \"symbol\": \"BTC/USDT\", // Trading pair symbol\n\n      \"current_price\": 84604.3, // Current price\n      \"index_price\": 84646.66222222, // Index price\n      \"price_change_percent_24h\": 0.67, // 24h price change (%)\n\n      \"volume_usd\": 11317580109.5041, // 24h trading volume (USD)\n      \"volume_usd_change_percent_24h\": -32.13, // 24h volume change (%)\n\n      \"long_volume_usd\": 5800829746.047, // Long trade volume (USD)\n      \"short_volume_usd\": 5516750363.4571, // Short trade volume (USD)\n      \"long_volume_quantity\": 1130850, // Number of long trades\n      \"short_volume_quantity\": 1162710, // Number of short trades\n\n      \"open_interest_quantity\": 77881.234, // Open interest quantity (contracts)\n      \"open_interest_usd\": 6589095073.8296, // Open interest value (USD)\n      \"open_interest_change_percent_24h\": 1.9, // 24h open interest change (%)\n\n      \"long_liquidation_usd_24h\": 3654182.12, // Long liquidations in past 24h (USD)\n      \"short_liquidation_usd_24h\": 4099047.79, // Short liquidations in past 24h (USD)\n\n      \"funding_rate\": 0.002007, // Current funding rate\n      \"next_funding_time\": 1744963200000, // Next funding time (timestamp)\n\n      \"open_interest_volume_radio\": 0.5822, // Open interest to volume ratio\n      \"oi_vol_ratio_change_percent_24h\": 50.13 // 24h ratio change (%)\n    },\n    {\n      \"instrument_id\": \"BTC_USDT\", // Futures trading pair\n      \"exchange_name\": \"Gate.io\", // Exchange name\n      \"symbol\": \"BTC/USDT\", // Trading pair symbol\n\n      \"current_price\": 84616.3, // Current price\n      \"index_price\": 84643.36, // Index price\n      \"price_change_percent_24h\": 0.69, // 24h price change (%)\n\n      \"volume_usd\": 1711484049.255, // 24h trading volume (USD)\n      \"volume_usd_change_percent_24h\": -67.03, // 24h volume change (%)\n\n      \"long_volume_usd\": 870432407.5966, // Long trade volume (USD)\n      \"short_volume_usd\": 841051641.6584, // Short trade volume (USD)\n      \"long_volume_quantity\": 210027, // Number of long trades\n      \"short_volume_quantity\": 218777, // Number of short trades\n\n      \"open_interest_quantity\": 69477.278, // Open interest quantity (contracts)\n      \"open_interest_usd\": 5878785139.331, // Open interest value (USD)\n      \"open_interest_change_percent_24h\": 3.82, // 24h open interest change (%)\n\n      \"long_liquidation_usd_24h\": 1502896.68, // Long liquidations in past 24h (USD)\n      \"short_liquidation_usd_24h\": 1037959.7, // Short liquidations in past 24h (USD)\n\n      \"funding_rate\": 0.0022, // Current funding rate\n\n      \"open_interest_volume_radio\": 3.4349, // Open interest to volume ratio\n      \"oi_vol_ratio_change_percent_24h\": 214.93 // 24h ratio change (%)\n    }\n  ]\n}\n"
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