---
symbol: ETHUSDT
direction: short
status: closed
opened: 2026-04-28T17:41:00Z
closed_at: 2026-04-29T09:05:00Z
closed_reason: SL hit 2318 server-side
entry: 2291
sl: 2318
tp: 2212
exit: 2318
size_usd: 79948
leverage: 10
risk_r: 0.48
realized_r: -1.0
pnl_usd: -1064.32
trade_category: operator-opened
account: 200k
regime: trend-bear
session: ny
news_multiplier: 0.5
thesis_snapshot: B-SHORT trigger fired C3647 (all gates met cleanly: TREND ADX 33.7, EMA55 touch, close 2291 below EMA55 2303, RSI 1h 50.6 below 55, MDI 25 above PDI 15.9). Operator override during FOMC blackout, took strategy-spec values exactly.
expected_duration: intraday
strategy_sl_match: true
strategy_tp_match: true
detected_via: reconcile bybit_without_vault C3651
---

# ETHUSDT SHORT — operator-opened 2026-04-28

## Context

Operator opened ETH SHORT manually ~17:41 UTC after my C3647 TG alert about B-SHORT trigger fire. Bot alerted but SKIPPED per FOMC blackout — operator override took the trigger by hand, with risk parameters matching strategy.md spec exactly.

## Position vs strategy.md B-SHORT

| Параметр | Operator | Strategy (B-SHORT spec) |
|---|---|---|
| Entry | 2291 | 2291.57 (close at trigger) — matches |
| SL | 2318 | max(swing_high_last_10=2286.55, EMA55=2303.15) + 1.0×ATR(14.97) ≈ 2318.12 — **matches** |
| TP | 2212 | entry − 3×stop_distance = 2291 − 3×27 = 2210 — within $2 |
| R:R | 3:1 (TP1) | 3:1 (TP1 spec) |
| Qty | 34.91 ETH | size_usd $79948 = 34.91 × 2291 |
| Risk | ~0.48% / ~$943 | 0.5% × scalar 1.2 × news 0.5 = 0.3% × 200k = $590 default |
| Notional | $79,948 | within HyroTrader 2× initial limit ($400k) |
| Margin | $7,995 (10× leverage) | within 25% balance ($49,051 cap) |

**Operator chose**: full 0.48% risk (close to base 0.5%) instead of news-adjusted 0.3%. Either operator overrode news scaling or sized off pre-news 0.5% baseline. Either way, well within HyroTrader limits.

## Trigger gates met (per strategy.md B-SHORT)

- regime=TREND (ADX 1h 33.7 ≥ 25) ✓
- stack=bearish: ema8 2282.33 < ema21 2287.13 < ema55 2303.11 < ema200 2325.99 ✓
- PDI 15.9 < MDI 25.0 ✓
- EMA55 touch: gap −0.50% (entry 2291 vs EMA55 2303) ✓
- close 2291 < EMA55 2303 ✓ — rejection off pullback
- RSI 1h 49.99-50.6 < 55 ✓

## Bot policy (per CLAUDE.md § Operator-opened positions)

- **DO:** Monitor cycle-by-cycle, report status, alert on adverse moves
- **DO NOT:** Auto-modify SL/TP. Apply B-abort rule (ADX<20). Open additional ETH position
- **CAN:** Suggest via Telegram if see structural concern
- **Close authority:** operator instruction OR server-side fill OR HyroTrader hard limit

## Initial concern

**Position opened during FOMC blackout 14:00-18:00 UTC** (blackout ends in ~18 min). Operator accepting risk consciously per same pattern as TAO earlier. Risk size 0.48% — within sized risk envelope, far from kill switches.

**Setup quality: HIGH**
- Strategy gates met cleanly (no marginal levels)
- DI direction aligned with trade direction (MDI dominant + SHORT — opposite of TAO trade where PDI dominant + SHORT was anti-momentum)
- Touch was textbook (gap exactly at 0.5% threshold)
- TREND regime stable (ADX 33.7 above abort 20)

**Risk factor:** ETH could break above EMA55 2303 (need 0.55% rally) → "close < EMA55" gate fails, fundamentally invalidates B-SHORT thesis. SL 2318 would absorb that move + buffer.

## Updates

- **17:41 UTC C3651** — opened, detected via reconcile bybit_without_vault
