---
symbol: BTCUSDT
direction: long
status: closed
trade_category: standard
filled_at: 2026-04-21T14:45:00Z
closed_at: 2026-04-21T14:57:00Z
closed_reason: sl_hit
r_multiple: -1.0
realized_pnl_usd: -384
hold_duration_min: 12
confluence: "10/12"
confluence_strict: "9/12 (F1=0 per C226 strict)"
entry: 76300
sl: 76020
tp: 77000
risk_pct: 0.125
risk_usd_50k: 62.44
risk_usd_200k: 249.76
risk_usd_total: 312.20
qty_50k: 0.223
qty_200k: 0.892
rr_ratio: 2.50
opened_at: 2026-04-21T14:43:00Z
cycle: C245
trader: claude
news_mult_applied: 0.25
effective_risk_after_mult: 0.125
order_id_50k: "07941d1b-0ace-47a5-afca-3b3b44398631"
order_id_200k: "92a3faac-6470-4a1e-823a-11766692216d"
---

# BTC LONG #4 — 2026-04-21

**Category**: Standard B+ setup (10/12 with F1=1 moderate, 9/12 with F1=0 strict per C226).

## Setup

- Entry limit **76300** — retest of broken htf_pivot 76300 (flipped resistance → support after C244 sweep).
- SL **76020** — below ema21 75977 + round 76000 cluster + $20 buffer. Structural invalidation зона.
- TP **77000** — next psychological round. Clear upside target.
- R:R **2.50** (risk 280 pts, reward 700 pts).
- Risk **0.125% effective** (0.5% B+ × 0.25 HIGH-impact news mult).

## Trigger chain (C241-C245)

1. **C241-242**: Distribution chop 76000-76200, CVD flipping ±$1M every 3m.
2. **C243**: Breakout impulse +$125 к 76248. First sustained bullish CVD +$767k. Rubric 7/12 — sub-threshold, HELD.
3. **C244**: Sweep of htf_pivot 76300 (0b ago). CVD grew к +$2.38M. OBI bid-loaded. Rubric 8-9/12 borderline — HELD (C226 lesson bos_3m alone).
4. **C245 (entry)**: Sweep of htf_pivot 76500 (0b ago). CVD +$3.56M (3rd cycle growing). **OBV slope10 flipped +905 positive (1st time today)**. **News bias neutral 2nd cycle** (2-cycle rule satisfied per 2026-04-17 lesson). MACD1h hist recovered от −49 к −8.7. ADX 25.1 PDI 26.9 dominant strengthening.

## 12-factor LONG scoring (10/12 moderate, 9/12 strict)

| # | Factor | Score | Rationale |
|---|---|---|---|
| 1 | SMC + Flow | 1 (strict: 0) | bos_3m sustained 3 cycles + CVD growing + 2 zone breaks = confirmed. C226 strict says bos_15m needed (still none). |
| 2 | Classic Tech | 1 | RSI1h 58 > 55, EMA21 > EMA55, MACD hist recovering к zero |
| 3 | Volume | 1 | OBV slope10 **+905 POSITIVE** (first today). CVD volume spike green confirms |
| 4 | Multi-TF | 1 | Все TF bull-aligned: 4H 58.6, 1H 58.2, 15m 57.7, 3m 69.7 |
| 5 | BTC Corr | 1 | Self-ref |
| 6 | Regime | 1 | HMM bull 99% |
| 7 | News | 1 | Bias **neutral 2nd consecutive cycle** — 2-cycle rule satisfied |
| 8 | Momentum | 0 | ADX ✓ PDI>MDI ✓ but rsi_accel_1h −1.82 negative, stoch15m k=75>50 fails AND condition |
| 9 | Volatility | 1 | ATR healthy mid-range |
| 10 | Liq clusters | 0 | No specific magnet above |
| 11 | Funding/OI | 1 | Funding −0.0024% shorts loaded, OI +1.03% rising с ценой up = accumulation |
| 12 | Session+Time | 1 | NY+London overlap ×1.1, 78 min к funding |

## Invalidation

- **15m close below 76150** with CVD5m negative → breakout failed, **cancel limit** (reason: invalidated).
- **bos_15m bearish** firing с confirming CVD → cancel immediately.
- **Catastrophic news** (Iran war headline, Fed hawkish surprise) → cancel immediately.

