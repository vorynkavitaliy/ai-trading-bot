> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Economic Data

This endpoint provides data for the economic data

***Cache / Update Frequency:*** 10 minutes for all the API plans.

***This endpoint is available on the following*** [API plans](https://www.coinglass.com/pricing)：

| Plans     | Hobbyist | Startup | Standard | Professional | Enterprise |
| :-------- | :------- | :------ | :------- | :----------- | :--------- |
| Available | ❌        | ✅       | ✅        | ✅            | ✅          |

<br />

**Response Data**

```json
{
  "code": "0",
  "data": [
    {
      "calendar_name": "Seasonally adjusted industrial output (MoM)(May)",
      "country_code": "SK",
      "country_name": "Korea",
      "data_effect": "Minor Impact",
      "forecast_value": "-0.1%",
      "revised_previous_value": "",
      "previous_value": "-0.9%",
      "publish_timestamp": 1751238000000,
      "published_value": "-2.9%",
      "importance_level": 1, //1,2,3
      "has_exact_publish_time": 1
    },
    {
      "calendar_name": "Industrial Output(YoY)(May)",
      "country_code": "SK",
      "country_name": "Korea",
      "data_effect": "Minor Impact",
      "forecast_value": "2.6%",
      "revised_previous_value": "",
      "previous_value": "4.9%",
      "publish_timestamp": 1751238000000,
      "published_value": "0.2%",
      "importance_level": 1,  //1,2,3
      "has_exact_publish_time": 1
    },
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
    "/api/calendar/economic-data": {
      "get": {
        "description": "",
        "operationId": "get_apicalendareconomic_data",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "name": "start_time",
            "in": "query",
            "required": false,
            "description": "Start timestamp in milliseconds. The maximum supported range is up to 15 days before the current time.",
            "schema": {
              "type": "integer",
              "default": ""
            }
          },
          {
            "name": "end_time",
            "in": "query",
            "required": false,
            "description": "End timestamp in milliseconds. The maximum supported range is up to 15 days after the current time.",
            "schema": {
              "type": "integer",
              "default": ""
            }
          },
          {
            "name": "language",
            "in": "query",
            "required": false,
            "description": "Supported language :  'en' or  'zh'",
            "schema": {
              "type": "string",
              "default": ""
            }
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