---
symbol: LINKUSDT
side: buy
order_type: market
entry_price: 9.141
sl: 9.0362
tp1: 9.2551
tp2: 9.3902
risk_pct: 0.375
total_qty: 8732.2
accounts: ["50000/Ivan=1731.7","200000/Vitalii=7000.5"]
opened_at: 2026-04-30T00:34:24.791Z
closed_at: 2026-04-30T04:41:31.631Z
status: closed
closed_reason: SL_hit
exit_price: 9.034
realized_r: -1.02
pnl_usd: -934.27
pnl_usd_per_account:
  Ivan_50k: -185.28
  Vitalii_200k: -748.99
---

## Rationale

VP-SMC LONG (strategy v3 FINAL) на LINKUSDT 1H close.

Триггер: VAL ~9.04 коснулся в окне 6H, цена выше VAL (9.141). Bull-FVG зафиксирован в последних 8H. PWL ~9 — структурный SL якорь. POC ~9.25 = TP1.

Все 9 правил пройдены: VAL touch + re-entry, bull-FVG ≥ 0.3×ATR, выше PWL, funding/LS-top permissive (Coinglass null), стоп 1.15% укладывается в LINK max 5.0%, TP1 расстояние > 0.4×ATR, кулдаун ≥6h чист.

Risk: 0.375% базы. После открытия heat ≈ 0.83% (LTC + BNB Ivan + LINK). Equity $244,109.

R:R: TP1 ≈ 1.09R, TP2 ≈ 2.38R. Solid setup — second-best в этом цикле после BNB.

Server-side SL и TP закрепляются Bybit при создании ордера.

