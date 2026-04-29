---
date: 2026-04-28
symbol: TAOUSDT
direction: short
trade_category: operator-opened
account: 200k
opened: 2026-04-28T15:18Z
closed: 2026-04-28T16:00Z
duration_min: 42
entry: 253.88
exit: 256.41
sl: 256.41
tp: 244.74
qty: 314.675
r_multiple: -1.0
pnl_usd: -796
day_dd_impact: 0.40%
process_grade: B
---

# Postmortem — TAOUSDT SHORT 2026-04-28

## What happened

15:18 UTC — Operator opened TAOUSDT SHORT manually на 200k account при entry 253.88, после того как мой scanner C3559 в 15:14 UTC показал **A-SHORT trigger fire** (close 254.16 > BB upper 253.26, RSI 1h 66.01, ADX 17.1 RANGE, vol spike). Бот сам не открыл из-за **FOMC entry blackout 14:00-18:00 UTC** per catalysts.md (Apr 28 = FOMC day 1 + USTR China hearing). Operator override.

Position лоss отслеживался cycle-by-cycle:
- C3567 15:27 UTC: −0.47R, отправлен TG heads-up с 4 опциями операторy
- C3574 15:36 UTC: peak intermediate −0.62R на TAO 255.46
- C3580 15:47 UTC: recovery к −0.36R (TAO 254.78), 3m RSI cooled с 74 к 64
- C3582 15:52 UTC: hourly TG heartbeat при −0.28R
- C3584 15:55 UTC: second push −0.75R (TAO 255.78), SL distance 0.25%
- C3587 16:00 UTC: **SL hit на 256.41** при funding event coincidence

## Why SL hit

Three factors combined:

1. **Trigger setup внутри TREND-bear regime overall** — TAO специально показывал bullish stack (PDI 30 vs MDI 12) внутри ADX 17 RANGE classification. Это редкий случай: pair в RANGE regime по ADX но с extreme directional bias по DI. Strategy A gates сработали formally (close>BB upper, RSI>65, vol), но visually это был momentum breakout, не range top.

2. **Funding window manipulation** — 16:00 UTC funding event совпал с SL hit timing. TAO достиг fresh high 256.48 just at funding settlement, после чего funding rate flipped к +0.0050% (был slightly negative). Possible: market makers pushed price last 10-15 min before settlement to either (a) raid stops above 256.40 (likely, given $796 size on operator's SL was substantial liquidity to take), or (b) attract fresh shorts post-spike for funding rebate. Не первый раз вижу этот pattern на crypto perp.

3. **Strategy SL would have been hit earlier** — strategy.md A-SHORT spec gives SL = BB upper + 0.5×ATR ≈ 254.66 на момент trigger. Это значит strategy-sized version ушла бы в SL уже на первом push к 255.46 (C3574). Operator's wider SL 256.41 (1.5× strategy distance) absorbed 4 test touches at 255.46 / 255.78 / 255.34, но failed at final break.

## Strategy gates assessment

| Gate | At trigger (C3559) | At SL hit (C3587) | Result |
|---|---|---|---|
| close ≥ BB upper | ✓ 254.16 > 253.26 | ✓ 256.41 > 255.20 | gates valid through |
| RSI 1h > 65 | ✓ 66.01 | ✓ 70.46 (overbought worse) | strategy says fade |
| ADX < 22 RANGE | ✓ 17.1 | ✓ 19.4 (climbing к TRANSITION) | regime stable |
| Volume ≥ 1.3× SMA | ✓ (scanner triggered) | — | confirmed |

Strategy A.SHORT abort rule: `ADX ≥ 28 до TP1 → exit market`. ADX climbed 17.1 → 19.4 (delta +2.3). Не достиг 28 abort. Strategy machine не closed sooner. Pure SL stop.

## What process worked

- **Bot correctly skipped per FOMC blackout** — per catalysts.md rule for Apr 28 day 1. No bot trade executed despite trigger fire.
- **Operator override followed CLAUDE.md protocol** — wider SL (operator's call), accepted size ~0.4% risk внутри HyroTrader limits. Vault file created with `trade_category: operator-opened`, journal logged, TG alerted.
- **Bot maintained discipline** — DID NOT auto-modify SL/TP, DID NOT open parallel TAO positions, monitored cycle-by-cycle, sent two timely TG heads-up at deterioration thresholds.
- **Reconcile system worked** — divergence detected immediately, vault sync corrected, SL hit detected immediately and properly closed-out.

## What process didn't work / improvement candidates

- **None operationally.** SL was triggered server-side as expected. Bot's role was monitoring, not decision-making (operator-opened).
- **Strategy-side question (not bot fault):** A-SHORT gates met formally but visually trending breakout. Backtest's Strategy A on TAO covers 365d historical и validated на этих gates — single-sample loss не повод менять. But a future enhancement could be: **directional DI filter on A-playbook**. If `PDI - MDI > 15` and trigger direction opposite (PDI dominant + A-SHORT trigger or MDI dominant + A-LONG trigger) → stricter veto. Currently strategy A treats DI direction as informational only. Не менять без backtest validation.

## Lesson candidate (NOT to lessons-learned.md from N=1)

Single-trade loss with operator's well-sized risk управление — not a lesson, just sample noise. Strategy A backtest baseline expected ~28% loss rate on triggers; this is one of those. Не обновляю lessons-learned per "Lesson НЕ сюда если: неотделима от удачи/невезения" rule.

**Не lesson, но observation worth tracking:** funding-window stop-raid pattern. If we see 2+ more SL hits coinciding с 00/08/16 UTC funding events on stops just above local highs/lows (within 0.2% buffer of round numbers or bands) → that's pattern, time для lesson. Currently N=1.

## Process grade

**B** — operationally clean (bot followed all rules, divergence detected immediately, communications timely), but suboptimal trade outcome was unavoidable given operator's setup choice. Bot did its job; trade just didn't work.

## Account impact

- 200k equity: $197,128 (start) → $196,204 (post-SL) = −$924 day P&L (includes ~$130 funding/fees + $796 trade loss)
- Day DD: 0.46% (way below 4% kill switch)
- Total DD: 1.90% (way below 8% hard stop)
- 50k account: untouched ($48,652, no trades)

## Forward bot policy

Per CLAUDE.md "Pair had 2 SL today → disable pair until next UTC day": TAO has **1 SL on 200k**. If second TAO SL hits today (next 8 hours до 00:00 UTC) — pair becomes disabled for entries. Operator-opened still respected if happens.

Per "TAO is A-only pair": confirmed. No B-SHORT or B-LONG even after stop-out.

Continue normal cycle protocol. No strategy changes from this trade.
