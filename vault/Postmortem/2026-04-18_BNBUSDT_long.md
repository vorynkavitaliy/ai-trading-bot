---
trade_file: "[[Trades/2026-04-18_BNBUSDT_long]]"
symbol: BNBUSDT
direction: long
outcome: scratch
r_multiple: ~0
duration_minutes: 47
closed_reason: proactive-exit
process_grade: B
lesson_tag: [funding-window-volatility, proactive-exit-saved-account]
generalizable: false
written: 2026-04-18T08:05:00Z
---

# Postmortem — BNBUSDT LONG — 2026-04-18 (London)

## What I Expected

After 15 мин maturation of R:R (1.07 → 1.35 → 1.51) + steady 5/8 score, expected classic intraday momentum grind to TP 648.1 (~+1.5R). Setup distinguished from peak-score trap by gradual build-up.

## What Actually Happened

- [07:15] Entry 642.8. Peak +$77 (+0.31R) at 07:21. Steady retrace as London flow cooled.
- [07:54] +$21 crossing BE.
- [08:00] Funding window hit. Signal collapsed 5/8 → 4/8, SHORT rose 3→4/8. Mark 643.1, still +0.08R.
- [~08:02] TypeScript proactive-exit fired — mechanical rule: 4/8 opposite + signal drop = close. Exit ~642.8, near BE.

## The Delta

- **Market did:** Funding window volatility + risk-off pulse clipped signal right at 08:00 UTC.
- **I expected:** Setup to maintain through 13:00 overlap.
- **Gap cause:** Funding windows are known volatility source (my own CLAUDE.md rule: "no entries ±10 min of funding windows"). Positions held THROUGH funding get score flicker that may or may not be noise. System exited on 1-cycle signal collapse; my 2-cycle rule would have held 1 more cycle. Either way, outcome same (near BE).

## Process Review

- [x] Entry Rules followed? YES — 5/8 mature, R:R 1.51, uncorrelated с DOGE
- [x] Correlation check? YES — BNB не in alt-Bull triplet, pause-rule correctly NOT applied
- [x] SL structural? YES
- [x] Sized per risk_r? YES
- [x] Updated Trades/ file? YES (3 lifecycle updates)
- [x] Applied proactive exit framework? PARTIAL — I was about to apply 2-cycle rule when system already exited
- [x] Wrote Postmortem within 1 hour? YES

## Grade: **B (process)**

- Entry был обоснован (setup maturation, uncorrelated, R:R matured).
- Hold throughout был оправдан (R never dropped below -0.5R).
- Exit was correct (by system, when opposite direction reached threshold).
- No rule violated. No mistake made. Trade just didn't work — noise, not error.

## Generalizable Lesson

**Nothing new to codify.** This trade validates existing rules:
1. Pause-rule correctly distinguished maturation (BNB) from peak-flicker (XRP at 07:03).
2. Proactive-exit framework works mechanically when signal fades.
3. Funding windows create volatility noise — system rule "no entries ±10 min" protects entries, but positions held through need to accept some signal chop.

**Observation, not lesson:** When both Claude-layer (2-cycle rule) and system-layer (opposite 4/8) are active, system usually wins because it's faster. In this case both produced the same decision; just system got there first.

## Day Net

Realized: XRP -$376 + BNB ~-$40 = **-$416**
Unrealized: DOGE +$13 (post-funding retrace)
**Net: ~-$403**
