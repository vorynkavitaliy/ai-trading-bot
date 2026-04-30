---
trade_file: vault/Trades/2026-04-30_LINKUSDT_LONG.md
symbol: LINKUSDT
side: LONG
opened_at: 2026-04-30T00:34:24Z
closed_at: 2026-04-30T04:41:31Z
duration_min: 247.1
realized_r: -1.02
pnl_usd_combined: -934.27
process_grade: C
---

# Postmortem — LINKUSDT LONG (2026-04-30, SL hit)

## Outcome

- Entry 9.141 (avgFill 9.131 — slippage 0.11% в нашу сторону)
- Exit 9.034 (slippage от SL 9.0362 на 0.025 — ниже порога, потеряли small extra)
- realized R = −1.02
- PnL net: Ivan −$185.28, Vitalii −$748.99, **combined −$934.27**
- Hold 4h 7m

## What went wrong

1. **Ранжирование сетапа было неточным.** В C075 я ранжировал LINK как «second-best» сетап (R:R 2.38 к TP2). По итогу — стандартный −1R loss. То есть оценка quality по R:R-к-TP2 не предсказала исход.

2. **Стоп достаточно тугой (1.15% от entry).** Шёл 4 часа в боковике с лёгким drift вниз; в итоге BTC роняет всё на −0.5%, и LINK падает с 9.14 до 9.03 (−1.2%). Это меньше чем дневная волатильность LINK на 1H ATR. То есть стоп просто не выдержал нормального шума.

3. **Совпало с general risk-off в крипто.** BTC за тот же период −0.5%, ETH −0.7%, alts −1-2%. Один общий drift убил все long-позиции. На rangebound стратегии это всегда так — плохой regime для mean-reversion.

## What went well

1. **Server-side SL отработал точно** (с slippage 0.025 в сторону Bybit market — типично для thin orderbook на demo).
2. **Risk per trade удержан в 1R.** Никакого расширения стопа после открытия.
3. **Reconcile сразу поймал divergence**, диагностика и close в DB прошли через скрипты без ручного SQL.

## Action items

1. **Pattern observation:** Strategy выдаёт много setup-ов в low-vol range. При general drift они все становятся losers. Возможно нужен higher-TF regime gate (BTC 4H trend? ATR contraction?). Не codify пока — нужно больше данных.

2. **Slippage tracking:** в vault Trade frontmatter добавлять `entry_avg_fill` и `exit_avg_fill` — фактические Bybit-fills для slippage analysis по symbol.

## Process grade

**C** — strategy followed, execution clean, но quality-ranking промахнулся (LINK была с лучшим R:R сетапом из 4 — стопанулась первой). Это не process error, это noise-in-edge. Для grade B нужно было бы ловить regime-change pre-entry.

## Day P&L summary (after this loss)

- Realized: LTC +$312, BNB −$160, **LINK −$934** = **−$782**
- Open: XRP ×2 (currently +$50 floating)
- Day total: ~−$732 (−0.30%, всё ещё далеко от soft-kill −2.5%)
