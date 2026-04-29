Н---
symbol: NEARUSDT
direction: long
opened: 2026-04-27T05:24:00Z
closed: 2026-04-27T05:46:00Z
duration_min: 22
closed_reason: sl
r_multiple: -2.37
pnl_usd: -1168.18
process_grade: D
strategy_version: v2
playbook: A

---

# NEARUSDT LONG — Postmortem (2026-04-27)

## TL;DR

Playbook A range fade. Strategy gates fired clean (universe-wide capitulation, RSI 34.68, vol 2.04× SMA, BB lower tap). **Trade execution was flawed**: market order on entry slipped +0.28% destroying the tight SL cushion, then SL fill slipped further on exit. Result: planned 1R loss became 2.37R realized. Strategy thesis was sound; execution was poor.

## What Happened (timeline)

- **05:23 UTC** — Universe-wide capitulation event: 8/8 BOS_15m bearish, BTC HMM flipped к bear (72%). Scanner fires `🎯 Playbook trigger on NEARUSDT` — A-LONG on RSI 34.68, BB lower 1.38, vol 2.04× SMA.
- **05:24 UTC** — Executed via `execute.ts open` (market order). Filled at **1.3796** vs intended limit 1.3757 = +0.28% slip. SL distance jumped 0.27% → 0.55%.
- **05:24-05:43 UTC** — Position underwater. NEAR ranged 1.3755-1.3775 for ~20 min, holding above support 1.3734. ADX stayed below abort threshold (16.9, need ≥28). RSI/regime gates intact. **Held per strategy.md**.
- **05:46 UTC** — Price broke through SL 1.372. Server-side market stop fired. Combined day loss **−$1,168.18 = 2.37R** (planned 1R = $492).

## What Went Right

- **Trigger correctly identified.** Strategy gates fired cleanly без compromise — RSI 34.68 < 35, BB tap, vol 2.04× (strongest possible signal), ADX 16.83 clean RANGE (not transition).
- **Disciplined hold.** ADX stayed under 28, did not panic-close. Strategy.md says hold until SL or TP.
- **Reconciliation immediate.** Phase 0 caught divergence next cycle, no reconcile lag.
- **Vault writes complete.** Trade file + journal entries timely.

## What Went Wrong

### 1. ENTRY SLIPPAGE — primary error

Used `execute.ts open` (market order) при tight-SL setup. Market took ask, slipped from intended 1.3757 → filled 1.3796.

**Cost:** $0.0039 per coin × 132,940 (combined qty) = **$518** of avoidable slip
**Impact:** SL distance from entry doubled (0.27% → 0.55%), killed planned R/R 4.4 → 1.37.

**Fix:** Use `execute.ts place-limit` для A-LONG tight-SL setups. Set limit at trigger price 1.3757 with `--max-age-min 15`. If price moves away, signal expires cleanly. Better than paying spread на ask.

### 2. EXIT SLIPPAGE — secondary error

SL was at 1.372. Combined loss $1168 implies actual fill below 1.372 by significant amount. Market-stop orders fill at next tick after trigger — могут slip badly in fast-moving market.

**Possible fix:** Use `--sl-limit` order (stop-limit) instead of market-stop. Trade-off: stop-limit может fail to fill в gap, оставив unprotected position. Default Bybit behavior is stop-market (current).

### 3. CONTEXT JUDGMENT — secondary

Took counter-trend trade в universe-wide bear capitulation event:

- 8/8 BOS_15m bearish
- 6/8 BOS_1h bearish later
- BTC HMM flipped к bear during entry (72% → 81% → 86% → 99% over 30 min)

Strategy.md doesn't disqualify entry on cross-pair structure. **But** when ALL pairs structurally breaking down simultaneously, единичный counter-trend bid is statistically less likely to hold. Each successive A-LONG trigger fired at LOWER prices — strategy was effectively averaging into a falling knife.

**No rule violation** — trade was per playbook. Но context-aware modulation might add value: e.g., reduce size 50% when cross-pair EFFECTIVE bearish=true at entry.

## Process Grade: D

- Strategy compliance: **A** (clean gates, hold until SL, no panic exit)
- Execution: **F** (slip on entry doubled risk, slip on exit added more)
- Context awareness: **C** (ignored extreme cross-pair signals)

D overall — strategy was correct, execution was wrong.

## Lessons Learned

### NEW LESSON for `lessons-learned.md`:

**A-LONG (and any tight-SL setup) MUST use `place-limit`, never `open`.**

- Reason: Tight SL setups (0.3-0.4×ATR distance) have entire risk budget eaten by 1 spread. Market order при ATR 0.77% on alt = 0.5-1 tick worth of slippage = entire SL cushion.
- 2026-04-27 NEAR LONG: planned $492 risk (1R) became $1168 realized loss (2.37R) primarily due to entry slippage doubling SL distance.
- How to apply: A-LONG/A-SHORT triggers ALWAYS via `execute.ts place-limit --limit <trigger_price> --max-age-min 15`. Market `open` only for B-playbook trades where SL is wider (1×ATR = 0.7%+ buffer).

### EXISTING LESSONS reinforced:

- "Hold until structural abort" — followed correctly, ADX-based abort wasn't triggered.
- Reconciliation discipline — caught immediately on next cycle, no lag.

## What I Would Do Differently

1. Use `place-limit` not `open` for entry (would have either filled at 1.3757 or expired without entry).
2. Consider 0.5× size when cross-pair EFFECTIVE bearish=true at entry.
3. Document SL-fill quality from Bybit response — feedback loop to identify slippage patterns.

## Going Forward

- **Today's daily DD:** 50k −1.20%, 200k −0.29%, total −0.47% — well under 2.5% flat threshold but no more tight-SL trades today (or at least not via market `open`).
- **No NEAR re-entry** — strategy.md says 1 SL on pair today, which means 1 more allowed. But я will skip NEAR for the rest of the day to avoid revenge trading.
- **Update lessons-learned.md** with NEW execution rule.
