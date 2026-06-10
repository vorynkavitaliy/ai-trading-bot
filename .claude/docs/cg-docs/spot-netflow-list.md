# Coin NetFlow List

This API provides inflow and outflow data for multiple coins across multiple time intervals in the spot market.

**Cache / Update Frequency:** Real time for all the API plans.

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
      "symbol": "BTC",
      "taker_buy_volume_usd_5m": 23817063.00355,
      "taker_sell_volume_usd_5m": 14688850.4490948,
      "net_flow_usd_5m": 9128212.5544552,
      "taker_buy_volume_usd_15m": 64458138.15245,
      "taker_sell_volume_usd_15m": 56267852.8582948,
      "net_flow_usd_15m": 8190285.2941552,
      "taker_buy_volume_usd_30m": 152744538.92745,
      "taker_sell_volume_usd_30m": 122661161.6758948,
      "net_flow_usd_30m": 30083377.2515552,
      "taker_buy_volume_usd_1h": 440544708.75065,
      "taker_sell_volume_usd_1h": 326579508.8264948,
      "net_flow_usd_1h": 113965199.9241552,
      "taker_buy_volume_usd_2h": 762982613.25415,
      "taker_sell_volume_usd_2h": 579323636.6009948,
      "net_flow_usd_2h": 183658976.6531552,
      "taker_buy_volume_usd_4h": 2083240736.38015,
      "taker_sell_volume_usd_4h": 1464050013.7042947,
      "net_flow_usd_4h": 619190722.6758552,
      "taker_buy_volume_usd_6h": 2811782257.79735,
      "taker_sell_volume_usd_6h": 2115918461.0476947,
      "net_flow_usd_6h": 695863796.7496552,
      "taker_buy_volume_usd_8h": 5569645388.97045,
      "taker_sell_volume_usd_8h": 4908424264.731495,
      "net_flow_usd_8h": 661221124.2389553,
      "taker_buy_volume_usd_12h": 9808385961.73665,
      "taker_sell_volume_usd_12h": 9239720429.892195,
      "net_flow_usd_12h": 568665531.8444552,
      "taker_buy_volume_usd_24h": 15783807234.40935,
      "taker_sell_volume_usd_24h": 15888011086.572395,
      "net_flow_usd_24h": -104203852.1630448,
      "taker_buy_volume_usd_3d": 172158061928.49524,
      "taker_sell_volume_usd_3d": 171369751943.40836,
      "net_flow_usd_3d": 588309985.0868665,
      "taker_buy_volume_usd_7d": 98531427734.15463,
      "taker_sell_volume_usd_7d": 97358408204.01096,
      "net_flow_usd_1w": 1173019530.1436665,
      "taker_buy_volume_usd_15d": 173153061928.49524,
      "taker_sell_volume_usd_15d": 172364751943.40836,
      "net_flow_usd_15d": 788309985.0868665,
      "taker_buy_volume_usd_30d": 423872219745.3059,
      "taker_sell_volume_usd_30d": 427388634817.09235,
      "net_flow_usd_30d": -3516415071.7864337,
      "market_cap": 1823476500360.4873
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
    "/api/spot/netflow-list": {
      "get": {
        "description": "",
        "operationId": "get_apispotnetflow-list",
        "responses": {
          "200": {
            "description": ""
          }
        },
        "parameters": [
          {
            "in": "query",
            "name": "per_page",
            "schema": {
              "type": "integer"
            },
            "description": "Number of results per page."
          },
          {
            "in": "query",
            "name": "page",
            "schema": {
              "type": "integer"
            },
            "description": "Page number for pagination, default: 1.\n\n"
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