# Lessons Learned — v3

Paid-in-PnL or paid-in-LLM-time lessons. Each lesson is one observation + the cost (R or hours), not generic wisdom.

**Format:**

```markdown
## YYYY-MM-DD — Short title

**Context:** what happened.
**Cost:** −X R / N hours / $Y.
**Lesson:** the one-line rule.
**Where to apply:** which strategy / which gate.
**Status:** observed | candidate-rule | codified-into-strategy.md
```

---

## 2026-04-29 — v2-style mechanical strategies fail OOS on BTC+ETH 2025 data

**Context:** Stage 3 backtest tested range fade (BB+RSI+vol), trend pullback (EMA55), donchian breakout, extreme RSI mean reversion across 1y of 1H data. All variants negative on aggregate. Sanity test (always-long with SL=−2%/TP=+1%) gave WR 62% on BTC after engine fix — confirming engine math is correct. Strategies failed because BTC went from $94k → $77k over the year (−18% drift) and BB-fade caught the start of breakdowns, not reversals.

**Cost:** ~6 hours kodинga + bug-hunt for engine (lookahead bias + banked PnL on SL_BE — both fixed).

**Lesson:** On a multi-month bearish drift, mean-reversion at extremes is dangerous; trend-following at extremes is also dangerous (whipsaw). The setup needs to **align with the higher-TF regime**, not just the 1H signal. Don't trade range strategies during persistent drift; don't trade trend strategies during persistent chop.

**Where to apply:** Stage 4 strategy.md must include **multi-TF regime gate**: 4H ADX or daily MA slope as the master filter, then 1H signal inside the consistent direction.

**Status:** candidate-rule (validate during Claude Walk).

---

## 2026-04-29 — Engine bug: lookahead via current-bar close

**Context:** Initial scan-summary engine used `bar.close` as the entry signal price while opening at `bar.ts + 60_000` (1 minute after bar OPEN, not close). Strategy "knew" the future 1H close at decision time. Fixed by iterating with `i` representing "now at bar[i].ts" and deciding on `bar[i-1].close` (last fully-closed bar).

**Cost:** Misleading sanity-test results (WR 7% instead of expected ~67%) until caught.

**Lesson:** Always test the engine with a **trivial strategy** (always-long, fixed RR) before believing real-strategy results. WR much different from R:R-implied baseline = engine bug.

**Where to apply:** Pre-flight check before any new backtest run.

**Status:** codified — sanity-always-long is in `src/backtest/strategies/sanity-always.ts`.

---

## 2026-04-29 — Claude Walk first batch (10 candidates, 9 skip / 1 long, +2.59R)

**Context:** First 10 high-confluence candidates from Claude Walk (BB-lower + RSI<32 + vol-spike, all triple confluence). 9 skips + 1 enter_long. The single long (BTC 2026-02-19 13:00) hit TP2 for +2.59R.

**Cost:** ~5 minutes LLM time.

**Lesson:** Triple confluence (BB-touch + RSI extreme + vol spike) appears predominantly during **trending capitulation** in this market regime (ADX 28-57), NOT during range mean-reversion. Standalone the trigger has no edge — 9/10 such moments would have been losing entries if blindly traded. The 1 winner appeared in a **distinct regime**: ADX 16, ATR_pct 0.7%, stable OI.

**Where to apply:** Must add regime gate to range-fade rules in strategy.md:
- ADX(1H) < 22 (no trend)
- atr_pct(1H) < 1.5 (consolidation, not crash)
- |oi_pct_chg_24h| < 3 (no panic flow)
- no extreme funding (|fr_oi_weighted| < 0.5%)

Without these gates, the BB-touch trigger is a **continuation signal** in disguise — fading it = catching falling knife.

**Status:** candidate-rule. Need to confirm with 20-40 more samples before codifying into strategy.md.

---

## 2026-04-29 — Engine bug: PnL after TP1 SL→BE missed banked profit

**Context:** When SL fired after TP1 partial close (SL moved to BE), engine reported only the tail-side fees as the trade's pnlR, ignoring the +0.24R banked from TP1. Made even winning trades look like small losses.

**Cost:** Same as above (entangled in same bug-hunt).

**Lesson:** When implementing partial-close strategies, every exit branch must accumulate `bankedPnl` from prior partials. Centralize the exit calc, don't inline per branch.

**Where to apply:** Any future backtest engine modifications.

**Status:** codified.
