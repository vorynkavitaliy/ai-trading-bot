---
symbol: XRPUSDT
side: buy
order_type: market
entry_price: 1.3793
sl: 1.3536
tp1: 1.4009
tp2: 1.4138
risk_pct: 0.375
total_qty: 35671.4
accounts: ["50000/Ivan=7093.5","200000/Vitalii=28577.9"]
opened_at: 2026-04-30T00:47:23.272Z
status: open
---

## Rationale

VP-SMC LONG (strategy v3 FINAL) на XRPUSDT 1H close.

Триггер: VAL ~1.354 коснулся в окне 6H, цена выше VAL (1.3793). Bull-FVG зафиксирован в последних 8H. PWL ~1.35 — структурный SL якорь. POC обновился до 1.4009 = TP1 (раньше был TP2 на C075). VAH сдвинулся до 1.4138 = TP2.

Все 9 правил пройдены: VAL touch + re-entry, bull-FVG ≥ 0.3×ATR, выше PWL, funding/LS-top permissive (Coinglass null для альтов), стоп 1.86% укладывается в XRP max 5.5%, TP1 расстояние > 0.4×ATR, кулдаун ≥6h чист.

Risk: 0.375% базы. После открытия heat ≈ 0.83% (BNB Ivan + LINK + XRP). Equity $244,492.

R:R: TP1 ≈ 0.84R (POC), TP2 ≈ 1.34R (VAH). Setup улучшился vs C075 благодаря сдвигу POC выше — теперь TP1 за пределами BE-зоны.

LTC и BNB Ivan-only пропускаю (one-per-pair / cooldown 6h). LINK уже open оба.

Server-side SL и TP закрепляются Bybit при создании ордера.

