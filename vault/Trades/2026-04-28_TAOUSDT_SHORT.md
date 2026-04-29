---
symbol: TAOUSDT
direction: short
status: closed
opened: 2026-04-28T15:18:00Z
closed: 2026-04-28T16:00:00Z
entry: 253.88
sl: 256.41
tp: 244.74
size_usd: 79927
leverage: 10
risk_r: 0.4
trade_category: operator-opened
account: 200k
regime: range
session: ny+overlap
news_multiplier: 0.5
thesis_snapshot: Operator override — A-SHORT trigger fired C3559 (close>BB upper, RSI 66, ADX 17 RANGE) but FOMC blackout 14-18 UTC blocked bot. Operator opened conservative variant with wider SL.
expected_duration: intraday
closed_reason: sl
r_multiple: -1.0
pnl_usd: -796
fees_usd: null
strategy_sl: 254.66
strategy_tp1: 248.98
operator_inline_tp: 251.53
operator_trigger_tp: 244.74
operator_sl_offset_pct: 0.69
operator_r_to_r_inline: 0.93
operator_r_to_r_trigger: 3.6
detected_via: reconcile bybit_without_vault C3561
---

# TAOUSDT SHORT — operator-opened 2026-04-28

## Context

Operator открыл вручную в районе 15:14-15:17 UTC, когда A-SHORT trigger fired в C3559 (close 254.16 > BB upper 253.26, RSI 1h=66.01, ADX 17.1 RANGE). Бот сам не открыл из-за FOMC entry blackout 14:00-18:00 UTC per catalysts.md. Operator override.

## Position vs strategy.md A-SHORT

| Параметр | Operator | Strategy (A-SHORT spec) |
|---|---|---|
| Entry | 253.88 | 254.16 (BB upper edge на момент trigger) |
| SL | 256.41 (distance 1.00%) | 254.66 (BB upper + 0.5×ATR; distance 0.16%) |
| TP1 | 251.53 (distance 0.93%) | 248.98 (SMA20; distance 1.97%) |
| R:R | 0.93:1 | ~12:1 (TP1 only), ~25:1 (TP2 = BB lower) |
| Risk | ~0.4% / ~$800 | 0.5% × scalar 0.7 (high vol) ≈ 0.35% / ~$700 (default) |

Operator выбрал **conservative variant**: гораздо шире SL (1.5× strategy), гораздо ближе TP. R:R снижен с 12:1 до 0.93:1 — outcome будет ещё more тяжело зависеть от win rate (нужен >52% WR vs ~10% для strategy version).

## Bot policy (per CLAUDE.md § Operator-opened positions)

- **DO:** Monitor cycle-by-cycle, report status, alert on adverse moves.
- **DO NOT:** Auto-modify SL/TP. Apply A-abort rule (ADX≥28). Open additional TAO position.
- **CAN:** Suggest via Telegram if see structural concern.
- **Close authority:** operator instruction OR server-side fill OR HyroTrader hard limit (4% daily DD, 8% total DD).

## Initial concern

**Entry happened DURING FOMC blackout window (14:00-18:00 UTC).** Per catalysts.md рекомендация — no fresh entries today 14:00-18:00. Operator может accepting this risk consciously (FOMC статус выпускается завтра 29 Apr, blackout сегодня = preventive). Размер риск low (~0.4%) — внутри HyroTrader ok.

**Setup concern (не риск-критичный):** TAO showed momentum breakout signature (BOS_1h+15m+3m all bullish, close above_prior_high) во время trigger. Strategy A is mean-reversion fade — backtest validated на gates но визуально это trending breakout. Если TAO продолжит выше — operator's SL 256.41 даёт buffer 1%, а strategy SL 254.66 уже бы протух.

## Updates

- **15:18 UTC C3561** — detected via reconcile (operator opened ~15:14-15:17 после моего C3559 alert)
- **15:27 UTC C3567** — TG heads-up at unrealized −0.47R / SL distance 0.53%
- **15:36 UTC C3574** — peak loss −0.62R (TAO 255.46), close call but SL held
- **15:42 UTC C3576** — recovery к −0.45R (TAO 255.07), mean reversion looked promising
- **15:47 UTC C3580** — recovery к −0.36R (TAO 254.78), 3m RSI cooled с 74 к 64
- **15:52 UTC C3582** — hourly TG heartbeat, position −0.28R lookback after recovery
- **15:55 UTC C3584** — second push to fresh high, unrealized −0.75R / SL distance 0.25%
- **16:00 UTC C3587** — **SL HIT at 256.41**, position closed −1R (~−$796)

## Close Summary

- **Closed at:** 2026-04-28 16:00:00 UTC (~42 min hold)
- **Exit price:** 256.41 (operator's SL, server-side fill)
- **Reason:** sl
- **R multiple:** −1.0R (full operator risk)
- **PnL USD:** −$796 (≈0.4% of 200k equity)
- **Duration:** 42 min

## Immediate Takeaway

Operator's wider SL (256.41 vs strategy 254.66) absorbed multiple test touches at 255.46 / 255.78 / 255.34 — strategy SL would have hit on first push. Final SL hit came after price made new high 256.48 around 16:00 UTC — possibly funding-window manipulation (16:00 UTC funding event coincides with close timing). Process-wise: bot correctly skipped per FOMC blackout, operator override took risk fully informed. Outcome −1R is within sized risk (~0.4%), nowhere near HyroTrader limits. Strategy A backtest expected ~28% loss rate at this entry quality — single sample = noise.

→ Full Postmortem: [[Postmortem/2026-04-28_TAOUSDT_SHORT]]
