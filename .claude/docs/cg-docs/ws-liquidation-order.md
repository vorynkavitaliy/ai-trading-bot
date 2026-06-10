> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Liquidation Order

The liquidation order snapshot streams provide information on forced liquidation orders for market symbols.

<span style={{ color: "red", fontSize: "24px", fontWeight: "bold" }}># Required Account Level: Standard Edition and Above</span>

# Real-Time Liquidation Orders Push

## Channel: `liquidation_orders`

To subscribe to the `liquidation_orders` channel, send the following message:

```json
{
    "method": "subscribe",
    "channels": ["liquidation_orders"]
}
```

### Response Example

Upon receiving data, the response will look like this:

```json
{
    "channel": "liquidation_orders",
    "data": [
        {
            "base_asset": "BTC",
            "exchange": "Binance",
            "price": 56738.00,
            "side": 2, //side=1   Long liquidation     side=2   Short liquidation
            "symbol": "BTCUSDT",
            "time": 1725416318379,
            "volume_usd": 3858.18400
        }
    ]
}
```