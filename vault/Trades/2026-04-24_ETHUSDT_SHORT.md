---
date: 2026-04-24
symbol: ETHUSDT
direction: Short
playbook: B
regime: TREND
entry_time: "2026-04-24T00:11:40Z"
entry_price: 2330.27
sl: 2358
tp1: 2251
qty_50k: 9.37
qty_200k: 37.48
risk_usd_50k: 250
risk_usd_200k: 1000
risk_pct: 0.5
leverage: 10
scanner_cycle: 1733
status: closed
trade_category: strategy
closed_at: "2026-04-24T16:03:40Z"
closed_reason: strategy-B-abort-ADX-below-20
exit_price_50k: 2320
exit_price_200k: 2320
realized_r_50k: 0.37
realized_r_200k: 0.37
pnl_usd_50k: 70.89
pnl_usd_200k: 284.75
pnl_usd_combined: 355.64
pnl_pct_day: 0.14
hold_minutes: 972
orderIds:
  50k: 8b2593b1-f91a-4969-95a2-092bd3dc187e
  200k: dfc7892f-01e0-4092-b5ba-faa2bcae2db1
close_orderIds:
  50k: 4a4860f0-74fe-4f42-b94e-e7b4a5e78aec
  200k: c394bde0-695d-4f94-abac-1db757f88bd0
---

# ETH B-SHORT — 2026-04-24 00:11 UTC (C1733)

## Setup

**Playbook B — Trend Pullback SHORT**. Первая сделка за 2 дня. Setup жил 2h 10min подряд в Dead zone + funding window, strategy v2 hard-blocks не позволяли войти до 00:10 UTC.

### Technical conditions at entry (00:11 UTC C1733)

| Condition | Value | Required | Status |
|---|---|---|---|
| Regime | TREND | TREND (ADX≥25) | ✓ |
| ADX(1H) | 31.3 | ≥25 | ✓ |
| EMA stack | 2325.37 < 2331.71 < 2340.75 < 2343.77 | Inverted (8<21<55<200) | ✓ |
| DMI | MDI 24.8 > PDI 16.4 | MDI>PDI for SHORT | ✓ |
| Price vs EMA55 | 2331.32 vs 2340.75 (−0.40%) | ±0.5% window | ✓ |
| Close vs EMA55 | 2331 < 2341 | Close < EMA55 (rejection) | ✓ |
| RSI(1H) | 48.06 | <55 for SHORT | ✓ |
| Pair | ETHUSDT | not SOL (B-enabled) | ✓ |

### Blocks check

| Block | Status |
|---|---|
| Funding window ±10 min 00:00 | **Just cleared** (expired 00:10) |
| Dead zone 22:00–00:00 UTC | **Cleared** (ended 00:00) |
| Day equity ≤ −2.5% | 0% ✓ |
| Pair 2 SL today | 0 SL ✓ |
| Total positions = 4 | 0 positions ✓ |
| Total heat ≥ 3% | 0% ✓ |

## Execution

- **Entry (limit filled immediately):** 2330.27 (improvement −1.05pt от 2331.32 scanner reference)
- **SL (server-side):** 2358 (+27.73pt = 1.19% above entry). Per strategy: max(swing_high_last_10, EMA55) + 1×ATR = 2340.75 + 17.13 = 2357.88, rounded to 2358.
- **TP1 (server-side):** 2251 (−79.27pt = 3R exactly). Close 50% at TP1.
- **Trail:** Chandelier 2.5×ATR after TP1 hits (manual).

## Position Sizing

| Account | Equity | Risk $ | Qty | Notional | Margin (10×) | Margin % |
|---|---|---|---|---|---|---|
| 50k | $49,415.47 | $250 (0.51%) | 9.37 | $21,832 | $2,183 | 4.42% |
| 200k | $197,809.23 | $1,000 (0.51%) | 37.48 | $87,315 | $8,732 | 4.41% |

HyroTrader compliance: margin % < 25% ✓, notional < 2× initial (50k<100k, 200k<400k) ✓, leverage 10× (≥8 min) ✓, server-side SL set within seconds ✓.

## Orderbook context at entry

- **OBI5:** +0.9981 EXTREME BID ($270k bid vs $256 ask = 1054× ratio) — institutional accumulator или spoofing на 2327-2330
- **CVD1m:** +$73k mild buy
- **CVD5m:** +$73k mild buy (was −$130k earlier C1732)
- **Stoch15m:** 66 (recovering от 46 cycling)

**Risk:** extreme bid defence might hold price → bounce risk. SL at 2358 is 27pt above entry — defenders need 27pt push up to stop us. Trust setup, accept defender risk.

## Market context

- **BTC:** 78263 RANGE (ADX 20.8), mid-zone. Slight bullish correlation risk.
- **SOL:** 86.11 TRANSITION, minor bullish drift.
- **BNB/OP/NEAR/SUI:** RANGE, no triggers.
- **AVAX:** TRANSITION, BOS 15m+3m bullish — strongest upside momentum.
- **News:** neutral low impact.
- **Session:** Asian, quality 0.85.
- **Funding ETH:** −0.0106% (short favored slightly via rebate).

## Abort conditions (strategy.md)

- `ADX<20` до TP1 → exit market
- EMA8 cross above EMA21 → exit
- 1H close above EMA200 (2343.77) → exit
- SL hit at 2358

## Thesis

ETH trending down since 17:00 breakdown. EMA55 acts as resistance after daily drawdown 2381→2283. Price has retested EMA55 from below multiple times over 2+ hours, each time rejected. Current setup = clean textbook B-SHORT pullback rejection. If stack breaks or ADX dies → abort. If 3R achieved → trail Chandelier, let trend run.
