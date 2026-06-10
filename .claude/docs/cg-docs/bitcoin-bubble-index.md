# Bitcoin Bubble Index

This endpoint provides data for the Bitcoin Bubble Index

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
      "price": 0.0495,                          // Current price
      "bubble_index": -29.59827206,             // Bubble index
      "google_trend_percent": 0.0287,           // Google trend percentage
      "mining_difficulty": 181.543,             // Mining difficulty
      "transaction_count": 235,                 // Transaction count
      "address_send_count": 390,                // Address send count
      "tweet_count": 0,                         // Tweet count
      "date_string": "2010-07-17"               // Date string
    },
    {
      "price": 0.0726,                          // Current price
      "bubble_index": -29.30591863,             // Bubble index
      "google_trend_percent": 0.0365,           // Google trend percentage
      "mining_difficulty": 181.543,             // Mining difficulty
      "transaction_count": 248,                 // Transaction count
      "address_send_count": 424,                // Address send count
      "tweet_count": 0,                         // Tweet count
      "date_string": "2010-07-18"               // Date string
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
    "/api/index/bitcoin/bubble-index": {
      "get": {
        "summary": "Bitcoin Bubble Index",
        "description": "",
        "operationId": "bitcoin-bubble-index",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{\n  \"code\": \"0\",\n  \"msg\": \"success\",\n  \"data\": [\n    {\n      \"price\": 0.0495,                          // Current price\n      \"bubble_index\": -29.59827206,             // Bubble index\n      \"google_trend_percent\": 0.0287,           // Google trend percentage\n      \"mining_difficulty\": 181.543,             // Mining difficulty\n      \"transaction_count\": 235,                 // Transaction count\n      \"address_send_count\": 390,                // Address send count\n      \"tweet_count\": 0,                         // Tweet count\n      \"date_string\": \"2010-07-17\"               // Date string\n    },\n    {\n      \"price\": 0.0726,                          // Current price\n      \"bubble_index\": -29.30591863,             // Bubble index\n      \"google_trend_percent\": 0.0365,           // Google trend percentage\n      \"mining_difficulty\": 181.543,             // Mining difficulty\n      \"transaction_count\": 248,                 // Transaction count\n      \"address_send_count\": 424,                // Address send count\n      \"tweet_count\": 0,                         // Tweet count\n      \"date_string\": \"2010-07-18\"               // Date string\n    }\n  ]\n}\n"
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