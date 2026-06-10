> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coinglass.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Futures Ticker Snapshot

The futures ticker snapshot stream provides market snapshot data for a specific trading pair.

<span style={{ color: "red", fontSize: "24px", fontWeight: "bold" }}># Required Account Level: Standard Edition and Above</span>

```text
# Real-Time Futures Ticker Snapshot Push

## Channel: `futures_ticker@{exchange}_{symbol}`

To subscribe to the `futures_ticker` channel, send the following message: 




```

```json
{
    "method": "subscribe",
    "channels": ["futures_ticker@Binance_BTCUSDT"]
}
```

### Response Example

Upon receiving data, the response will look like this:

```json
{
    "channel": "futures_ticker@Binance_BTCUSDT",
    "data": [
        {
         "exchange": "Binance",
         "symbol": "BTCUSDT",
         "base_asset": "BTC",
         "price": 62850.45,
         "index_price": 62847.32,
         "volume_usd_24h": 1256789345.67,
         "open_interest": 5293456789.12,
         "open_interest_amount": 4589.12,
         "funding_rate": 0.0001,
         "next_funding_time": "2026-04-29 16:00:00",
         "funding_interval_hours": 8,
         "expiry_date": null,
         "update_time": "2026-04-29 08:20:00"
}
    ]
}
```

<br />

### Response Example

Upon receiving data, the response will look like this: