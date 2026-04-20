---
symbol: ETHUSDT
direction: short
status: closed
opened: 2026-04-19T17:36:40Z
closed: 2026-04-19T19:06:30Z
entry: 2308.1
exit: 2298.4
sl: 2355
tp: 2220
size_usd: 29455.5
leverage: 0
risk_r: 0.25
confluence_score: 10
confluence_type: standard
regime: effective-bear
session: ny
btc_state_at_entry: bear-intraday-strong
news_multiplier: 0.5
trade_category: trend-continuation
thesis_snapshot: "ETH SHORT market-entry after cancel of far-out 2325 limit (0.8% away in ADX 35.5 strong trend). 8/8 pairs bos_15m bearish, OBV re-flipped negative, BTC slope1h -6.01."
expected_duration: intraday
placed_at: 2026-04-19T17:25:10Z
limit_price_cancelled: 2325
cancel_reason: "limit >0.3% away in ADX>25 strong-trend per new feedback rule"
order_ids:
  50k_open: c3a0009c-c930-4682-8c1e-5e1598f05700
  200k_open: 7234a460-d8b3-481c-8e4c-ee0937096c34
  close: 8a450bae-2683-41e6-9cc0-d7dc33988289
closed_reason: narrative_shift_defensive
r_multiple: 0.11
realized_net_usd: 66.59
realized_gross_approx_usd: 124
fees_usd: ~57
---

## Close Summary

**Closed:** 2026-04-19 19:06:30 UTC · defensive narrative_shift · **+0.21R / ~+$124 gross** (pending src/pnl-day.ts confirmation).

**Trigger**: 3-cycle BTC momentum deceleration + peak give-back 48%.
- BTC slope1h: −6.92 → −2.57 → −2.20 → **−1.78** (74% reduction over 3 cycles)
- BTC chg5_15m: +0.06% → +0.12% → **+0.19%** (sustained accelerating positive)
- BTC RSI1h: 32.7 → 34.8 → 35.9 → **37.2** (recovering faster)
- ETH 3m RSI **52.07** (cleanly >50)
- Peak +0.40R / +$239 (C435) → current +0.21R / +$124 = 48% give-back

**Judgment override**: pre-commit rules не triggered (peak +0.40R << +1R Peak Proximity Trail; opposite LONG 2/12 << 8/12 proactive-exit). Honored "Claude overrides" clause per CLAUDE.md — 3-cycle deceleration pattern + 48% give-back = structurally confirmed momentum exhaustion. Closing aligned with **spirit** of "Lock 50% of peak R" lesson (current $124 ≈ 50% of peak $239, de-facto banked half).

**Symmetric override test passed**: if LONG at same conditions (opposing 3-cycle slope collapse 74%, peak give-back 48%) — аналогичное решение.

## Immediate Takeaway

**Peak-give-back protection should activate below +1R milestones too.** My lessons-learned file prescribes Lock-50% at +1R, but today's cycle showed +0.40R peak pattern с 48% give-back тоже deserves protection. Going to propose update to exit-rules.md:
- **Below +1R (e.g., peaks +0.3R to +1R)**: when opposing-side momentum compounds 3+ cycles (slope reduction >50%, chg5_15m sustained positive) AND price stalls 2+ cycles in range → consider defensive close locking >= 50% of peak R. Below the formal +1R trigger but honoring спиrit of peak-protection.

Lesson to codify after session review if pattern recurs.

## Execution Plan (REVISED C411 17:36 UTC)

**Original plan (C407):** Limit @ 2325 retest EMA21. **CANCELLED C411** — limit 0.8% away in ADX 35.5 strong-trend violates new rule "feedback_limit_order_distance" (operator feedback 2026-04-19 17:29 UTC).

**Final execution:**
- **Entry:** 2308.1 (market, slippage от 2306 request)
- **Exit:** 2298.40 (market defensive close)
- **SL:** 2355 (not hit)
- **TP:** 2220 (not reached)
- **R:R realized:** +0.21R on 0.25% risk = +$124 gross combined
- **Duration:** 1h 30min (17:36 → 19:06)
- **Peak unrealized:** +0.40R / +$239 (C435 18:48 UTC)
- **Fills:** 50k qty 2.55; 200k qty 10.20

