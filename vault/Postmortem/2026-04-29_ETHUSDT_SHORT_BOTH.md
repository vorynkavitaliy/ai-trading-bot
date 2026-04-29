---
date: 2026-04-29
symbol: ETHUSDT
direction: short
trade_category: operator-opened
process_grade: N/A (operator-opened, bot did not initiate)
realized_r: -1.0
pnl_usd_total: -1312.79
pnl_usd_200k: -1064.32
pnl_usd_50k: -248.47
day_equity_pct: -0.54
duration_hours: 16
---

# Postmortem — ETHUSDT SHORT (operator-opened, both legs SL hit)

## Summary

Both operator-opened ETH SHORT legs hit SL 2318 server-side at ~09:05 UTC after 16h of holding. Combined realized loss −$1312.79 (−0.54% day equity, −1.0R per position).

## Timeline

| Time (UTC) | Event |
|---|---|
| 2026-04-28 17:41 | Operator opened 200k ETH SHORT @ 2291 (after C3647 B-SHORT trigger TG alert, FOMC-blackout override) |
| 2026-04-29 01:09 | Operator added 50k ETH SHORT @ 2282.59 (mirroring 200k) |
| 2026-04-29 ~01:00 | ETH peaked DOWN at 2278 — 200k +$408, 50k about flat |
| 2026-04-29 01:18 | ETH regime FLIP TRANSITION → TREND, B-SHORT trigger active |
| 2026-04-29 01:50 | ETH regime FLIP TREND → TRANSITION, B trigger cleared. Bounce begins |
| 2026-04-29 04:06 | SOL regime FLIP RANGE → TRANSITION (cross-pair bullish lean) |
| 2026-04-29 05:46 | ETH first test of 2314 (TG alert sent — within $4 of SL) |
| 2026-04-29 06:00-09:00 | 3 hours of frozen sideways near 2308-2314 |
| 2026-04-29 ~09:05 | ETH pierced SL 2318, both positions auto-closed |
| 2026-04-29 09:06 | Bot reconcile detected divergence, marked vault closed |

## What went right (process-wise, bot side)

1. **Detected operator-opened immediately**: 50k position picked up at C3930 via audit (1 min after open), 200k via reconcile C3651. Vault files created with `trade_category: operator-opened` for both.
2. **Respected operator-opened policy**: bot never modified SL/TP, never applied abort rules (despite ADX swings in TRANSITION zone). Pure monitor mode.
3. **Hourly heartbeats kept**: 8 hour-mark TG heartbeats from 03:00 to 09:00 UTC kept operator informed.
4. **Pre-SL alert sent C4060 (05:46 UTC)**: when ETH first tested $2314, bot sent dedicated TG alert alerting operator that SL was within $4. Allowed operator window to make manual decision.
5. **Reconcile post-close worked**: detected divergence next cycle, marked closed.

## What went wrong (operator side, with bot context)

The trade itself failed because the underlying B-SHORT thesis didn't materialize:

1. **Regime context was unstable**: ETH ADX kept cycling 22-25 (TRANSITION boundary) for 8+ hours. Strict regime-gated strategy would have skipped entirely (this was the bot's read at C3647).
2. **Cross-pair context turned bullish post-entry**: by 04:00 UTC EFFECTIVE bullish=true (7/10 BOS_15m bullish), making mean-reversion against the prevailing flow.
3. **FOMC blackout override**: position taken during the formal FOMC trading restriction. Bot would have skipped per the hard-block rule. Operator chose to override based on technical setup; technicals invalidated.
4. **Symmetric SL across two accounts**: when 50k was added at 01:09 UTC, both positions had identical SL 2318. Single price spike took out both simultaneously. Diversifying SL across accounts (e.g., 50k at $2310, 200k at $2325) might have saved one of two — but at cost of complexity, and operator accepted correlated risk.

## Strategy.md vs operator decision

The B-SHORT trigger at C3647 (2026-04-28T17:41) was technically valid per strategy.md (ADX 33.7, EMA stack aligned bearish, EMA55 touch, RSI < 55, MDI > PDI). But:
- Under FOMC blackout: bot correctly applied hard-block (no entries 30 min before/after high-impact news)
- Operator overrode the hard-block to take the technical setup

The setup was correct in form but wrong in context. FOMC volatility produced the bounce that killed both positions.

## Lessons

1. **The FOMC hard-block earned its pay today.** Skipping during news windows costs missed opportunities sometimes; today it would have saved $1313. New lesson reinforces existing rule rather than changing anything. Already in lessons-learned 2026-04-25 (operator override pattern).
2. **Symmetric SL on correlated positions = single-point failure.** When operator adds a second leg (50k mirror of 200k), both exit on the same tick. Worth noting for future correlated-add patterns; not a bot rule change.
3. **Operator-opened policy worked.** Bot did exactly what was specified: monitor, alert, no SL modification, no abort. Position resolved naturally. Postmortem documents it; no abort or override logic needed.

## Bot grade

**N/A — operator-opened.** Bot did not initiate, did not modify, did not exit. Pure monitoring + alerting. Process compliance: clean.

## Capital trajectory

| Account | Pre-trade | Post-trade | Day Δ | Cumulative DD |
|---|---|---|---|---|
| 50k | $48,653 | $48,404 | −$248 (−0.51%) | 2.86% → ~3.20% from initial peak |
| 200k | $196,325 | $195,261 | −$1064 (−0.54%) | 1.95% → ~2.37% from initial peak |
| Total | $244,978 | $243,665 | −$1313 (−0.54%) | well within 4% daily / 8% total limits |

## Forward state

- Both ETH positions closed, vault files marked closed with realized_r −1.0
- Bot resumes normal scan/skip cadence per /loop 5m
- ETH still in TRANSITION (ADX 23.2 post-pierce). Pair is "1 SL today" — under strategy 2-SL/day disable rule, ETH still allowed (has 1 SL not 2). Bot can scan/enter ETH if next valid trigger appears.
- FOMC ~9 hours away (18:00 UTC) — bot continues to monitor; entries blocked 17:30-19:30.
- Overnight session quiet: no expectation of new triggers before NY open.
