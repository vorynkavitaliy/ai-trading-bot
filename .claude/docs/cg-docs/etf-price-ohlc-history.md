> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# ETF Price History

This endpoint provides historical price data for Bitcoin Exchange-Traded Funds (ETFs), including open, high, low, and close (OHLC) prices, along with trading volume for each data point.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ✅        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "message": "success",
  "data": [
    {
      "time": 1731056460000,   // timestamp in milliseconds
      "open": 60.47,                // Opening price
      "high": 60.47,                // Highest price
      "low": 60.47,                 // Lowest price
      "close": 60.47,               // Closing price
      "volume": 100                // Trading volume
    },
    ...
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
    "/api/etf/bitcoin/price/history": {
      "get": {
        "summary": "ETF Price History",
        "description": "This API retrieves historical price data for ETFs, including open, high, low, and close (OHLC) prices.",
        "operationId": "etf-price-ohlc-history",
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
          },
          {
            "name": "range",
            "in": "query",
            "required": true,
            "description": "Time range for the data (e.g., 1d,7d,all).",
            "schema": {
              "type": "string",
              "default": "1d"
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
                    "value": "{\n  \"code\": \"0\",\n  \"message\": \"success\",\n  \"data\": [\n    {\n      \"time\": 1731056460000,   // timestamp in milliseconds\n      \"open\": 60.47,                // Opening price\n      \"high\": 60.47,                // Highest price\n      \"low\": 60.47,                 // Lowest price\n      \"close\": 60.47,               // Closing price\n      \"volume\": 100                // Trading volume\n    },\n    ...\n  ]\n}\n"
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