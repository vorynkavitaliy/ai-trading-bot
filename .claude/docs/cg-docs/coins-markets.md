> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Coins Markets

This endpoint provides performance-related metrics for all available futures coins

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ❌       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",  
  "msg": "success",  
  "data": [
    {
      "symbol": "BTC",  // Cryptocurrency symbol
      "current_price": 84773.6,  // Current price (in USD)
      "avg_funding_rate_by_oi": 0.00196,  // Average funding rate weighted by open interest
      "avg_funding_rate_by_vol": 0.002647,  // Average funding rate weighted by volume
      "market_cap_usd": 1683310500117.051,  // Market capitalization (in USD)
      "open_interest_market_cap_ratio": 0.0327,  // Ratio of open interest to market capitalization
      "open_interest_usd": 55002072334.9376,  // Open interest (in USD)
      "open_interest_quantity": 648525.0328,  // Open interest quantity (number of contracts)
      "open_interest_volume_ratio": 0.7936,  // Ratio of open interest to volume
      "price_change_percent_5m": -0.02,  // Price change percentage in the last 5 minutes
      "price_change_percent_15m": 0.06,  // Price change percentage in the last 15 minutes
      "price_change_percent_30m": 0.03,  // Price change percentage in the last 30 minutes
      "price_change_percent_1h": -0.1,  // Price change percentage in the last 1 hour
      "price_change_percent_4h": -0.15,  // Price change percentage in the last 4 hours
      "price_change_percent_12h": 0.15,  // Price change percentage in the last 12 hours
      "price_change_percent_24h": 1.06,  // Price change percentage in the last 24 hours
      "open_interest_change_percent_5m": 0,  // Open interest change percentage in the last 5 minutes
      "open_interest_change_percent_15m": 0.04,  // Open interest change percentage in the last 15 minutes
      "open_interest_change_percent_30m": 0,  // Open interest change percentage in the last 30 minutes
      "open_interest_change_percent_1h": -0.01,  // Open interest change percentage in the last 1 hour
      "open_interest_change_percent_4h": 0.17,  // Open interest change percentage in the last 4 hours
      "open_interest_change_percent_24h": 4.58,  // Open interest change percentage in the last 24 hours
      "volume_change_percent_5m": -0.03,  // Volume change percentage in the last 5 minutes
      "volume_change_percent_15m": -0.73,  // Volume change percentage in the last 15 minutes
      "volume_change_percent_30m": -1.13,  // Volume change percentage in the last 30 minutes
      "volume_change_percent_1h": -2.33,  // Volume change percentage in the last 1 hour
      "volume_change_percent_4h": -5.83,  // Volume change percentage in the last 4 hours
      "volume_change_percent_24h": -26.38,  // Volume change percentage in the last 24 hours
      "volume_change_usd_1h": 69310404660.3795,  // Volume change in USD in the last 1 hour
      "volume_change_usd_4h": -4290959532.4414644,  // Volume change in USD in the last 4 hours
      "volume_change_usd_24h": -24835757605.82467,  // Volume change in USD in the last 24 hours
      "long_short_ratio_5m": 1.2523,  // Long/short ratio in the last 5 minutes
      "long_short_ratio_15m": 0.9928,  // Long/short ratio in the last 15 minutes
      "long_short_ratio_30m": 1.0695,  // Long/short ratio in the last 30 minutes
      "long_short_ratio_1h": 1.0068,  // Long/short ratio in the last 1 hour
      "long_short_ratio_4h": 1.0504,  // Long/short ratio in the last 4 hours
      "long_short_ratio_12h": 1.0317,  // Long/short ratio in the last 12 hours
      "long_short_ratio_24h": 1.0313,  // Long/short ratio in the last 24 hours
      "liquidation_usd_1h": 33621.85192,  // Total liquidation amount in USD in the last 1 hour
      "long_liquidation_usd_1h": 22178.4681,  // Long liquidation amount in USD in the last 1 hour
      "short_liquidation_usd_1h": 11443.38382,  // Short liquidation amount in USD in the last 1 hour
      "liquidation_usd_4h": 222210.47117,  // Total liquidation amount in USD in the last 4 hours
      "long_liquidation_usd_4h": 179415.77249,  // Long liquidation amount in USD in the last 4 hours
      "short_liquidation_usd_4h": 42794.69868,  // Short liquidation amount in USD in the last 4 hours
      "liquidation_usd_12h": 11895453.392145,  // Total liquidation amount in USD in the last 12 hours
      "long_liquidation_usd_12h": 10223351.23772,  // Long liquidation amount in USD in the last 12 hours
      "short_liquidation_usd_12h": 1672102.154425,  // Short liquidation amount in USD in the last 12 hours
      "liquidation_usd_24h": 27519292.973646,  // Total liquidation amount in USD in the last 24 hours
      "long_liquidation_usd_24h": 17793322.595016,  // Long liquidation amount in USD in the last 24 hours
      "short_liquidation_usd_24h": 9725970.37863  // Short liquidation amount in USD in the last 24 hours
    },
    {
      "symbol": "ETH",  // Cryptocurrency symbol
      "current_price": 1582.55,  // Current price (in USD)
      "avg_funding_rate_by_oi": 0.001631,  // Average funding rate weighted by open interest
      "avg_funding_rate_by_vol": -0.000601,  // Average funding rate weighted by volume
      "market_cap_usd": 190821695398.62064,  // Market capitalization (in USD)
      "open_interest_market_cap_ratio": 0.0925,  // Ratio of open interest to market capitalization
      "open_interest_usd": 17657693967.0459,  // Open interest (in USD)
      "open_interest_quantity": 11160428.5065,  // Open interest quantity (number of contracts)
      "open_interest_volume_ratio": 0.5398,  // Ratio of open interest to volume
      "price_change_percent_5m": 0.07,  // Price change percentage in the last 5 minutes
      "price_change_percent_15m": 0.25,  // Price change percentage in the last 15 minutes
      "price_change_percent_30m": 0.07,  // Price change percentage in the last 30 minutes
      "price_change_percent_1h": -0.11,  // Price change percentage in the last 1 hour
      "price_change_percent_4h": -0.05,  // Price change percentage in the last 4 hours
      "price_change_percent_12h": -0.02,  // Price change percentage in the last 12 hours
      "price_change_percent_24h": 0.16  // Price change percentage in the last 24 hours
      // ... subsequent fields follow in a similar manner
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
    "/api/futures/coins-markets": {
      "get": {
        "summary": "Coins Markets",
        "description": "This API retrieves performance-related information for all available coins",
        "operationId": "coins-markets",
        "parameters": [
          {
            "name": "exchange_list",
            "in": "query",
            "required": false,
            "description": "Comma-separated exchange names (e.g., \"binance, okx, bybit\"). Retrieve supported exchanges via the 'supported-exchange-pairs' API.",
            "schema": {
              "type": "string",
              "default": "Binance,OKX"
            }
          },
          {
            "name": "per_page",
            "in": "query",
            "required": false,
            "description": "Number of results per page.",
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
                    "value": ""
                  },
                  "New Example": {
                    "summary": "New Example",
                    "value": "{\n  \"code\": \"0\",  \n  \"msg\": \"success\",  \n  \"data\": [\n    {\n      \"symbol\": \"BTC\",  // Cryptocurrency symbol\n      \"current_price\": 84773.6,  // Current price (in USD)\n      \"avg_funding_rate_by_oi\": 0.00196,  // Average funding rate weighted by open interest\n      \"avg_funding_rate_by_vol\": 0.002647,  // Average funding rate weighted by volume\n      \"market_cap_usd\": 1683310500117.051,  // Market capitalization (in USD)\n      \"open_interest_market_cap_ratio\": 0.0327,  // Ratio of open interest to market capitalization\n      \"open_interest_usd\": 55002072334.9376,  // Open interest (in USD)\n      \"open_interest_quantity\": 648525.0328,  // Open interest quantity (number of contracts)\n      \"open_interest_volume_ratio\": 0.7936,  // Ratio of open interest to volume\n      \"price_change_percent_5m\": -0.02,  // Price change percentage in the last 5 minutes\n      \"price_change_percent_15m\": 0.06,  // Price change percentage in the last 15 minutes\n      \"price_change_percent_30m\": 0.03,  // Price change percentage in the last 30 minutes\n      \"price_change_percent_1h\": -0.1,  // Price change percentage in the last 1 hour\n      \"price_change_percent_4h\": -0.15,  // Price change percentage in the last 4 hours\n      \"price_change_percent_12h\": 0.15,  // Price change percentage in the last 12 hours\n      \"price_change_percent_24h\": 1.06,  // Price change percentage in the last 24 hours\n      \"open_interest_change_percent_5m\": 0,  // Open interest change percentage in the last 5 minutes\n      \"open_interest_change_percent_15m\": 0.04,  // Open interest change percentage in the last 15 minutes\n      \"open_interest_change_percent_30m\": 0,  // Open interest change percentage in the last 30 minutes\n      \"open_interest_change_percent_1h\": -0.01,  // Open interest change percentage in the last 1 hour\n      \"open_interest_change_percent_4h\": 0.17,  // Open interest change percentage in the last 4 hours\n      \"open_interest_change_percent_24h\": 4.58,  // Open interest change percentage in the last 24 hours\n      \"volume_change_percent_5m\": -0.03,  // Volume change percentage in the last 5 minutes\n      \"volume_change_percent_15m\": -0.73,  // Volume change percentage in the last 15 minutes\n      \"volume_change_percent_30m\": -1.13,  // Volume change percentage in the last 30 minutes\n      \"volume_change_percent_1h\": -2.33,  // Volume change percentage in the last 1 hour\n      \"volume_change_percent_4h\": -5.83,  // Volume change percentage in the last 4 hours\n      \"volume_change_percent_24h\": -26.38,  // Volume change percentage in the last 24 hours\n      \"volume_change_usd_1h\": 69310404660.3795,  // Volume change in USD in the last 1 hour\n      \"volume_change_usd_4h\": -4290959532.4414644,  // Volume change in USD in the last 4 hours\n      \"volume_change_usd_24h\": -24835757605.82467,  // Volume change in USD in the last 24 hours\n      \"long_short_ratio_5m\": 1.2523,  // Long/short ratio in the last 5 minutes\n      \"long_short_ratio_15m\": 0.9928,  // Long/short ratio in the last 15 minutes\n      \"long_short_ratio_30m\": 1.0695,  // Long/short ratio in the last 30 minutes\n      \"long_short_ratio_1h\": 1.0068,  // Long/short ratio in the last 1 hour\n      \"long_short_ratio_4h\": 1.0504,  // Long/short ratio in the last 4 hours\n      \"long_short_ratio_12h\": 1.0317,  // Long/short ratio in the last 12 hours\n      \"long_short_ratio_24h\": 1.0313,  // Long/short ratio in the last 24 hours\n      \"liquidation_usd_1h\": 33621.85192,  // Total liquidation amount in USD in the last 1 hour\n      \"long_liquidation_usd_1h\": 22178.4681,  // Long liquidation amount in USD in the last 1 hour\n      \"short_liquidation_usd_1h\": 11443.38382,  // Short liquidation amount in USD in the last 1 hour\n      \"liquidation_usd_4h\": 222210.47117,  // Total liquidation amount in USD in the last 4 hours\n      \"long_liquidation_usd_4h\": 179415.77249,  // Long liquidation amount in USD in the last 4 hours\n      \"short_liquidation_usd_4h\": 42794.69868,  // Short liquidation amount in USD in the last 4 hours\n      \"liquidation_usd_12h\": 11895453.392145,  // Total liquidation amount in USD in the last 12 hours\n      \"long_liquidation_usd_12h\": 10223351.23772,  // Long liquidation amount in USD in the last 12 hours\n      \"short_liquidation_usd_12h\": 1672102.154425,  // Short liquidation amount in USD in the last 12 hours\n      \"liquidation_usd_24h\": 27519292.973646,  // Total liquidation amount in USD in the last 24 hours\n      \"long_liquidation_usd_24h\": 17793322.595016,  // Long liquidation amount in USD in the last 24 hours\n      \"short_liquidation_usd_24h\": 9725970.37863  // Short liquidation amount in USD in the last 24 hours\n    },\n    {\n      \"symbol\": \"ETH\",  // Cryptocurrency symbol\n      \"current_price\": 1582.55,  // Current price (in USD)\n      \"avg_funding_rate_by_oi\": 0.001631,  // Average funding rate weighted by open interest\n      \"avg_funding_rate_by_vol\": -0.000601,  // Average funding rate weighted by volume\n      \"market_cap_usd\": 190821695398.62064,  // Market capitalization (in USD)\n      \"open_interest_market_cap_ratio\": 0.0925,  // Ratio of open interest to market capitalization\n      \"open_interest_usd\": 17657693967.0459,  // Open interest (in USD)\n      \"open_interest_quantity\": 11160428.5065,  // Open interest quantity (number of contracts)\n      \"open_interest_volume_ratio\": 0.5398,  // Ratio of open interest to volume\n      \"price_change_percent_5m\": 0.07,  // Price change percentage in the last 5 minutes\n      \"price_change_percent_15m\": 0.25,  // Price change percentage in the last 15 minutes\n      \"price_change_percent_30m\": 0.07,  // Price change percentage in the last 30 minutes\n      \"price_change_percent_1h\": -0.11,  // Price change percentage in the last 1 hour\n      \"price_change_percent_4h\": -0.05,  // Price change percentage in the last 4 hours\n      \"price_change_percent_12h\": -0.02,  // Price change percentage in the last 12 hours\n      \"price_change_percent_24h\": 0.16  // Price change percentage in the last 24 hours\n      // ... subsequent fields follow in a similar manner\n    }\n  ]\n}\n"
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
        "deprecated": false,
        "security": [
          {
            "sec0": []
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