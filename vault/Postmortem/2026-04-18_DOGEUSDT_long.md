---
trade_file: "[[Trades/2026-04-18_DOGEUSDT_long]]"
symbol: DOGEUSDT
direction: long
outcome: loss
r_multiple: -0.25
duration_minutes: 75
closed_reason: proactive-exit
process_grade: B
lesson_tag: [macro-shift-detection, system-proactive-exit-saved-account]
generalizable: false
written: 2026-04-18T08:18:00Z
---

# Postmortem — DOGEUSDT LONG — 2026-04-18 (London open)

## What I Expected

Bull alt with 5/8 mechanical fire at London open. R:R 1.5 meant at least +0.5R in normal distribution. Expected 1-2h grind toward TP 0.10005.

## What Actually Happened

Peak +$88 (+0.35R) at 07:24 — ran profitably, close to trailing-stop activation threshold (1.5R) but не quite. Funding window 08:00 bled PnL. **BTC weakened** (L:3→1/8, S:2→3/8) — macro shift detected. SHORT rose DOGE 3→4/8, triggered proactive-exit at ~0.09842. Net -$64 / -0.25R. 1h 15m duration.

## The Delta

- **Market did:** First-wave rally ended at ~07:24 peak. Funding window shook weak hands. BTC transitioning bearish sapped alt-Bull momentum.
- **I expected:** Grind to +1.5R (TP) over several hours.
- **Gap cause:** **Macro shift** from risk-on (BTC whale accumulation narrative) to BTC-weakening in single hour. Alt-Bull regime survives while BTC holds; once BTC flinches, alts follow down. System caught this by raising SHORT to 4/8 — structural warning.

## Process Review

- [x] Entry — mechanical, correct
- [x] Position management — proactive exit fired on correct signal, не held through obvious reversal
- [x] No rule violated
- [x] Vault written throughout

## Grade: **B (process)**

Entry valid, exit clean, small loss within expected. Claude (me) did not over-hold, did not panic, did not intervene. System did its job. The -0.25R is baseline mechanical cost of being in market — same thing that scores 4/8 wins gets us in the 30% of 5/8 losses. Normal.

## Generalizable Lesson

**No new lesson.** Validation of existing framework:
- Proactive-exit on SHORT 4/8+ works (cuts at -0.25R vs potentially -1R).
- Macro filter (BTC trend) properly blocks NEW alt-Bull entries when BTC turns (see current XRP/SOL/AVAX/LINK simultaneous 5/8 fires — but BTC L:1/8 S:3/8 means correlation factor = 0 for them, preventing multiple new entries into a deteriorating macro).

## Observation: Current Signal Environment (08:15 UTC)

At exact moment of DOGE close:
- SOL 5/8 L fired, R:R 1.51
- AVAX 5/8 L fired, R:R 1.51
- LINK 5/8 L fired, R:R 1.51
- BTC L:1/8 S:3/8 (bearish tilt)

**This is exactly the peak-score trap scenario** (correlated alts fire simultaneously while BTC weakens). My pause-rule + BTC correlation filter should block these. Do NOT accept mass-fire on alts when BTC just turned.

## Day Net (realized, 08:18)

- XRP: -$376
- BNB: ~-$40
- DOGE: ~-$64
- **Total realized: ~-$480 (~-1R on 50k combined)**
- 0 positions open
- DD: ~-0.96% of combined $125k starting balance — well within 5% daily limit