## Grace period

- **maxAge**: 45 min (default executor). Cancel clean if no fill by 15:28 UTC.
- **Re-evaluation cadence**: wait for 15m close minimum (per C226 lesson) unless catastrophic trigger. No cancel on single 3m CVD flip.

## Research citation

- `stop-hunting-market-traps.md` — broken-resistance-flipped-support retest entry (SMC)
- `demand-supply-dynamics.md` — structural pivot cascade (76300, 76500 sequential breaks)
- `trading-in-the-zone.md` — process-over-outcome, post-loss discipline

## Post-3×-SL context

Today's day: 3× −1R already (AVAX #1, AVAX #2, BTC #3). Day P&L −$1066. Halt lifted by operator 14:35 UTC. This is **first trade post-halt, first trade post-losses**. Conservative sizing (0.125%) intentional — prove process not recover losses. Sample of edge distribution, not bet on outcome.

## Updates log

- **14:43 UTC**: Initial pending LIMIT placed. First attempt mis-sized at 0.5% (news mult not auto-applied), cancelled clean (no fill, no race), replaced at correct 0.125%.
- **14:45 UTC (C246)**: LIMIT FILLED. Price dipped от 76430 к 76265 — retest of 76300 level triggered fill. CVD5m flipped −\$4.15M during dip ($7.7M shift от +\$3.56M). Grace period active. Unrealized −0.12R. SL/TP both server-side confirmed active via audit.
- **14:48 UTC (C247)**: Drawdown deepened к **−0.46R** (−\$144 total). BTC dropped к 76146 — **exactly на htf_pivot 76150 structural support** (0.005% away). CVD recovered к −\$1.61M от trough. OBV slope10 +1959 still positive (buyers accumulating). Opposite SHORT score ~2/12 far below 8/12. Grace period still active. HOLD — SL 76020 structural invalidation. 15m close is critical decision point.
- **14:51 UTC (C248)**: Stable at −0.46R, BTC 76144 — **holding 76150 support to the dollar**. **CVD flipped back к +\$230k positive** (+\$1.8M recovery от C247). OBI normalized к −0.07 neutral (was −0.64 ask-heavy). OBV slope10 +2089 growing. Textbook retest absorption pattern. HOLD, watching 15:00 UTC 15m close.
- **14:54 UTC (C249)**: −0.58/−0.59R (−\$182 total). BTC 76134 slipping \$16 below 76150. Mixed signals: CVD5m flipped back к −\$2.19M (noise), MACD deteriorating. BUT **OBV slope +2280 grew further** (strongest reading today), **OBI flipped к +0.60 bid-heavy** (\$300k / \$75k). Structural buyers persistent despite 3m aggressor selling. SHORT opposite still ~2-3/12. HOLD — 15:00 UTC 15m close in ~6 min.
- **14:57 UTC (C250) — 🔴 SL HIT**. BTC collapsed 76134 → 75760 (−374 pts, −0.5%) in 3 min candle. Blew through 76150 structural, through 76020 SL without pause. OBV slope10 flipped к **−7940** (от +2280 = +10k delta collapse). Position closed at 76020. Realized **−1R / −\$384** total (−\$86 + −\$298). Day P&L now **−\$1450** (4th SL today).

## Close Summary

- Entry 76300, SL 76020 hit = 280-pt risk, −1R clean execution server-side
- Hold duration: 12 min from fill к stop
- Max unrealized DD before close: −0.59R (C249)
- SL held structural: below ema21 + round 76000 + buffer. No widen, no interfere.

## Immediate Takeaway

**This was the 7th failed reclaim pattern confirmed.** Distribution thesis that dominated entire day (6 failed reclaims by C246) played out in real-time: buyers pushed к 76500 → sellers absorbed → flip к aggressive selling → blew through ALL support levels in single 3m candle.

Process was clean: rubric-gated entry, structural SL, correct sizing (0.125%), textbook limit-retest structure. Outcome was −1R. Sample from distribution, not process failure.

**Candidate lesson**: When N failed reclaims observed earlier same session, size DOWN further or skip entirely even on apparently strong confluence. Count "failed reclaims" as explicit filter field. Today 6 failures preceded this — should have added "≥5 failed reclaims today" as cap factor.
