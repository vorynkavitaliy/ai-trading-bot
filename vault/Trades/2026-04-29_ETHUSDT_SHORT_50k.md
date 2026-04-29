---
symbol: ETHUSDT
direction: short
status: closed
opened: 2026-04-29T01:09:00Z
closed_at: 2026-04-29T09:05:00Z
closed_reason: SL hit 2318 server-side
entry: 2282.59
sl: 2318
tp: 2212
exit: 2318
size_usd: 15658
leverage: 10
risk_r: 0.50
realized_r: -1.0
pnl_usd: -248.47
trade_category: operator-opened
account: 50k
regime: transition
session: asian
news_multiplier: 1.0
thesis_snapshot: Operator opened symmetric ETH SHORT on 50k account ~01:09 UTC, mirroring 200k SHORT (entry 2291 from 2026-04-28T17:41Z). ETH regime currently TRANSITION (ADX 24.9, EMA stack still bearish 8<21<55<200). Operator likely anticipating return to TREND-bear after C3922 boundary noise. Strategy itself does not signal B-SHORT now (regime gate fails — TRANSITION).
expected_duration: intraday
strategy_sl_match: true
strategy_tp_match: true
detected_via: audit C3930 (1-min-old position not yet in reconcile per-account view)
---

# ETHUSDT SHORT — operator-opened 50k account 2026-04-29

## Context

Operator added second ETH SHORT — this time on **50k sub-account** — ~01:09 UTC. The 200k SHORT (entry 2291, opened 2026-04-28T17:41Z) is still active +$223 unrealized.

Operator chose **identical SL (2318) and TP (2212)** to the 200k position, just sized for the smaller account. Position size 6.86 ETH × $2282.59 ≈ $15,658 notional. Stop distance 2318 - 2282.59 = $35.41/contract → total $ risk = $242.91 ≈ 0.5% of 50k equity ($48,643).

## Position vs current strategy state

| Параметр | Operator (50k) | 200k (carried) | Strategy state now |
|---|---|---|---|
| Entry | 2282.59 | 2291 | regime=TRANSITION, no B-SHORT signal |
| SL | 2318 | 2318 | matches B-SHORT spec from 2026-04-28 setup |
| TP | 2212 | 2212 | 3R from original 200k entry; ~3.4R from 50k entry |
| Risk | 0.50% / $243 | 0.48% / $943 | within HyroTrader 0.5% base |
| Stop distance | 1.55% | 1.18% | 50k entered closer to current price |

Combined exposure: ~$1,186 dollar-risk across two accounts on same setup. Total heat ≈ 0.48% of combined equity ($245k). Well within 3% cap.

## Strategy gates currently (for reference, NOT entry justification)

ETH C3930:
- regime=TRANSITION (ADX 24.9, between 22 and 25) — strategy SKIP
- stack=bearish (EMA8 2287.86 < EMA21 2288.64 < EMA55 2299.91 < EMA200 2325.35) ✓
- PDI 16.2 < MDI 23.2 ✓
- close 2283.11 < EMA55 2299.91 ✓ (trend-bearish position price)
- RSI 1h 44.63 (< 55) ✓
- BUT: regime gate fails — bot would not enter here.

Operator chose to enter anyway. Likely thesis: ADX about to cross 25, position taken slightly early at favorable price (price already 0.74% below EMA55, deeper than 0.5% trigger zone — i.e., catching pullback that already happened).

## Bot policy (per CLAUDE.md § Operator-opened positions)

- **DO:** Monitor cycle-by-cycle, report status, alert on adverse moves
- **DO NOT:** Auto-modify SL/TP. Apply B-abort rule (ADX<20). Open additional ETH position from bot side.
- **CAN:** Suggest via Telegram if structural concern arises (e.g., 1H bull-engulf)
- **Close authority:** operator instruction OR server-side fill OR HyroTrader hard limit

## Combined ETH exposure

Two operator-opened SHORTs sharing same SL/TP:
- 200k @ 2291 (qty 34.91)
- 50k @ 2282.59 (qty 6.86)
- Combined size 41.77 ETH, weighted avg entry ≈ 2289.62
- If TP 2212 hits: 50k makes (2282.59 - 2212) × 6.86 = $484 (gross, ~2R)
- If TP 2212 hits: 200k makes (2291 - 2212) × 34.91 = $2,758 (gross, ~3R)
- If SL 2318 hits both: 50k loses $243, 200k loses $943, combined $1,186 (~0.48% combined equity)

## Updates

- **01:09 UTC C3930** — opened on 50k, detected via audit.ts. Symmetric to 200k SHORT.
