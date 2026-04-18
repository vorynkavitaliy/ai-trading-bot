---
symbol: AVAXUSDT
direction: long
status: closed
opened: 2026-04-18T10:39:17Z
closed: 2026-04-18T10:39:45Z
entry: 9.444
sl: 9.34
tp: 9.601
exit: ~9.444
size_usd: 22472
leverage: 10
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: bull
session: london
btc_state_at_entry: transitional-bearish
news_multiplier: 1.0
trade_category: momentum-scanner-auto
thesis_snapshot: "Scanner autonomously fired 5/8 LONG AVAX as soon as cooldown expired (120m from prior AVAX close at 08:39). BTC still L:1/8 S:4/8 bearish — post-loss-streak filter in lessons-learned.md requires 6/8 OR macro confirmation. Neither satisfied. Claude-layer override applied: closed immediately by src/close-now.ts."
expected_duration: intraday
closed_reason: claude-override-post-loss-streak
r_multiple: ~0
fees_usd: ~40
pnl_usd: ~-45
note: "2nd AVAX LONG attempt today. Cooldown cleared after 1st AVAX loss at 08:39 → scanner refired 5/8 LONG. This is exactly the scenario my post-loss-streak filter (written 10 min after prior AVAX loss) is designed to block. Scanner is agnostic to that filter — Claude-layer must enforce by closing on fire."
---

# AVAXUSDT LONG #2 — 2026-04-18 (London +3h 39min)

## Why This Trade Should NOT Have Been Accepted

The scanner fired 5/8 LONG AVAX at 10:39 UTC, exactly 120 min after the cooldown from my 1st AVAX LONG loss at 08:39. The market fill executed before Claude could block.

**Five prior alt-Bull LONG fires today, four losses:**
- 07:00 DOGE L:5/8 → -0.25R
- 07:03 XRP L:6/8 → -0.30R
- 07:15 BNB L:5/8 → ~0 (scratch)
- 08:36 AVAX L:5/8 → -0.15R
- 10:39 AVAX L:5/8 → this trade

**Filter rule (from lessons-learned.md written 08:40):**
> Block further LONG accepts on remaining 4h London/Overlap window unless BTC flips back to L:4+ OR pair shows 6/8+ on 2 consecutive cycles.

**Current state at entry:**
- BTC: L:1/8 S:4/8 (bearish, not flipped)
- AVAX: only 5/8, only 1 cycle (was blocked by cooldown prior)
- → **BOTH conditions fail** → trade must be blocked

## Entry Context

- **Time:** 2026-04-18 10:39 UTC
- **Session:** London
- **BTC state:** Transitional, L:1/8 S:4/8 (bearish tilt unchanged)
- **Regime:** Bull (AVAX pair regime)
- **Scanner decision:** mechanical threshold met + cooldown cleared → exec=true
- **Claude decision:** immediate close via `src/close-now.ts AVAXUSDT Buy`

## Close Summary

- **Closed at:** 2026-04-18 10:39:45 UTC (28 sec after fill)
- **Exit:** ~9.444 (near flat)
- **Reason:** claude-override-post-loss-streak
- **R multiple:** ~0 (flat + fees ~$40-80)
- **Duration:** 28 seconds

## Immediate Takeaway

**The filter exists in my head, not in the scanner code.** When cooldowns expire, scanner autonomously refires. The only mitigation is Claude-layer override — ACT FAST on every scanner fire during a loss streak.

**Gap identified:** post-loss-streak filter should be coded into TypeScript scanner to prevent race condition where fire→exec happens before Claude can evaluate. Until then: manual override required on every fire during streak.

→ Full Postmortem: [[Postmortem/2026-04-18_AVAXUSDT_long_2]]