# ETHUSDT SHORT — 2026-04-19 — pending limit @ 2325

## Setup

**Pattern:** Retest-and-fail of broken support acting as resistance (EMA21 1H zone).
**Source:** Watchlist PRIMARY (C403 17:13 UTC) "BTC/ETH SHORT retest-and-fail of broken support 75400-75500 / 2320-2335".
**Methodology:** Classic SMC supply-zone retest per `stop-hunting-market-traps.md` + trend continuation per `momentum-trading-clenow.md`.

## 12-Factor Confluence (SHORT, score at C407 17:25 UTC)

| # | Factor | Score | Rationale |
|---|--------|-------|-----------|
| 1 | SMC/Structure | 1 | bos_15m=bearish (5/8 cross-pair), sweep context (not STRONG yet — no OB tap) |
| 2 | Classic Tech | 1 | RSI1h 32.94 (bearish below 50, ADX>25 = continuation per symmetry rule, NOT mean-rev reject), MACD hist weakening, EMA21 2332 < EMA55 2348 (bearish stack) |
| 3 | Volume | 1 | OBV slope10 −3565 (flipped negative C406→C407 from +4k) |
| 4 | Multi-TF | 1 | 4H RSI 42.7, 1H 32.9, 15M bearish BOS — stack aligned down |
| 5 | BTC Correlation | 1 | BTC eff_regime=bear, slope1h -5.94, chg1h -0.82% |
| 6 | Regime | 1 | effective_regime=bear (per C407 data); scanner-labeled Bull overridden by 1H structure (CLAUDE.md rule) |
| 7 | News | 1 | Neutral. Stale "BTC Breaks $78K" trigger (real BTC 75157, >3% away) scored neutral per CLAUDE.md rule |
| 8 | Momentum | 1 | ADX 35.5 (>25), MDI 29.3 >> PDI 12.0, slope1h −2.75 |
| 9 | Volatility | 1 | ATR healthy mid-range |
| 10 | Liq clusters | 0 | Scanner null — scored neutral 0 symmetrically |
| 11 | Funding/OI | 0 | Scanner null — scored neutral 0 symmetrically |
| 12 | Session+Time | 1 | NY quality 1.0, 395 min to next funding |

**Total: 10/12 — A-setup**
**LONG mirror: 2/12 — trivially rejected**

## Entry Thesis

- Price ETH 2308 already below EMA21 (2332) — market has dumped through support
- Watchlist prescribes "wait for bounce to 2320-2335 retest + rejection + BOS1h bearish"
- Place-limit at 2325 = EMA21 retest entry (center of zone)
- Chase-filter: ETH moved <30 pts last hour, limit waits for bounce — zero chase risk
- Lesson application: "A-setup after 400+ pt move = chase" → don't market-enter, let price come

## Cross-pair confirmation at entry (C411)

**8/8 pairs bos_15m bearish** — textbook multi-pair trend continuation. Maximum possible cross-pair confirmation for SHORT side. ETH OBV slope10 flipped −12672 (was +108k C409-C410, now decisively negative). BTC leading: slope1h −6.01, chg1h −0.84%, eff_regime bear.

## Invalidation Rules

- **Structural:** ETH 1H close **above 2355** reclaiming EMA55 → setup dead. Cancel limit OR close position.
- **Regime flip:** effective_bearish cross-pair drops below 3/8 AND BTC eff_regime flips Bull → cancel.
- **News:** risk-on bias 2+ consecutive cycles → cancel limit.
- **Age:** cancel limit after 45 min if not filled.
- **On fill — exit rules:**
  - +1R unrealized → SL to breakeven
  - +1.2R → SL to entry + 0.4R (50% peak protection)
  - +1.5R → trailing stop activates (BE+1R, 1× ATR(1H) trail)
  - Per `[2026-04-19] Lock 50% of peak R` lesson — protect dynamically
  - News risk-off 2-cycle confirmation → defensive exit (per 2-cycle rule)

## Research Citations

- `stop-hunting-market-traps.md` — retest of broken support as high-prob SHORT
- `momentum-trading-clenow.md` — ADX > 25 + DI dominant = trend continuation, RSI oversold is NOT reject signal
- `support-resistance-mastery.md` — EMA21 as dynamic supply in bear leg
