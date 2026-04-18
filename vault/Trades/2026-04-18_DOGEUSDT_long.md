---
symbol: DOGEUSDT
direction: long
status: closed
opened: 2026-04-18T07:00:19Z
closed: 2026-04-18T08:15:00Z
entry: 0.09866
sl: 0.0977
tp: 0.10005
exit: ~0.09842
size_usd: 26244
leverage: 10
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: bull
session: london
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: momentum
thesis_snapshot: "DOGE 5/8 Long в Bull regime на London open. R:R 1.5 достигнут после долгой фазы execution-dead (7/8 при R:R 0.53 вчера). Mechanical fire сразу на wake-up scanner."
expected_duration: intraday
closed_reason: proactive-exit
r_multiple: "~-0.25"
fees_usd: ~60
pnl_usd: ~-64
note: "CORRECTION (2026-04-18): оба аккаунта заполнились (50k + 200k), NOT silent fail. Reconcile output interpretation ранее была неверна. Position held 1h 15min, proactive-exit fired on S:4/8 rise."
---

# DOGEUSDT LONG — 2026-04-18 (London open)

## Why This Trade (at entry)

Первая сделка дня. Bot проснулся в 07:00 UTC после dormant-window (22:00-07:00), первый же scan выдал DOGE L:5/8 dir=Long exec=true. R:R ровно 1.5 — тот же механический trigger, который вчера отработал на XRP #2. DOGE вчера весь день сидел в execution-dead zone (scoring 6-7/8 при R:R 0.5) — теперь структура подтянулась к ценам.

- **Setup type:** momentum — 5/8 standard threshold, регулярный entry
- **Primary factor:** R:R 1.5 trigger в Bull regime после ночной консолидации
- **Confluence breakdown (L:5/8 S:3/8):**
  - SMC/Structure: likely 1 (weak, не sweep+OB)
  - Technical: 1 (RSI/MACD поддержка)
  - Volume: 1 (OBV bull)
  - Multi-TF + BTC: 0 или 1 (BTC sам transitional)
  - Regime + BTC: 1 (Bull regime подтверждён)
  - News/Macro: 1 (neutral/risk-on)
  - Momentum: 1 (ADX/DI)
  - Volatility: 0 (ATR нормальная)
- **Why this R:R:** TP 0.10005 — ближайший round-number + структурный 1H resistance. SL 0.0977 — 1.0×ATR ниже entry. R:R механически = 1.5.

## Entry Context

- **Time:** 2026-04-18 07:00 UTC
- **Session:** London (07:00-13:00 UTC), multiplier 1.0
- **BTC state:** Transitional (per thesis, consolidating $73-75k range)
- **Regime on this pair:** Bull
- **Relevant news:** No high-impact flags at wake-up. Risk-on overnight carry from 17-Apr close.

## Plan at Entry

- **Entry price:** 0.09866 (market fill)
- **SL price:** 0.0977 (ATR-based + structural)
- **TP price:** 0.10005 (1H resistance + round number)
- **Size:** 265957 DOGE on 50k account (~$26,244 notional @ 10x lev → ~$2,624 margin, risk ~$255 = 0.5% of 50k)
- **Accounts filled:** 50k ONLY. 200k did not fill again — SAME issue as XRP #2 on 17-Apr. Investigate separately (non-critical for this position).
- **Risk USD:** ~$255 on 50k
- **Expected profit at TP:** 1.5R ≈ $380
- **Max hold:** intraday. London session just opened → 6h of high-liq trading before dead zone (22:00). Mandatory server-side SL already set.

## Life of Trade (updates during hold)

### [2026-04-18 07:00 UTC] — Opened
- R current: 0R (entry fill)
- Structural health: intact (just opened)
- Action taken: none
- Note: First trade of the day, London just opened. Scanner fired immediately on wake-up. 6h of high-liq time before dead zone. SL/TP server-side. Price needs ~1.4% move to TP.

### [2026-04-18 07:00-08:00 UTC] — Solid run
- Peak +$88 (+0.35R) at 07:24. Steady at +$50-77 for ~45 min. Held 5/8 throughout.

### [2026-04-18 08:00-08:12 UTC] — Funding window digestion
- PnL drifted down from +$53 → +$29 → +$3 through funding window.
- 5/8 score held (proactive-exit not triggered).

### [2026-04-18 08:15 UTC] — ⚠ Closed by system (SHORT 4/8)
- Mark: ~0.09842, PnL ~-$64 (-0.25R)
- S rose from 3/8 → 4/8 → proactive-exit triggered by TypeScript layer.
- BTC weakening (L:1/8 S:3/8) — macro headwind.

---

## Close Summary

- **Closed at:** 2026-04-18 ~08:15 UTC
- **Exit price:** ~0.09842
- **Reason:** proactive-exit (SHORT reached 4/8 threshold + BTC bearish tilt)
- **R multiple:** ~-0.25R
- **Gross PnL USD:** ~-64 (price delta losses)
- **Fees USD:** ~60 (estimate round-trip)
- **Net PnL USD:** ~-64 (gross) - fees may have been part of reported pnl
- **Duration:** 1h 15m

## Immediate Takeaway

Entry was justified (mature Bull regime, R:R 1.5 mechanically, uncorrelated at time of fire since XRP/BNB не yet open). Position ran to +0.35R peak, never hit trailing stop activation (1.5R threshold). Proactive-exit fired when BTC weakness + SHORT tilt = macro turning. **Process clean** — система held through funding noise, fired when real bearish shift emerged. Loss small (-0.25R), within expected distribution for 5/8 standard trades. Key: BTC macro shift is the read for the afternoon.

→ Full Postmortem: [[Postmortem/2026-04-18_DOGEUSDT_long]]
