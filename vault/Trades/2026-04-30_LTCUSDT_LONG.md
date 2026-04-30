---
symbol: LTCUSDT
side: buy
order_type: market
entry_price: 55.25
sl: 54.55
tp1: 55.55
tp2: 57
risk_pct: 0.375
total_qty: 1306.2
accounts: ["50000/Ivan=259.2","200000/Vitalii=1047"]
opened_at: 2026-04-30T00:14:22.900Z
closed_at: 2026-04-30T00:38:02.721Z
status: closed
closed_reason: TP1_hit_full_close
exit_price: 55.55
realized_r: 0.4286
pnl_usd: 312.26
pnl_usd_per_account:
  Ivan_50k: 61.96
  Vitalii_200k: 250.30
---

## Rationale

VP-SMC LONG (strategy v3 FINAL) на LTCUSDT 1H close.

Триггер: VAL ~55.0 коснулся в окне 6H, цена вернулась выше VAL (55.25), bull-FVG зафиксирован в последних 8H. PWL ~55.0 — структурный SL якорь. POC ~55.55 = TP1.

Все 9 правил пройдены: VAL touch + re-entry, bull-FVG ≥ 0.3×ATR, выше PWL, funding/LS-top permissive (Coinglass null для альтов — strategy.md Section 'Coinglass missing → permissive'), стоп 1.27% укладывается в LTC max 4.5%, TP1 расстояние > 0.4×ATR, кулдаун ≥6h чист.

Risk: 0.375% базы; heat будет 0.375% / cap 1.5%. Equity $243,861. Дневной P&L 0%, killswitch далеко. Cap-4 имеет 4 свободных слота.

R:R: TP1 ≈ 0.43R (50% close + BE move), TP2 ≈ 2.50R (VAH). Worst case −1R = ~$914 потерь.

Funding window 00:00 UTC ±10 min только что закрылся; макро-кластер 30 апр 00:00 UTC уже прошёл (BOE/ECB/US Advance GDP/Core PCE).

Server-side SL и TP закрепляются Bybit при создании ордера (compliance HyroTrader 5min SL).

