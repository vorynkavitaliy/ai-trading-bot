---
symbol: BTCUSDT
direction: long
status: cancelled
trade_category: standard
closed_at: 2026-04-21T16:37:00Z
closed_reason: regime-change-range-to-breakout
r_multiple: 0
confluence: "9/12"
entry: 75654
sl: 75500
tp: 76300
risk_pct: 0.25
risk_usd_50k: 124.89
risk_usd_200k: 499.88
risk_usd_total: 624.77
qty_50k: 0.811
qty_200k: 3.246
rr_ratio: 4.19
placed_at: 2026-04-21T16:12:30Z
cycle: C275
trader: claude
operator_sanction: "2026-04-21T16:01:00Z (halt lift #2 after 4x SL day)"
order_id_50k: "bc6ca0da-7b54-4fa6-9523-fe49217f63af"
order_id_200k: "f633bdda-6932-4829-b479-f17d07501288"
---

# BTC LONG #5 — 2026-04-21

**Category**: Standard B+ setup (9/12), conservative 0.25% size post-4xSL-day.

## Setup

- Entry limit **75654** — ema55_1h retest (SMC broken-R→flipped-S).
- SL **75500** — below liq_cluster 75600 cluster + $100 buffer.
- TP **76300** — next major flipped-R level (was support, now resistance post-crash).
- R:R **4.19** (risk 154, reward 646).
- Risk **0.25% effective** (half standard 9/12 = 0.5% post-4xSL conservative).

## Trigger chain

- **C271 16:00 UTC funding settlement**: funding flipped −0.0037% → +0.0100% (+0.0133% delta = squeeze), bos_3m bullish, CVD +1.12M, RSI1h crossed 50, rsi_accel +2.0
- **C272-274**: Price rejected at ema21 flipped-R 75888 multiple times (4 tests). Pullback initiated.
- **C275 16:12**: funding window cleared, stale cache pending purged, limit placed at ema55 75654 retest.

## 12-factor LONG scoring (C271 peak) 9/12

| # | Factor | Score | Rationale |
|---|---|---|---|
| 1 | SMC+Flow | 1 | bos_3m + CVD positive, no sweep/OB for STRONG |
| 2 | Classic | 1 | RSI1h 50.9>50, EMA21>EMA55, MACD improving |
| 3 | Volume | 0 | OBV still negative (10-bar lag) |
| 4 | MTF | 1 | 4H/1H/3m >50 |
| 5 | BTC | 1 | Self |
| 6 | Regime | 1 | HMM bull |
| 7 | News | 1 | LOW impact mult 1.0, no triggers |
| 8 | Momentum | 1 | ADX/PDI>MDI/rsi_accel+/stoch k<50 all aligned |
| 9 | Vol | 1 | Normal ATR |
| 10 | Liq | 0 | No immediate magnet |
| 11 | Funding/OI | 0 | Funding flipped positive post-squeeze = против NEW long entry moment. Now flipped back negative at C273 = back to long-asymmetric (but 2-cycle rule...) |
| 12 | Session | 1 | NY+London overlap |

→ **9/12** threshold met.

## Invalidation rules

- **15m close below 75500** with CVD neg → cancel (thesis dead).
- **bos_15m bearish** + CVD sustained → cancel immediately.
- **Price runs above 75920 without pullback** → limit expires unfilled (no loss, missed = OK).
- **maxAge 45 min** (by 16:57) → auto-cancel clean.

## Research citation

- `stop-hunting-market-traps.md` — broken-resistance-flipped-support retest entry
- `demand-supply-dynamics.md` — structural zone flip
- `crypto-market-microstructure.md` — funding rate squeeze mechanics

## Context: day summary через этот трейд

- 4× −1R today (AVAX×2, BTC×2): Day P&L **−$1450 pre-entry**
- Halt lifted by operator 16:01 UTC (2nd operator override, specific sanction)
- 6 placement attempts blocked (5× funding window, 1× stale cache)
- Trade #5 is first after halt-lift + first at 0.25% post-loss-day size
- Goal: prove process-after-losses, not recover day P&L

## Updates log

- **16:12 UTC (C275)**: LIMIT placed after funding window cleared + stale cache flush. Both accounts confirmed via audit empty pre-placement, orderIds captured post-placement.
- **16:37 UTC (C283 context)**: **CANCELLED unfilled**. Thesis invalidated by regime change: range-regime deep retest к ema55 75654 no longer applies после BTC breakout через round 76000 с slope1h flipping positive. Operator feedback acknowledged — adapting to breakout regime. Replaced с LONG #6 @ 76000 break-and-retest. Zero P&L impact.

## Lesson observation

Trade plan was sound **for range-regime** (deep retest к EMA55 после failed bounces). BUT regime shifted breakout при C283 (swept round 76000 + slope1h positive). Limit at 75654 became "hope trade" для deeper pullback which didn't come.

**Candidate lesson**: limit placement должна match current regime. In breakout regime, retest levels are shallower (broken R/S) than range-regime (deep TF EMAs). Detect regime shift → adjust limit level accordingly.
