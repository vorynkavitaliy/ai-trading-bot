---
symbol: BNBUSDT
direction: long
status: closed
opened: 2026-04-18T07:15:17Z
closed: 2026-04-18T08:02:00Z
entry: 642.8
sl: 639.3
tp: 648.1
exit: ~642.8
size_usd: 45915
leverage: 10
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: transitional
session: london
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: momentum
thesis_snapshot: "BNB L:5/8 dir=Long после 15 мин maturation (R:R 1.07 → 1.35 → 1.51). Transitional regime, exchange token — uncorrelated с DOGE alt-Bull. Setup не пик-трап: gradual R:R build-up = реальное подтверждение."
expected_duration: intraday
closed_reason: proactive-exit
r_multiple: "~0"
fees_usd: ~40
pnl_usd: "~-40 (estimate, fees dominant)"
note: "Closed by system proactive-exit during funding window volatility (08:00 UTC). Signal collapsed 5/8→4/8, S rose to 4/8 — TypeScript layer closed на сigналe. Exact exit price TBD from DB."
---

# BNBUSDT LONG — 2026-04-18 (London +15m)

## Why This Trade (at entry)

BNB показывал L:5/8 с R:R < 1.5 в течение предыдущих 4+ циклов (1.02, 1.07, 1.35, 1.42) — signal был готов, но R:R gate not crossed. На 07:15 R:R стал 1.51 — floor достигнут, mechanical fire cleared. **Это противоположность peak-score trap'а: signal матурировал 15 мин, не flicker.** Моя pause-rule (из XRP lesson) specifically про back-to-back correlated fires в соседних циклах — BNB не соответствует: (a) другой regime, (b) другой sector, (c) setup строился долго.

- **Setup type:** momentum — 5/8 standard, R:R 1.51 trigger after maturation
- **Primary factor:** R:R floor cleared after 15+ min build-up
- **Confluence breakdown (L:5/8 S:3/8):**
  - SMC/Structure: probably 1 (weak)
  - Technical: 1
  - Volume: 1
  - Multi-TF + BTC: 0 или 1 (BTC Transitional)
  - Regime + BTC: 0 (BNB regime also Transitional, neutral)
  - News/Macro: 1
  - Momentum: 1
  - Volatility: 0 или 1
- **Why this R:R:** TP 648.1 — 1H resistance. SL 639.3 — ATR-based + buffer. R:R = 1.51 (тонко над 1.5 floor).

## Entry Context

- **Time:** 2026-04-18 07:15 UTC
- **Session:** London (07:00-13:00 UTC), multiplier 1.0
- **BTC state:** Transitional
- **Regime on this pair:** Transitional
- **Relevant news:** Без high-impact flags.

## Plan at Entry

- **Entry price:** 642.8 (market fill)
- **SL price:** 639.3 (ATR-based + structural)
- **TP price:** 648.1 (1H resistance)
- **Size:** 71.42 BNB on 50k account (~$45,915 notional @ 10x lev)
- **Accounts filled:** 50k показан в reconcile output. Ожидаю 200k тоже заполнился (после XRP коррекции, оба аккаунта работают). Telegram подтвердит.
- **Risk USD:** ~$250 on 50k equivalent
- **Expected profit at TP:** 1.51R ≈ $378
- **Max hold:** intraday.

## Portfolio view

- DOGE LONG (5/8 Bull alt) + BNB LONG (5/8 Transitional exchange) = 2 positions, **NOT correlated** (different regimes, different sectors).
- Total heat: ~$500 ≈ 1% of 50k. Well under 5% cap. ✅
- Directional: 2 longs, but uncorrelated — OK.
- Slot check: 2/3 base slots used.

## Life of Trade (updates during hold)

### [2026-04-18 07:15 UTC] — Opened
- R current: +0.05R (mark 642.97, +$12)
- Structural health: intact
- Action taken: none
- Note: Post-XRP lesson applied correctly. Not every fire is peak-trap — setup maturation over 15 min = different beast than 3-min flicker. Pause-rule designed to filter the flicker, not block maturation.

### [2026-04-18 07:15-07:48 UTC] — Steady climb
- Peak +$77 at 07:21 (~+0.31R). Retrace to +$21 by 07:54.
- 5/8 holding throughout. No management action.

### [2026-04-18 08:00 UTC] — ⚠ Funding window signal collapse
- Mark: 643.1 (~+$21, +0.08R)
- **Structural: DEGRADED. L:5/8 → 4/8, S:3/8 → 4/8, dir=None.**
- Context: 08:00 UTC funding rate window — known volatility source.
- Decision: HOLD 1 more cycle per own 2-cycle rule.

### [2026-04-18 08:00-08:03 UTC] — Closed by TypeScript proactive-exit
- System закрыл position ДО моего 08:03 cycle. Aligned=false at 08:03:15 reconcile.
- Mechanical layer не waited 2-cycle — 4/8 SHORT reached threshold, triggered exit directly.
- Duration ~47 min. Close price ~642.8 (near BE).

---

## Close Summary

- **Closed at:** 2026-04-18 ~08:02 UTC (between 08:00 and 08:03 cycles)
- **Exit price:** ~642.8 (near break-even)
- **Reason:** proactive-exit (mechanical layer, signal collapse 5→4 + SHORT 4/8)
- **R multiple:** ~0R (near break-even)
- **Est. Net PnL USD:** ~-40 (fees dominant)
- **Fees USD:** ~40 (round-trip on $46k notional × 2 accounts)
- **Duration:** ~47 min

## Immediate Takeaway

Entry was correct (setup matured 15 min, not flicker, pause-rule properly not applied). Run profitable peak +$77 (~+0.31R) at 07:21 then slowly retraced as funding window approached. System proactive-exit closed near break-even when signal degraded — saved from potential -0.5R hit. **Process clean. Outcome: fees paid, no R surrendered.** Unlike XRP (where I accepted a peak-score fire), BNB entry was justified by maturation. The exit on funding window noise is OK — system rules protect the account. Net: break-even trade, some fees, no lesson violated.

→ Full Postmortem: [[Postmortem/2026-04-18_BNBUSDT_long]]

---

## Close Summary (filled on close)

*TBD*
