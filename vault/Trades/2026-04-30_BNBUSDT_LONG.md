---
symbol: BNBUSDT
side: buy
order_type: market
entry_price: 618.8
sl: 617.4586
tp1: 624.1375
tp2: 628.675
risk_pct: 0.375
total_qty: 135.38
accounts: ["50000/Ivan=135.38"]
opened_at: 2026-04-30T00:33:37.878Z
closed_at: 2026-04-30T02:30:53.464Z
status: closed
closed_reason: SL_hit
exit_price: 617.50
realized_r: -0.97
pnl_usd: -159.68
---

## Rationale

VP-SMC LONG (strategy v3 FINAL) на BNBUSDT 1H close.

Триггер: VAL ~619 коснулся в окне 6H, цена выше VAL (618.80). Bull-FVG зафиксирован в последних 8H. PWL ~618 — структурный SL якорь. POC ~624 = TP1.

Все 9 правил пройдены: VAL touch + re-entry, bull-FVG ≥ 0.3×ATR, выше PWL, funding −0.000148 (далеко от ±0.005 экстремума), LS-top 1.26 (≤ 1.7 limit), стоп ~0.22% укладывается в BNB max 4.0%, TP1 расстояние > 0.4×ATR, кулдаун ≥6h чист.

Risk: 0.375% базы. После открытия heat = 0.75% (LTC + BNB) / cap 1.5%. Equity $244,109. Дневной P&L 0%.

R:R: TP1 ≈ 4.00R (POC), TP2 ≈ 7.36R (VAH). Excellent setup — стоп очень тугой, цели широкие.

Top-tier R:R среди 4 одновременных сигналов в этом цикле (BNB highest, LINK second, XRP third).

Server-side SL и TP закрепляются Bybit при создании ордера.

