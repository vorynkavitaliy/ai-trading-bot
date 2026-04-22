---
trade: 2026-04-21_AVAXUSDT_long_1
date_closed: 2026-04-21
outcome: -1R
pnl_usd: -625
process_grade: B
---

# Postmortem — AVAXUSDT LONG 2026-04-21

## TL;DR
- Entry 9.42 limit filled clean at structural support level (prior breakout flipped к support).
- SL 9.35 hit 12 min later. Clean −1R loss = −$625.
- Process = B (valid setup, honest R:R, discipline intact). Outcome = −1R. **Process ≠ outcome.**

## Timeline

- **11:41 UTC**: 9/12 setup identified. Price 9.469. Limit placed at 9.42 (prior breakout now support).
- **11:41-12:05 UTC (24 min)**: Limit waiting. Setup degraded от 9/12 к 8/12 — bos_1h lost, rsi_accel weakened от +1.558 к +0.45. Held per grace-period rules (no catastrophic event).
- **12:05 UTC**: Fill at 9.42 exactly. Both accounts (1785.7 + 7142.8 AVAX = $84k total).
- **12:05-12:14 UTC (9 min)**: Position managed during grace period. CVD5m briefly flipped bullish divergence (+$16k) at 9.356 — mild hint of absorption.
- **12:14-12:17 UTC**: ETH CVD deepened к −$1.17M. Alt-wide dump cascade. AVAX dropped through nearS 9.355 к SL.
- **12:17 UTC**: SL 9.35 triggered both accounts.

## What Went Right
- **Setup was structurally valid**: BOS on все TFs bullish, close_vs_swing_15m above_prior_high, OBV +645k accelerating, HMM bull 88%.
- **Entry discipline**: limit at 9.42 avoided chase. Market entry at 9.469 would have been R:R 0.72 — below threshold.
- **Size discipline**: news medium impact → ×0.5 multiplier → 0.25% risk (half normal). Damage contained.
- **Grace period respect**: setup degraded before fill но held (no hard invalidation). Degradation wasn't catastrophic per rules.
- **SL held firm**: никаких попыток widen, никакого emotional reaction. Market triggered, exited clean.
- **No revenge trade**: after stop out, held fire (high-impact news, alt cluster red).

## What Went Wrong / What I Missed
- **Alt correlation blind spot**: At placement, ETH CVD was already bleeding (−$3M−$4M range). Didn't factor in cross-market contagion risk enough. AVAX "independent structure" thesis was too optimistic.
- **Thesis staleness at fill**: Setup was 9/12 at placement but 8/12 at fill (bos_1h dropped, rsi_accel halved). Could have argued для cancel at 10:04 re-eval. But rule says grace period protects — rule was followed.
- **BNB/XRP/SOL weakness ignored**: BNB stoch 0 extreme oversold, XRP bearish 15m BOS, SOL CVD −$400k+ all at same time. Alt cluster was telling me "dump incoming" but AVAX signal dominated.

## Lessons (candidates for lessons-learned.md)

**Lesson (NEW, generalizes)**: *When entering an alt LONG, check ETH CVD5m and at least 2 other alts. If ≥3 alts show CVD5m < −$500k deep negative = wait для cluster стабилизации даже если individual pair 9/12. Cross-market correlation overrides per-pair structure в stress regimes.*
- Why: AVAX had 9/12 standalone но alt cluster was bleeding $3M+ combined CVD when I placed. Cascading risk was visible в data.
- How to apply: add "alt-cluster CVD health" check before any alt LONG entry. If 3+ alts show CVD5m < −$500k → demand 10/12 OR wait.

## Process Grade: B

- Setup identification: A (real 9/12)
- Entry execution: A (limit honest, R:R 1.85)
- Risk sizing: A (0.25% correct for news medium)
- Management: A (grace held, no widen, no panic)
- **Missed piece**: context awareness of cross-market weakness at entry. B grade ceiling.

Outcome −1R не grade-determining. Process ran clean.

## Next Steps

1. Append lesson к `vault/Playbook/lessons-learned.md` → "Alt-cluster CVD health check before alt LONG".
2. No revenge trade. High-impact news continues, alt cluster still red.
3. Next valid setup requires: alt cluster CVD stabilize OR BTC-specific setup (BTC has own structure, less alt-correlation).
