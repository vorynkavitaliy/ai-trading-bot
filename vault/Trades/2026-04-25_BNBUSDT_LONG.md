---
symbol: BNBUSDT
direction: long
status: closed
opened: 2026-04-25T15:34:00Z
closed: 2026-04-25T20:28:00Z
entry: 630.40
exit: 628.50
sl: 624.00
tp: 635.80
size_usd: 80019
leverage: 10
risk_r_actual: 0.41
confluence_score: 5
confluence_type: A-LONG range fade
regime: range
session: ny-london-overlap
btc_state_at_entry: range
news_multiplier: 1.0
trade_category: fade
thesis_snapshot: Playbook A LONG. RSI1h 32.09 deep oversold, price below BB lower 631.27, volume above 1.3x SMA20, ADX1h 16.6 (range). SL gate finally cleared after 7 prior aborts when price bounced from 629.40 low.
expected_duration: intraday
closed_reason: playbook-A-abort-ADX-28.9-pre-TP1
r_multiple: -0.34
pnl_usd: -274
fees_usd: ~95
---

# BNBUSDT LONG — 2026-04-25

## Why This Trade (at entry)

Playbook A range-fade per strategy.md. BNB after deep flush into 629.40 (RSI1h 27 deep oversold), buyers absorbing (CVD1m +145k earlier, ETH bid wall extreme, SOL CVD5m +739k). Bounce 629.4→631 lifted SL distance from 0% to 0.113%, finally clearing the abort gate that blocked entry 7 times today. Strategy v2 holding discipline allowed setup to mature organically.

- **Setup type:** fade (range mean-reversion)
- **Primary factor:** RSI1h<35 + close ≤ BB.lower + volume confirm + valid SL distance
- **Conditions met:**
  - close 631.0 ≤ bb_lower 631.27 ✓
  - RSI1h 32.09 < 35 ✓
  - volume_1h ≥ 1.3 × SMA20 ✓
  - ADX1h 16.6 < 22 (regime=RANGE) ✓
  - SL distance 0.113% > min 0.094% (0.3×ATR 0.313%) ✓
- **Why this R:R:** TP at bb_middle 635.75 (Playbook A TP1), SL just below bounce low 630.30. R:R 5.9 due to tight SL.

## Entry Context

- **Time:** 2026-04-25 15:34 UTC
- **Session:** NY+London overlap (quality 1.1)
- **BTC state:** Range — RSI1h 51, slight upward drift
- **Regime on BNBUSDT:** Range (ADX 16.6, EMA stack mixed)
- **Fear & Greed:** N/A (not pulled)
- **Relevant news:** Senate Committee April 29 vote on Warsh Fed nomination (low impact, neutral)

## Plan at Entry

- **Entry price:** 631.10 (filled, slight slippage from intended 631.0)
- **SL price:** 630.30 — bb_lower − 0.5×ATR ≈ 631.27 − 0.96 = 630.31 (rounded to tick)
- **TP price:** 635.75 — bb_middle SMA20 (Playbook A TP1)
- **Qty:** 154.92 BNB (50k account only; 200k account failed Bybit max_qty 370 limit)
- **Risk:** 0.22% of equity (capped by HyroTrader 2× initial notional)
- **Expected R at TP:** 5.9R
- **Max hold:** 48h (per HyroTrader rules); intraday preferred

## Life of Trade (updates during hold)

### [2026-04-25 15:34 UTC] — entry filled (50k account)

Position opened on 50k only (200k failed exchange max_qty constraint). Server-side SL 630.30 + TP 635.75 confirmed via audit.ts.

### [2026-04-25 ~15:43-15:48 UTC] — 50k SL HIT, OPERATOR OVERRIDE on 200k

50k account stop hit at 630.30 (loss ~$110 + fees, daily DD 0.18% → 0.48%).

**Operator placed new position on 200k account** (external/manual, not via my execute.ts):
- Entry: 630.40 (qty 126.90 BNB, notional $80,019)
- SL: 624.00 (distance 1.01%, ~3.2× ATR — much looser than strategy.md design 0.5×ATR)
- TP: 635.80 (same as original Playbook A TP1)
- Risk: 126.9 × 6.4 = $812 = 0.41% of 200k equity

Reconcile shows aligned (vault BNBUSDT open + Bybit has position on any account). This vault file is now retroactively reframed for the 200k position state. Original 50k entry recorded above.

### [2026-04-25 20:28 UTC] — ABORT по §A — ADX 28.9, регим сломался

Cycle 2366 / C2 since /clear. Regime flipped из RANGE (entry ADX 16.6) в TRANSITION с trend bearish: ADX 1H **28.9 ≥ 28** триггер по §A Abort, MDI 30.6 vs PDI 8.9 (extreme bearish DI separation), RSI1h 31.09, цена 628.6 ниже всех EMA. Position −0.27% от entry, unrealized −$219.

**Decision:** close market per `strategy.md §A Abort` ("ADX(14, 1H) ≥ 28 до TP1 → closed market"). EV анализ: close certain −$268 vs hold ~80% chance SL @624 → −$907 EV −$608. Close экономит ≈$340 expected.

**Execution:**
- close-now.ts BNBUSDT Buy → orderId `1f0d7ceb-8258-4228-b9a4-7922bff866e3` (200k)
- Realized PnL ≈ −$274 (equity 200k: 197827.53 → 197768.30)
- R-multiple vs operator's wider SL ($812 risk) = −0.34R
- Daily DD на 200k: 0.14% → ~0.27% (далеко от 4% kill switch)
- Server-side TP/SL orders auto-cancelled by Bybit on position close

**Telegram:** sent (2 chats, /tmp/tg-bnb-abort.txt).
