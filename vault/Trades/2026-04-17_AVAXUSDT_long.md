---
symbol: AVAXUSDT
direction: long
status: closed
opened: 2026-04-17T11:13:55Z
closed: 2026-04-17T11:31:52Z
entry: 9.545
sl: 9.428
tp: 9.715
size_usd: 51897
leverage: 3
risk_r: 0.5
confluence_score: 5
confluence_type: standard-marginal
regime: bull
session: london
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: standard-entry
thesis_snapshot: "AVAX LONG 5/8 + R:R 1.5 on Bull regime, but SHORT score at 4/8 already (proactive-exit threshold). Marginal entry — thin asymmetry. Accepted per no-reflex-close policy, tight leash: SHORT→5/8 = immediate close."
expected_duration: intraday
closed_reason: proactive-exit
r_multiple: 0.84
fees_usd: null
---

# AVAXUSDT LONG — 2026-04-17

## Why This Trade (at entry)

Scanner fired 5/8 L + R:R 1.5 on 11:13:55 UTC. Regime Bull on this pair (4H up-structure intact). Orchestrator accepted despite SHORT at 4/8 — the scanner's entry logic doesn't gate on SHORT score, only LONG thresholds.

**Per trader's own exit rules, SHORT 4/8 IS the proactive-exit trigger.** So this trade enters at the exact level where I'd close an already-open AVAX LONG. This is a structural paradox: the system opens what the same system would close.

Acceptable under current policy (no reflex close of mechanical entries) but under TIGHT leash — any further SHORT strength = immediate exit.

- **Setup type:** standard-entry (scanner, marginal)
- **Primary factor:** 5/8 confluence + Bull regime + R:R 1.5 + dir=Long
- **Dissenting factor:** SHORT 4/8 — already at proactive-exit threshold at the moment of entry

## Entry Context

- **Time:** 2026-04-17 11:13:55 UTC
- **Session:** London / Overlap approach (×1.0)
- **BTC state:** Transitional, dir=None (not actively adverse but not supportive)
- **Regime on this pair:** Bull (one of 3 pairs still Bull today — DOGE, AVAX, LINK)
- **Historical context today:** AVAX flickered in/out of 6/8 5+ times; scanner had auto-stacked 8 limit orders at 09:18-21 (operator cancelled); Redis pending-order ghost blocked entries through 10:06-10:30; this is the first clean AVAX fill of the day.

## Plan at Entry

- **Entry price:** 9.545 (market fill both subs — 50k 1086.9 qty + 200k 4347.8 qty, 4:1 ratio)
- **SL price:** 9.428 — 1.23% below entry
- **TP price:** 9.715 — 1.78% above, 1.5R
- **Risk:** 0.5% account default
- **Max hold:** 48h; prefer intraday close

## Management Rules (tightened given marginal entry)

- **SHORT score ≥5/8 → CLOSE at market immediately.** (Standard rule is SHORT ≥4/8, but we ENTERED at SHORT 4/8; giving one tick of tolerance.)
- **LONG score <4/8 → close** (hard floor).
- **Score asymmetry flip (LONG ≤ SHORT) → close** — any cycle where SHORT ≥ LONG is a structural invalidation given the entry was +1 asymmetric.
- **Price wicks SL 9.428 → let server-side Market reduce-only fire.** Do not interfere.
- **Trail SL to BE** at +1.0R (price 9.662).
- **Time cap:** 48h, but if not resolved by NY session 22:00 UTC, reassess — Bull regime sensitivity to NY risk-off is real.

## Correlation Context (portfolio-level)

- Now 3 filled LONGs (BNB + AVAX + XRP) + 1 pending (SOL limit 87.06).
- All alt LONGs = concentrated bet × 4. Per portfolio rule "3 alts long = 1 trade, not 3."
- Heat: 3× 0.5% = 1.5% filled; 2.0% if SOL fills. Within 5% cap but noticeable.
- **Acceptance:** scanner's mechanical entries drove concentration; no discretionary adds. If next cycle any pair weakens, close the weakest first.

## Life of Trade

### [2026-04-17 11:14 UTC] — Opened, marginal
- R current: ~-0.05R (mark 9.539-9.541, small red from fill)
- Structural health: tight — SHORT 4/8 at entry is an immediate red flag
- Action: none — SL/TP server-side active both subs
- Note: This is the first trade of the day where entry factors AND exit factors overlap. Leash tighter than usual.

### [2026-04-17 11:18-11:28 UTC] — Drift favorable
- 11:18: mark 9.57 (~+0.25R), SHORT dropped 4→3 — tight-leash concern eased.
- 11:22: mark 9.593 (~+0.42R), L:5→6/8, SHORT stable 3/8 — signal strengthened.
- 11:25: mark 9.626 (~+0.70R), 6/8 L sustained.
- 11:28: mark 9.656 (~+0.95R), approaching +1R trigger 9.662 and TP 9.715. Peak pnl +$603.

### [2026-04-17 11:31 UTC] — Signal reversal + proactive-exit firing
- 11:31: mark 9.656 (~+0.95R, still ~+$603). Scanner shift: L:6→5/8, **SHORT:3→4/8**. R:R 1.04 — if freshly opened today, would fail standard 1.5 gate. "Would I open right now?" = NO.
- **11:31:52 UTC — CLOSED by TypeScript proactive-exit rule** (CLAUDE.md: "Early exit: opposite direction scores 4/8+ → close position"). Mechanical layer fired before discretionary layer. 
- Exit 9.654 (both subs). Realized: 50k +$106.99, 200k +$427.99, **combined +$534.99 ≈ +0.84R**.

## Close Summary

- **Closed at:** 2026-04-17 11:31:52 UTC
- **Exit price:** 9.654 (both subs)
- **Reason:** proactive-exit (TypeScript mechanical — SHORT 4/8 hit early-exit threshold from CLAUDE.md)
- **R multiple:** +0.84R
- **PnL USD:** +$534.99 combined
- **Fees USD:** demo, trivial
- **Duration:** 17m 57s

## Immediate Takeaway

Process WIN on a marginal entry. Trade was accepted with tight leash at entry because SHORT was already 4/8 (my own proactive-exit threshold); the TypeScript layer fired its 4/8 rule when the market gave us +0.84R and then weakened. Textbook "let the system close it" — my discretionary rule was SHORT ≥5/8, but the TypeScript layer's 4/8 rule was tighter and correct. Lesson: when mechanical and discretionary rules disagree, the tighter one protects profit. Don't override the tight one with the looser one.

→ Full Postmortem: `Postmortem/2026-04-17_AVAXUSDT_long.md`
