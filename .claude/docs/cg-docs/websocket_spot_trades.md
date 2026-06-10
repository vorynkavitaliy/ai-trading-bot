> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Spot Trade Order

The spot trade order streams provide real-time information on executed spot trades for market symbols.

<span style={{ color: "red", fontSize: "24px", fontWeight: "bold" }}># Required Account Level: Standard Edition and Above</span>

```text
# Real-Time Spot Trade Orders Push

## Channel: `spot_trades@``{exchange}`_`{symbol}`@``{minVol}`

To subscribe to the `spot_trades` channel, send the following message: 




```

```json
{
    "method": "subscribe",
    "channels": ["spot_trades@Binance_BTCUSDT@10000"]
}
```

### Response Example

Upon receiving data, the response will look like this:

```json
{
    "channel": "spot_trades@Binance_BTCUSDT@10000",
    "data": [
        {
            "base_asset": "BTC",
            "exchange": "Binance",
            "price": 56738.00,
            "side": 2,//side=1  sell.   side=2   buy   
            "symbol": "BTCUSDT",
            "time": 1725416318379,
            "volume_usd": 3858.18400
        }
    ]
}
```

<br />

### Response Example

Upon receiving data, the response will look like this: