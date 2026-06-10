> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# News

This endpoint provides an instant news (up to nearly 1000 news items).

***Cache / Update Frequency:*** Real-time updates

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

# Response Data

```json
{
  "code": "0",
  "data": [
    {
      "article_picture":  "https://images.cointelegraph.com/images/528_aHR0cHM6Ly9zMy5jb2ludGVsZWdyYXBoLmNvbS91cGxvYWRzLzIwMjUtMDIvMDE5NTNkOTUtOTEyYi03MTE4LWE3NTEtNDRjNDExZWUzNmMy.jpg",  //Article Picture
      "article_title": "Crypto ETFs ‘punching above weight’ as almost half of ETF investers plan buys", // Article Title
      "article_content": "<p>Nearly h \n</blockquote> <!---->",  //Article Content
      "source_name": "COINTELEGRAPH",   // Source Name
      "source_website_logo": "https://cdn.coinglasscdn.com/news/coin_telegraph.png",   //Source Website Logo
      "article_release_time": 1762482358000, //Article Release Time
      "article_description": "<p>Bloomberg ETF analyst Eric Balchunas said it was “shocking” to see Schwab’s findings that crypto ETF investments could be on par with those in bond ETFs.</p>" // Article Description
    },

    {
      "article_picture": "https://images.cointelegraph.com/images/528_aHR0cHM6Ly9zMy5jb2ludGVsZWdyYXBoLmNvbS91cGxvYWRzLzIwMjUtMTEvMDE5YTViM2MtODFkOC03NWFhLTg2MjEtOGEyYmZjMDJhZDk0.jpg",
      "article_title": "Bitcoin at $100K is ‘speed bump’ to $56K, but data signals no signs of panic",
      "article_content": "<p data-ct-non-bby 2030.</p> <!---->",
      "source_name": "COINTELEGRAPH",
      "source_website_logo": "https://cdn.coinglasscdn.com/news/coin_telegraph.png",
      "article_release_time": 1762478945000,
      "article_description": "<p>Bloomberg analyst Mike McGlone says Bitcoin hitting $100,000 is “a speed bump” to $56,000, but other analysts say Bitcoin has bottomed out.</p>"
    },
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
    "/api/article/list": {
      "get": {
        "description": "",
        "operationId": "get_apiarticlelist",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "start_time",
            "schema": {
              "type": "integer"
            },
            "description": "Start timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "end_time",
            "schema": {
              "type": "integer"
            },
            "description": "End timestamp in milliseconds (e.g., 1641522717000)."
          },
          {
            "in": "query",
            "name": "language",
            "schema": {
              "type": "string"
            },
            "description": "Supported languages: 'en', 'zh', 'zh-tw'"
          },
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "integer"
            },
            "description": "Current page number"
          },
          {
            "in": "query",
            "name": "per_page",
            "schema": {
              "type": "integer"
            },
            "description": "Number of items returned per page"
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