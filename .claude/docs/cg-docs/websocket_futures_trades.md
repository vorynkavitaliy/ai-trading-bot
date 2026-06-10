> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Futures Trade Order

The futures trade order streams provide real-time information on executed futures trades for market symbols.

<span style={{ color: "red", fontSize: "24px", fontWeight: "bold" }}># Required Account Level: Standard Edition and Above</span>

```text
# Real-Time Futures Trade Orders Push

## Channel: `futures_trades@``{exchange}`_`{symbol}`@``{minVol}`

To subscribe to the `futures_trades` channel, send the following message: 




```

```json
{
    "method": "subscribe",
    "channels": ["futures_trades@Binance_BTCUSDT@10000"]
}
```

### Response Example

Upon receiving data, the response will look like this:

```json
{
    "channel": "futures_trades@Binance_BTCUSDT@10000",
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