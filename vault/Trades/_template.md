---
symbol: XXXUSDT
direction: long           # long | short
status: open              # open | closed
opened: YYYY-MM-DDTHH:MM:SSZ
closed: null              # ISO timestamp on close
entry: 0.0000
sl: 0.0000
tp: 0.0000
size_usd: 0
leverage: 0
risk_r: 0.5               # % of account at risk
confluence_score: 0       # 0-8
confluence_type: ""       # structural | standard | counter-trend | A+
regime: range             # at time of entry
session: ""               # asian | london | overlap | ny
btc_state_at_entry: ""    # bull | bear | range
news_multiplier: 1.0      # applied at entry
trade_category: ""        # structural-entry | momentum | fade | breakout | reversal
thesis_snapshot: ""       # 1-2 sentences of WHY
expected_duration: ""     # intraday | multi-day
closed_reason: null       # sl | tp | trail | proactive-exit | time-stop | strategic-close
r_multiple: null          # final R on close
fees_usd: null
---

# {SYMBOL} {DIRECTION} — {DATE}

> One file per trade. Created at open. Updated during life. Finalized at close. Then a Postmortem is written.

## Why This Trade (at entry)

*2-4 sentences articulating the thesis. If I cannot articulate it, I should not be in it.*

- **Setup type:** [structural / momentum / fade / breakout / reversal]
- **Primary factor:** [the ONE thing that made me take this — SMC structure? momentum? counter-trend at extreme?]
- **Confluence breakdown:** [score each of 8 factors]
  - SMC/Structure: X
  - Technical: X
  - Volume: X
  - Multi-TF + BTC: X
  - Regime + BTC: X
  - News/Macro: X
  - Momentum: X
  - Volatility: X
- **Why this R:R:** [target structural level, SL beyond invalidation]

## Entry Context

- **Time:** YYYY-MM-DD HH:MM UTC
- **Session:** [asian/london/overlap/ny]
- **Session multiplier:** [0.85/1.0/1.1/0.7]
- **BTC state:** [bull/bear/range] — [1H direction]
- **Regime on this pair:** [bull/bear/range/transitional]
- **Fear & Greed:** [value]
- **Relevant news:** [1-2 sentences or "none"]

## Plan at Entry

- **Entry price:** [filled]
- **SL price:** [level] — [1.0x ATR + structural buffer]
- **TP price:** [level] — [structural target, 1.5R+]
- **Risk:** [%] of account
- **Expected R at TP:** [R]
- **Max hold:** 48h / [intraday preference]

## Life of Trade (updates during hold)

*Appended as time passes. Each update timestamped.*

### [YYYY-MM-DD HH:MM UTC]
- R current: [value]
- Structural health: [intact / weakening / broken]
- Action taken: [none / tightened SL / trailed / moved to BE]
- Note: [observation]

---

## Close Summary (filled on close)

- **Closed at:** YYYY-MM-DD HH:MM UTC
- **Exit price:** [value]
- **Reason:** [sl / tp / trail / proactive-exit / time-stop / strategic-close]
- **R multiple:** [value]
- **PnL USD:** [value]
- **Fees USD:** [value]
- **Duration:** [hours]

## Immediate Takeaway (written at close, before Postmortem)

*One sentence: was this trade well-executed regardless of outcome?*

Example: "Good execution — entry was textbook sweep+OB tap at 4/8 structural threshold, SL beyond invalidation, trail followed rule. Outcome was -1R due to narrative shift I could not anticipate. Process clean."

→ Full Postmortem: [[Postmortem/YYYY-MM-DD_SYMBOL_DIRECTION]]
