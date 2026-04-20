---
name: BTCUSDT LONG #2 Postmortem 2026-04-20
trade_file: 2026-04-20_BTCUSDT_long_2.md
realized_r_net: +1.49
realized_r_gross: +1.96
peak_r: +2.28
realized_net_usd: 447.65
process_grade: A
outcome: profitable (TP hit)
---

# Postmortem — BTCUSDT LONG #2 2026-04-20

## Trade Summary

- **Entry**: place-limit 75240 (C652 12:07 UTC), filled at **75235.4** (~4.6 pts favorable slippage)
- **SL progression**: 75100 → 75235 (BE at +1R per lesson cascade)
- **TP**: 75500 (hit)
- **Exit**: TP 75500 (C657 12:21 UTC)
- **Realized net**: **+$447.65 combined** (+1.49R net, +1.96R gross)
- **Peak**: sweep high 75544.5 during TP trigger
- **Duration**: ~13 min (fastest winner today)
- **Confluence at entry**: 9/11 (~9.8/12) B+ Standard

## Day P&L impact

- Morning BNB LONG: -$435.50
- Midday BTC LONG #1: +$164.34
- **Afternoon BTC LONG #2: +$447.65** ← recovery trade
- **Day total: +$177 / +0.07%** (from -$271 / -0.11% before this trade)

## What Went Right

1. **Structural confirmation before entry**. I waited (C604-C651) through multiple false breakouts at 75200-75250 before taking entry. When bos_3m finally flipped bullish на cluster of 4 pairs + BTC slope3 swung -0.24 к +4.05 + MACD new high + 4H RSI crossed 50 — only then entered. This is exactly the discipline lesson 2026-04-19 "A-setup confirmed AFTER rally = chase" was supposed к teach.

2. **Place-limit discipline (retest not chase)**. BTC at 75288 breakout. Market entry R:R 1.10. Place-limit 75240 at retest zone R:R 1.86. The 48-pt pullback к 75240 filled (slippage +4.6 even better). Fill quality maximized R:R.

3. **Pre-committed rules followed precisely**. Invalidation rules (BTC reclaims 75050, news flip, not filled by maxAge) AND management rules (+1R → BE) all specified before entry. When +1R triggered (mark 75416), SL immediately moved к BE — no hesitation.

4. **WebSearch on operator hint**. When operator mentioned "Иран готов ко 2-му раунду", I WebSearched и discovered opposite (Iran rejected). Shared correction with operator transparently before making decisions. Didn't let optimistic narrative override structure.

5. **TP hit quickly** (13 min). Clean execution — no giveback, no trailing drama.

## What Could Have Been Better

1. **Position size capped by news mult 0.25 = 0.125% risk**. Gross gain potential was limited. If news classifier had been neutral (mult 0.5), size would have been 0.25% = $625 risk → $1,200 gross target at same R:R. News penalty cost ~$500 opportunity. Can't be helped — rule is rule.

2. **Fees ate 24% of gross** ($142 on $590 gross). Market exit on TP = taker fees. Limit-order exits would capture maker rebates but risk missing TP. Trade-off accepted.

3. **Second position not taken**. Operator suggested 2-3 positions. I kept discipline at 9/12 threshold, skipped 2nd. If I'd taken AVAX LONG @ 8/12 at same time, parallel bull run would have added another +1R or so. However, rubric violation + correlation risk justified single position. Process > outcome.

4. **Initial "pending_exists @ 75100" executor bug** wasted 30 seconds. Tried to cancel к clear state, executed successfully on 2nd try. Minor friction but scanner/executor state divergence is tracked issue.

## Process Grade

**A** — profitable, rule-aligned, operator-responsive. Grade details:

- ✅ Entry (waited for structural confirmation, place-limit, pre-committed rules) — A+
- ✅ WebSearch on operator hint (mandatory per CLAUDE.md trigger) — A
- ✅ Transparent correction to operator (found Iran news opposite claim) — A
- ✅ SL cascade execution at +1R (к BE immediately) — A
- ✅ TP hit clean, no giveback — A
- ✅ Position sizing discipline (news mult respected) — A
- ❌ 2nd position skip (rubric discipline over operator hint) — arguable A/B, chose A

## Lessons Reinforced

### 1. "Waiting for qualifying setup" pays

Morning BTC LONG #1 (C607): opened at 9/12 with news override. Peak +2.1R, realized only +0.4R (81% giveback).
Afternoon BTC LONG #2 (C652): opened at 9/11 with NATURAL confluence (no override). Realized +1.49R (76% of +1.96R gross gain). 

**Waited patiently through 20+ flat cycles (C622-C651) before entry materialized** — instead of forcing trades in chop. This is the lesson crystallized.

### 2. Place-limit retest > market entry at breakout

4th time today the place-limit approach worked (vs market-chase):
- Morning BTC LONG: limit 75100 got filled at 75032 (67 pts better)
- Morning LINK SHORT (cancelled before fill — rule fired) — saved position
- Afternoon BTC LONG #2: limit 75240 filled at 75235.4 (4.6 pts better)

Discipline pays in execution slippage alone, before R:R improvements.

### 3. Pre-committed rules + fast TP execution

Today's first BTC LONG (C620) gave back 81% of peak due к late SL move (по chase-filter rules I had to wait until +2R peak). This BTC LONG #2 had more aggressive post-fill cascade (BE at +1R immediately) — TP hit before trailing became relevant. Both rule sets work but for different setups.

## Follow-Up Actions

1. Update `vault/Playbook/entry-rules.md` with "cluster confirm" trigger (multi-pair bos_3m flip in same direction = stronger than single-pair)
2. Monitor if "post-ceasefire rally" news trigger sticks — could be false classifier flip
3. Session summary: market transitioning к possible NY session bull continuation
