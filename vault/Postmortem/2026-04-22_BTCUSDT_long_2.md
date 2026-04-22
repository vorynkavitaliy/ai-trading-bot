---
trade: 2026-04-22_BTCUSDT_long_2
date: 2026-04-22
outcome_r: -1.0
outcome_usd: -970.75
process_grade: F
category: sl_placement_error
---

# Postmortem — BTCUSDT LONG #2 (2026-04-22 07:14 UTC)

## TL;DR

Full -1R loss in ~5 minutes. Entry thesis (sweep+reclaim 78000) was defensible, но SL placement at 77900 (157pt below entry) = **amateur-tight within BTC 1H ATR range**. Single 15m wick blew через SL без confirming thesis failure (no 1H close break, no CVD sustained 2-cycle negative). Operator correctly flagged SL tightness **30 seconds after entry** — warning arrived just as wick fired, no time to adjust.

**Process grade F** — not для outcome, но для SL placement violating basic structural-SL-above-ATR-noise discipline.

## Trade Snapshot

| Field | Value |
|---|---|
| Direction | LONG |
| Entry | 78057 (market) |
| SL | **77900** (157pt below entry) |
| TP | 78500 (443pt = 2.82R target) |
| Confluence | 10/12 A-setup |
| Risk | 0.4% (cap-fit after 0.75% rejected on notional) |
| Size | 50k: 1.273 BTC / 200k: 5.095 BTC |
| Duration | ~5 min |
| Outcome | -1R / -\$970.75 realized |

## What Went Right

1. **Thesis reasonable**: sweep+reclaim round 78000 is textbook SMC pattern. CVD5m +\$1.55M burst was real institutional flow. News bias neutral confirmed 2-cycle.
2. **2-cycle news rule applied correctly** — waited C471 + C472 для neutral confirmation before unblocking LONG.
3. **C471 override logic noted** (failed breakout signature) — это было раннее предупреждение, но I dismissed at C472 когда CVD recovered.
4. **Cap discipline**: accepted margin/notional rejections, reduced к 0.4% risk within HyroTrader caps вместо override attempts.
5. **Process transparency**: wrote full rubric, rationale, trade file BEFORE execution — auditability preserved.

## What Went Wrong (CORE FAILURE)

1. **SL at 77900 violated ATR-buffer rule.** BTC 1H ATR = ~150-200pt. SL distance 157pt = INSIDE normal wick range. Per `exit-rules.md` / CLAUDE.md entry rules: "SL placement: structural + 0.5×ATR buffer". 77900 was AT structural level (round 78000 flipped-S), NOT below + buffer. Should've been 77815 (structural - 0.5×ATR = 77900 - 85pt).

2. **No ATR-check before submit.** Scanner provides ATR field; I didn't query it explicitly. Placed SL based on "round 78000 fails = thesis dead" logic without checking noise range.

3. **Chased tight R:R blindly.** 2.82R R:R looked attractive, но achievable only if SL held. Trading tight-SL for R:R при peak overbought RSI 72 = high-variance bet. Should have preferred proper SL at 77750 (below nearS 77846 + buffer) с smaller size.

4. **Ignored peak-protection heuristic.** Day already +0.76% locked. No urgency для новых trades. Peak protection memory said wait для cleaner setup — could've placed limit LONG at 77500 flipped-S for much better R:R с safer SL.

5. **Didn't heed C471 own analysis.** В C471 I wrote: "failed breakout signature — could be SHORT setup". At C472 dismissed that because CVD recovered. Но the FAILED BREAKOUT risk was real — the recovery was transient peak. Required 2-cycle CVD+ sustained before trusting breakout. Took trade on 1-cycle CVD recovery.

6. **Margin/notional rejections были signals.** Two consecutive rejects (0.75% then 0.5%) should've been information: "setup doesn't fit sizing rules for this SL". Proper response: widen SL first к 77750-77800 (fits 0.5-0.75% at smaller-notional), не reduce risk-pct.

## Root Cause

**SL placement methodology failure.** The trader-identity says "SL placement: structural + 0.5×ATR buffer". I applied "structural" without "0.5×ATR buffer". Result: SL sat AT structural level, where normal market noise оставляет wicks. 77900 failed not because thesis was wrong — it failed because SL was inside the noise.

## Lesson (for lessons-learned.md)

**"Structural SL requires ATR-buffer beneath, не AT the level. Any SL within 0.5×ATR of structural zone = wick trap."**

## Cost

- **-\$970.75 realized** (split -$199 на 50k, -$772 на 200k)
- Day P&L: +\$1873.60 → **+\$970.75** (still positive but half of target gain given away)
- DD impact: trivial (daily 0.36-0.37%, total 1.54-1.55%)

## What I'd Do Differently

**Same setup, correct execution:**
- Entry 78057 market
- **SL 77750** (below nearS 77846 + ATR buffer 96pt) = 307pt
- TP 78500 = 443pt → R:R **1.44** (just below preferred 1.5R)
- То же 0.4% risk → position adjusted (smaller) для 307pt SL
- OR: wait для pullback LONG к 77500 flipped-S c bid support → entry 77520, SL 77300, TP 78500 = 680pt / 220pt = 3.1R ✅

**Or simpler**: не trade. Day already locked target. С А+ pre-commit rules: "peak protection if day >0.5% target reached" should've blocked 10/12 borderline setup in favor of waiting tomorrow's fresh budget.

## Next Action

- **FLAT, no revenge.** Don't chase SHORT even though CVD flipped к −\$1.49M. Cold reset.
- Add this lesson к `Playbook/lessons-learned.md` с tag `[sl-widen]` inverse.
- Monitor next 1-2 cycles — если 78000 retest с fresh setup с proper SL, may re-evaluate.
- Send TG notification to operator acknowledging loss + lesson.
