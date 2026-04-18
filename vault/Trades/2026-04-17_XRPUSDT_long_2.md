---
symbol: XRPUSDT
direction: long
status: closed
opened: 2026-04-17T21:15:14Z
closed: 2026-04-17T21:42:58Z
entry: 1.4793
sl: 1.4635
tp: 1.503
size_usd: 11702
leverage: 10
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: bull
session: ny
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: momentum
thesis_snapshot: "XRP 5/8 Long in Bull regime; R:R hit 1.5 trigger after full-day plateau; BTC also 5/8 Long. Risk-on macro (ceasefire, ETF inflows) supports alt-bull setup."
expected_duration: intraday
closed_reason: proactive-exit
r_multiple: -0.02
fees_usd: 12.88
note: "Second XRP Long today — first was morning-session (11:13-13:XX), closed pre-21:00 per existing file 2026-04-17_XRPUSDT_long.md"
---

# XRPUSDT LONG — 2026-04-17 (NY-session, #2)

## Why This Trade (at entry)

Первая сделка NY-session после 8+ часов плато. В 21:03 XRP R:R 1.49 испарился за 1 цикл (lesson validated — R:R floor работает). В 21:15 R:R прикоснулся точно 1.5 → mechanical layer открыл market-fill на 50k account.

- **Setup type:** momentum — XRP L:5/8 в Bull regime, стандартный threshold
- **Primary factor:** R:R 1.5 механически достигнут. Не structural sweep, а пересечение floor после долгого плато
- **Confluence breakdown:** L:5/8 vs S:2/8 — чистый long-bias
  - BTC также 5/8 Long в том же цикле → BTC correlation filter ✓
  - Regime XRP Bull + BTC Transitional-up ✓
  - News/Macro: risk-on (ceasefire + ETF inflows per 20:24 WebSearch)
- **Why this R:R:** TP 1.503 — ближайший 1H resistance; SL 1.4635 ниже 1.0× ATR + структурная buffer. R:R = 1.5 ровно (минимальный standard порог).

## Entry Context

- **Time:** 2026-04-17 21:15 UTC
- **Session:** NY (17:00-22:00 UTC), multiplier 1.0
- **BTC state:** Transitional, BTC 5/8 Long в том же цикле
- **Regime on this pair:** Bull
- **Relevant news:** Ceasefire in effect (risk-on), ETF inflows sustained per 20:24 WebSearch

## Plan at Entry

- **Entry price:** 1.4793
- **SL price:** 1.4635 (ATR-based + structural)
- **TP price:** 1.503 (1H resistance)
- **Size:** 7911.3 XRP on 50k account (~$11,700 notional @ 10x lev → ~$1,170 margin, risk ~$125 = 0.25% of 50k)
- **Accounts filled:** 50k ONLY. 200k did not fill — sizing or margin issue, investigate separately (non-critical for this position).
- **Risk USD:** ~$125 on 50k
- **Expected profit at TP:** 1.5R ≈ $188
- **Max hold:** intraday. **Dead zone starts 22:00 UTC → only 45 min of high-liq trading.** If not TP'd by 22:00 → position carries into Asian session (lower liquidity, slower). Mandatory server-side SL already set.

## Life of Trade (updates during hold)

### [2026-04-17 21:15 UTC] — Opened
- R current: 0R (entry fill)
- Structural health: intact (just opened)
- Action taken: none
- Note: 45 min до dead zone. SL/TP server-side. Price needs to move ~1.6% up to hit TP.

### [2026-04-17 21:18 UTC] — +0.2R
- Mark: 1.4825 (entry 1.4793)
- PnL: +$25.32 on 50k
- R current: ~+0.2R
- Structural: intact, XRP still L:5/8 S:3/8 (same as entry)
- Proactive exit check: SHORT 3/8 < 4/8 → HOLD. Narrative unchanged. Age 3 min.
- Action: none — let it run toward TP 1.503

### [2026-04-17 21:27 UTC] — +0.3R, confluence UPGRADED
- Mark: 1.4841 (entry 1.4793)
- PnL: +$37.97 on 50k
- R current: ~+0.3R (session high)
- **Structural: STRENGTHENED — L upgraded 5/8 → 6/8** (факторов прибавилось с entry)
- Proactive check: Would I open NOW? YES — 6/8 is structural-entry threshold, even stronger than at entry. SHORT 3/8 < 4/8. Age 12 min. HOLD firmly.
- Action: none — trailing will kick in at 1.5R per config

### [2026-04-17 21:39 UTC] — ⚠ Narrative shift: risk-off bias appeared
- Mark: 1.4777 (below entry 1.4793)
- PnL: -$12.66 (-0.1R) — first red for this position
- **Signal degraded 5/8 → 4/8, dir=None**
- **Risk-off bias in reject reasons** — макроссдвиг (1 cycle так far)
- Proactive check:
  - Would I open NOW? **NO** (4/8 < 5/8; plus risk-off needs 6/8)
  - SHORT 3/8 < 4/8 — no explicit reverse signal
  - Narrative changed? **YES** — risk-off is new
  - R: -0.1R (не ниже -0.5R cut)
- Decision: **HOLD 1 more cycle** per own lesson (news-bias 1-cycle = noise, 2+ = real). If 21:42 still risk-off + XRP 4/8 → close proactively.
- Action: none this cycle

---

## Close Summary (filled on close)

- **Closed at:** 2026-04-17 21:42 UTC
- **Exit price:** 1.4806 (avg fill)
- **Reason:** proactive-exit (narrative-shift: risk-off bias confirmed 2 consecutive cycles, signal dropped 5/8 → 4/8)
- **R multiple:** -0.02R (scratch)
- **Gross PnL USD:** +$10.28 (price delta)
- **Fees USD:** $12.88 (open $6.44 + close $6.44)
- **Net PnL USD:** -$2.59
- **Duration:** 27 min

## Immediate Takeaway

Process clean — textbook execution of proactive exit framework. Entry at R:R 1.5 trigger was mechanical. Position peaked +0.3R at 21:27 (6/8 upgrade), then faded as risk-off bias returned. Held 1 cycle to filter 1-cycle news noise (own lesson applied correctly). Exited at 2nd consecutive risk-off confirmation. Net breakeven after fees — but **process was flawless**. Fees ate a winning trade, not an error in judgement. Outcome-neutral grade: A. Process grade: A.

→ Full Postmortem: [[Postmortem/2026-04-17_XRPUSDT_long_2]]
