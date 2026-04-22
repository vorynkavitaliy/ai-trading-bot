---
symbol: BTCUSDT
direction: long
status: closed
opened: 2026-04-21T13:26:00Z
closed: 2026-04-21T13:33:00Z
entry: 75960
fill: 75960
sl: 75830
tp: 76500
size_usd: 365000
leverage: 10
risk_r: 0.25
confluence_score: 11
confluence_type: a_setup
regime: bull
session: ny_overlap
btc_state_at_entry: self
news_multiplier: 1.0
trade_category: reclaim-retest-limit-race-condition
thesis_snapshot: "BTC reclaimed 76000+ema21 после 3 failed attempts. bos_3m flipped bullish (first structural reversal today). CVD sustained +, OBI balanced (no spoofing). Limit 75960 pullback к ema21 support. Post-2xSL conservative 0.25%."
expected_duration: intraday
closed_reason: sl_hit
r_multiple: -1.0
pnl_usd_50k: -125
pnl_usd_200k: -500
pnl_usd_total: -625
fees_usd: -15
---

# BTCUSDT LONG — 2026-04-21 #3

## Why This Trade (at placement)

After 4 failed reclaim attempts at ema21/round 76000 today, this cycle shows structurally-different signature:
- **bos_3m FLIPPED BULLISH** — first bullish BOS of the day
- CVD5m sustained positive +\$848k (not single-minute spike signature)
- OBI balanced −0.13 (NOT extreme ±0.9 spoofing seen earlier)
- Price holding ABOVE round 76000 AND ema21 75951

Earlier failed attempts had:
- Single-minute CVD spikes (CVD1m == CVD5m)
- OBI extreme oscillation (+0.98 then −0.90 spoofing)
- bos_15m persistent bearish through all attempts
- Price только testing levels не holding

THIS time: structure actually flipped на 3m, OBI balanced, CVD persistent.

## Entry Context

- **Time placed**: 2026-04-21 13:25 UTC
- **Session**: NY+London overlap, quality 1.1
- **BTC**: 76066 (above 76000 round и 75951 ema21)
- **News**: neutral low ×1 (full sizing available)
- **HMM**: bull 98% (likely transitioning при 14:00 close given trend1h flipped к range)

## Plan at Entry

- **Limit price**: 75960 (just above ema21 75951 для clean S/R retest)
- **SL**: 75830 (below recent swing support, structural)
- **TP**: 76500 (next htf_pivot resistance)
- **R:R**: 4.15 (risk 130pt / reward 540pt)
- **Size** (conservative post-2×SL):
  - 50k: 0.961 BTC, \$125 risk (0.25%)
  - 200k: 3.846 BTC, \$500 risk (0.25%)
  - Total: \$625 risk, \$365k notional
- **Leverage**: 10×
- **Expected duration**: intraday (1-4h)
- **MaxAge**: 45 min limit window

## Exit Plan

- **Stop-loss**: 75830 HARD
- **Take-profit**: 76500
- **Trailing**: activate at +1R = 76090 → trail 1× ATR(1H)
- **Time stop**: if not filled in 45 min → cancel limit
- **Catalyst watch**: Fed Warsh hearing — if result shocks market, tighten

## Risk Considerations

- Today: 2× AVAX SL = −\$1250. Conservative 0.25% sizing appropriate.
- 4 failed reclaim attempts earlier — this is 5th; could be continuation trap.
- Fed hearing catalyst в next hour may produce violent move.
- bos_15m still NONE (3m is shorter/weaker signal).

## Research citations

- `stop-hunting-market-traps.md` — sweep+reclaim methodology
- `crypto-market-microstructure.md` — CVD persistence vs spike interpretation
- `lessons-learned [2026-04-21] CVD1m spike` — applied filter: this one может быть single-min но structure different from earlier

## Override evaluation

Ugly signals considered:
- Fifth attempt today (4 prior failures) — pattern suggests distribution
- rsi_accel still negative (F8=0)
- CVD1m = CVD5m (single-min pattern again)
- Fed hearing catalyst risk

Override NOT applied because:
- bos_3m bullish IS structural confirmation (first of day)
- OBI balanced (not spoofing like before)
- Limit entry = conservative (better fill, mental comfort)
- R:R 4.15 на limit fill >>> 1.5 threshold
- 0.25% size means max loss \$625 (DD impact +0.5% per acct, stays safe)

## Status: OPEN (race condition — limit filled before cancel processed)

## Race Condition Event (13:25-13:29)

**Timeline**:
- 13:25: Limit placed @ 75960 (price 76066 at time)
- 13:26: Price dipped к 75960 range, **limit FILLED** (unknown к me at this moment)
- 13:27: I saw CVD flip and OBI spoof, attempted `cancel-limit` с reason `invalidated`
- Cancel command executed successfully — но позиция уже была заполнена. Cancel removed the associated SL/TP orders, leaving bare position.
- 13:29: Reconcile flagged `action_required: Reconstruct BTCUSDT`. Scanner shows POS with SL=0 TP=0.

**Emergency action**: Immediately used `move-sl` к re-establish SL 75830. Server-side SL now in place.

**Position state at reconciliation (13:29)**:
- 50k: 0.961 BTC @ 75960, mark 75984, +\$23.5 unrealized
- 200k: 3.846 BTC @ 75960, mark 75990, +\$115 unrealized
- Total +\$138 (≈+0.22R)
- SL 75830 restored
- TP: not set (will manage manually)

## Lessons (critical new findings)

**1. Race condition in limit cancel**: cancel-limit on a FILLED order removes SL/TP orders (they were groupLinked) but doesn't change position state. This is dangerous — need к check position status BEFORE issuing cancel if limit might have been filled recently.

**2. bos_3m bullish WITHOUT bos_15m confirm = unreliable**. 3m timeframe flipped bullish (triggered my limit) then immediately back к none.

**3. Limit entry at ema21 retest is optimistic**: market was still in distribution, limit @ 75960 filled on exact test of support (which also got me filled into the trap zone).

## Status: CLOSED (SL hit 13:33 UTC)

## Close Summary

- SL 75830 triggered ~13:33 UTC (7 min в position)
- −1R clean −\$625 total (50k −\$125, 200k −\$500)
- **Third SL of the day** — AVAX #1, AVAX #2, BTC #3 = **−\$1875 nominal (3× −1R)**
- Actual Day P&L: −\$1066 (less than expected, likely от funding payments / small offsets)

## Immediate Takeaway

- Race condition caused accidental open я wanted к prevent. Post-cancel SL-restore saved from worse damage but position still unprofitable.
- 5th reclaim attempt at 76000 failed cleanly. Distribution pattern fully confirmed.
- Discipline intact throughout: held грace period, did not override SL, accepted full −1R.

## Process Grade: C

- Entry initiated: C (setup checks were reasonable, но race condition means I "entered" против my own cancel decision)
- Race condition handling: B (immediately restored SL, prevented bare exposure)
- Management: A (grace respected, SL honored)
- Context: F (entered при 5th failed reclaim — market clearly distributing)

## New Lesson

**Check audit BEFORE cancel-limit if price recently touched limit level**. The race window between fill и cancel can leave bare position. Will add к lessons-learned.

