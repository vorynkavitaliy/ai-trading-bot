---
symbol: AVAXUSDT
direction: long
status: closed
opened: 2026-04-21T12:05:00Z
closed: 2026-04-21T12:17:00Z
entry: 9.42
fill: 9.42
sl: 9.35
tp: 9.55
size_usd: 84083
leverage: 10
risk_r: 0.25
confluence_score: 9
confluence_type: standard
regime: bull
session: london
btc_state_at_entry: bull
news_multiplier: 0.5
trade_category: breakout-pullback
thesis_snapshot: "AVAX clean structural breakout (all BOS bullish + above_prior_high) + rsi_accel +1.558 strong + OBV +645k accelerating. Limit at 9.42 previous breakout level now support."
expected_duration: intraday
closed_reason: sl_hit
r_multiple: -1.0
pnl_usd_50k: -125
pnl_usd_200k: -500
pnl_usd_total: -625
fees_usd: -18
---

# AVAXUSDT LONG — 2026-04-21 #1

## Why This Trade (at placement)

AVAX показывает cleanest structural setup этого cycle. В отличие от BTC (который застрял в chop 76500-76700 без BOS trigger), AVAX имеет полное multi-TF structural confirmation.

- **Setup type:** breakout-pullback limit entry
- **Primary factor:** Clean BOS на всех TFs + rsi_accel_1h +1.558 strong momentum confirm
- **Confluence breakdown (9/12)**:
  - F1 SMC/Flow: 1 (bos_1h/15m/3m все bullish + CVD5m +$64k positive, close_vs_swing_15m=above_prior_high)
  - F2 Tech: 0 (RSI 15m 70.5 borderline overbought — не чистый bullish сигнал)
  - F3 Volume: 1 (OBV slope +645k strongly accelerating)
  - F4 Multi-TF: 1 (4H 56.5, 1H 66.2, 15m 70.5, 3m 61.9 — all aligned bullish)
  - F5 BTC Correlation: 1 (BTC bull regime)
  - F6 Regime: 1 (HMM bull 88% confident, not transitioning)
  - F7 News: 1 (neutral bias; medium impact = mult 0.5 applied к sizing)
  - F8 Momentum: 1 (ADX 21.6>20, PDI 30.1 dom, **rsi_accel_1h +1.558 strongly positive**)
  - F9 Volatility: 1 (ATR mid-range)
  - F10 Liq clusters: 0 (null)
  - F11 Funding/OI: 0 (funding +0.01%, OI +0.41% mild)
  - F12 Session: 1 (London 1.0)
- **Why limit at 9.42**: previous breakout level (prior swing high 9.423 earlier today). Now flipped к support. Entry at pullback = better R:R than chasing current 9.469.

## Entry Context

- **Time placed:** 2026-04-21 11:41 UTC
- **Session:** London (quality 1.0)
- **BTC state:** bull (HMM 88%) — BTC в range chop at 76500-76700 (decorrelated from AVAX move)
- **Regime on AVAX:** bull breakout
- **News:** 2 triggers neutral bias, medium impact (Warsh hearing + liquidation update)
- **AVAX current price at placement:** 9.469 (+0.52% от limit 9.42)

## Plan at Entry

- **Limit price:** 9.42 (previous breakout level now support)
- **SL:** 9.35 (below nearS 9.383 с buffer)
- **TP:** 9.55 (round-psych 9.50 + continuation)
- **R:R:** 1.85
- **Size:**
  - 50k: 1785.7 AVAX, $125 risk (0.25%)
  - 200k: 7142.8 AVAX, $500 risk (0.25%)
  - Total: $625 (half-reduced risk due news medium impact mult 0.5)
- **Leverage:** 10×
- **Expected duration:** intraday
- **MaxAge:** 45 min

## Exit Plan

- **Stop-loss (structural):** 9.35 — below 9.383 nearS + buffer. HARD stop.
- **Take-profit:** 9.55 — round-psych 9.50 + continuation
- **Trailing activation:** +1R = 9.49 → trail 1× ATR(1H)
- **Time stop:** 4-6h если no resolution; 48h hard max

## Research citations

- `stop-hunting-market-traps.md` — breakout-pullback pattern (price tests prior breakout level as support)
- `crypto-market-microstructure.md` — rsi_accel_1h +1.558 as leading momentum confirmation

## Override evaluation

Ugly signals considered:
- AVAX already +1.8% от 9.35 support — chase risk (mitigated by limit below current price)
- BTC в chop — correlation drag risk (but AVAX has independent structure)
- RSI 15m 70.5 borderline overbought — could see pullback к 9.42 cleanly
- stoch k<d (71<76) slight momentum decel на 15m
- Only 1/8 pairs structural breakout — low cross-market confirmation

Override NOT applied because:
- 9/12 rubric is clean и structural (all BOS confirmed)
- rsi_accel_1h +1.558 VERY strong (strongest positive reading today)
- OBV slope +645k accelerating
- Limit entry = controlled R:R, not chase
- Size ×0.5 due news = consequence manageable
- 45-min maxAge = clean exit если invalidates

## Status: CLOSED (SL hit)

## Close Summary (12:17 UTC)

- **SL 9.35 hit** ~12:17 UTC (12 min в позиции)
- **Result:** −1R clean exit, −$625 total (50k: −$125, 200k: −$500)
- **Process grade:** B — setup было valid 9/12 at placement, degraded к 8/12 by fill. Correctly held через grace period. SL discipline intact. Лимит entry избежал chase — R:R 1.85 was honest.
- **Outcome driver:** ETH-led alt cascade (CVD5m −$1.17M) перетянул AVAX к support, затем SL hit. Не thesis failure — market-wide alt weakness overwhelmed AVAX independent structure.

## Immediate Takeaway

- **Thesis was valid при placement.** Setup degraded в те 20 мин до fill (bos_1h dropped) — но grace period rules правильно защитили от premature cancel.
- **Cross-market correlation risk is real**: когда ETH теряет $1M+ CVD, все alts dump вместе. AVAX independent structure не спасла.
- **CVD bullish divergence at 9.356** (C182 cycle) was red herring — price proceeded вниз anyway. Don't overweight 5-min CVD divergence vs overwhelming alt-cluster dump.
- **Size ×0.5 от news medium (then high) impact limit damage к −0.25% equity per account.** News sizing multiplier did its job.
- **No revenge trade**: HMM bull 98% still, но alt cluster deeply red + high-impact news (×0.25) = no new entries this cycle.

## Fill details (12:05 UTC)

- **Filled at 9.42 exactly** (limit executed clean)
- 50k: 1785.7 AVAX, size ~$16821
- 200k: 7142.8 AVAX, size ~$67285
- Total size: **$84106**, total risk: $625 (0.25% aggregate)
- Initial unrealized: −0.06R ($-36 при 9.416 mark)

## Position in context

Setup degraded от 9/12 к 8/12 before fill (bos_1h lost, rsi_accel weakened от +1.17 к +0.45). Thesis borderline — но fill price 9.42 still at structural support level. Managing через standard SL 9.35 / TP 9.55 rules, grace period 9 min protects from whipsaw exit.

**Risk-managed**: SL 70pt (−0.74%) pre-committed, cannot widen. If ETH dump correlation drags AVAX к 9.35 → stopped out clean.
