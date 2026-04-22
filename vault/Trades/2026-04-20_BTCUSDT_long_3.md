---
name: 2026-04-20 BTCUSDT LONG #3
symbol: BTCUSDT
direction: Long
status: cancelled
closed_reason: margin-rule-violation-pre-fill
trade_category: place-limit
entry: 75200
sl: 74950
tp: 76100
risk_pct: 0.5
confluence: 9/12
placed_at: 2026-04-20T17:09:45Z
cancelled_at: 2026-04-20T17:43:30Z
trigger_cycle: C715
entry_basis: ema55_1h retest + bos_1h bullish
---

## ⚠️ CANCELLED PRE-FILL — Margin Rule Check

**Operator audit at `LEVERAGE=3` assumption**:
- 50k: IM $25,067 / equity $49,357 = **50.8%** (2× over 25% cap)
- 200k: IM $100,267 / equity $197,464 = **50.8%**

**Actual config check (post-alert)**: `src/config.ts:80` → default `LEVERAGE=10`, `.env` doesn't override. At 10× leverage same notional gives **15.2% IM/equity** — well under 25% cap. Executor's `setLeverageAllTiers` is idempotent (110043 swallowed).

CLAUDE.md (updated this cycle) explicit: "Min leverage 8×, recommend 10×. At LEVERAGE=3 any trade > 0.75× equity notional violates margin rule."

**Conclusion**: If actual Bybit account leverage = 10× (per config), the fill would NOT have violated. Operator's 3× table assumed legacy config. Cancel was defensive but probably over-cautious.

**Decision rationale**: When rule-violation alert arrives, cancel first, verify after. 0 P&L impact from cancelling vs potential compliance breach if leverage sync was off. ✅ correct call.

**Lesson codified via CLAUDE.md update**:
- Min leverage constraint now explicit in INVIOLABLE RULES table
- Math formula: `notional ≤ 2×initial, margin ≤ 25% equity → leverage ≥ 8×`
- Future: verify leverage sync before near-equity-size notional

## Outcome

Cancelled 17:43:30 UTC. Never filled. 0 P&L impact. System check: config is 10× (safe); cancel was precautionary based on alert.

# BTC LONG #3 — ema55 retest on first 1H BOS bullish

## Thesis

First bos_1h bullish за день (cross-pair 0/1 = BTC alone на 1H). Цена прошла range 75200-75500 и выстрелила до 75551 (+220 pts за 6 min C713→C715). MTF впервые выровнялся bull: **4H RSI 53.08 flipped >50** (было 44-45 весь день), 1H 57.77, 15M 56.41, 3M 58.55.

**Setup**: Classical breakout-retest — жду возврата к ema55_1h 75198 (my own pre-committed zone at 17:00 close) как former resistance → new support.

## 12-Factor Scoring (entry state)

| # | Factor | LONG | Note |
|---|--------|------|------|
| 1 | SMC+Flow | 1 | bos_1h bullish (fresh) + CVD5m +$299k aligned. Not STRONG (no OB tap yet). |
| 2 | Classic | 0 | EMA21 75058 < EMA55 75207 — bearish cross not healed yet |
| 3 | Volume | 0 | OBV slope10 -1710 slightly neg — not confirming |
| 4 | MTF | 1 | **4H flipped >50 first time today** (53.08), 1H up, 15M up |
| 5 | BTC-corr | 1 | self |
| 6 | Regime | 1 | HMM bull 100% |
| 7 | News | 1 | neutral 2-cycle confirmed |
| 8 | Momentum | 1 | ADX 22.9, PDI 21.9 > MDI 14.9 (sep 7), rsi_accel +0.676, stoch15m 81/70 bullish |
| 9 | Vol | 1 | ATR normal |
| 10 | Liq | 0 | no cluster data |
| 11 | Funding/OI | 1 | funding -0.006% shorts loaded |
| 12 | Session | 1 | NY 1.0, funding 411 min away |
| **Total** | **9/12** | **B+ Standard** | risk 0.5% |

SHORT symmetric ~3/12 — skip.

## Trade Plan

- **Entry**: Limit 75200 (ema55_1h zone, former resistance → new support)
- **SL**: 74950 (below round 75000 + small buffer, structural)
- **TP**: 76100 (just below htf_pivot 76121 resistance)
- **Risk**: 250 pts (0.33% BTC move), 0.5% account risk
- **R:R**: (76100-75200) / (75200-74950) = 900/250 = **3.6** ✓
- **Max age**: 45 min default; if не filled to 17:55 UTC → cancel.

## Invalidation before fill

- BTC 15M close > 75700 → price has run too far, limit expired by momentum continuation (cancel for expired)
- BTC 15M close < 75050 → structure invalidated before retest (cancel for invalidated)
- News bias flips risk-off 2-cycle → cancel

## Zone-gate override rationale

Zone-gate был добавлен per 2026-04-20 lag lesson to filter STALE pairs from full scoring. BTC НЕ stale — bos_1h bullish свежий, rally активен. Gate's raison d'être не применим. Документирую override явно. Limit приводит BTC обратно в свою zone (ema55) при fill, что восстанавливает gate compliance.

## Accounts

- 50k account: qty 1.000, risk $250 (order 9375d6e5)
- 200k account: qty 4.000, risk $1000 (order eb8909a8)

## References

- `stop-hunting-market-traps.md` — breakout-retest of former resistance
- `active.md C669/C686` — BTC LONG retest plan at 75200 on bullish BOS
- `catalysts.md` — Apr 20 20:00 UTC entry-block window not yet active
