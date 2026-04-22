---
trade: 2026-04-21_BTCUSDT_long_3
date_closed: 2026-04-21
outcome: -1R
pnl_usd: -625
process_grade: C
---

# Postmortem — BTCUSDT LONG #3 2026-04-21 (Race Condition)

## TL;DR
- Placed limit 75960 @ 13:25, cancelled @ 13:27 due к structural invalidation
- Race: limit filled BEFORE my cancel, SL/TP removed by cancel, bare position
- Emergency SL-restore 13:27, SL 75830 hit 13:33 = −1R −\$625
- **3rd SL of day. Total loss: −\$1875 across 3 trades (2 AVAX + 1 BTC)**
- Actual Day P&L: −\$1066 (some offset от funding/fees)

## Timeline

- 13:25: placed limit 75960, price 76066 (76pt above)
- 13:26: price dipped к 75960, limit filled (unaware)
- 13:27: saw CVD/OBI flip, issued cancel-limit "invalidated"
- 13:27: cancel removed SL/TP group orders, leaving bare position
- 13:29: reconcile flagged divergence, emergency move-sl к 75830
- 13:31: position −0.72R at worst
- 13:33: SL 75830 triggered

## Root Cause

**Two compounding issues**:

1. **5th failed reclaim setup**: Market was clearly в distribution. 4 prior reclaim attempts failed identically. I was too eager к take the "this one looks different" signal (bos_3m bullish). bos_3m bullish alone, WITHOUT bos_15m confirmation, is weak structure.

2. **Race condition**: Cancel-limit on FILLED order didn't restore position к pre-fill state. It removed SL/TP orders (group-linked). Left position exposed. 5-min emergency SL-restore prevented worse outcome.

## Lessons Learned

**NEW LESSON (critical)**: *Before issuing cancel-limit, check audit для position state. If limit PRICE was near current market in last 60 seconds, assume it might have filled.*

Operational rule:
```
Before cancel-limit:
1. Run audit.ts к check position
2. If position exists → use close/manage appropriate orders separately
3. Only use cancel-limit on truly pending (not-filled) state
```

**REINFORCED**: *bos_3m bullish WITHOUT bos_15m = fragile*. 3m structure can flip within 1-2 candles. Treat as early signal, not trigger. Require bos_15m bullish для F1=1.

**META**: After N failed attempts at same level, skepticism should grow. 5 failed reclaims на same level today = screaming "don't chase it". I ignored that context bias — "5th time is the charm" is gambler's fallacy.

## What Should Have Happened

1. Not enter at all — pattern of failed reclaims should have вышло к higher threshold (12/12 required after 3+ failures, а не 11/12)
2. If entered, use market (not limit) к avoid race condition, или use wider invalidation window
3. After 2× SL same day, reduce entry rate — let market prove itself for MULTIPLE cycles before taking risk

## Process Grade: C

- Identification: C (setup was technically 11/12, но context ignored — distribution pattern)
- Execution: C+ (limit placement reasonable, but race condition shows edge case)
- Race response: B+ (immediate SL-restore, prevented escalation)
- Management: A (grace respected, SL honored, no override)
- Learning: A (comprehensive write-up, multiple generalizable lessons)

## Next Steps

1. Append lesson "Race condition на cancel-limit" к lessons-learned.md
2. **NO MORE TRADES TODAY** — 3 SLs, −\$1066 net. Rest of day = flat.
3. End-of-day review at 00:00 UTC should include pattern of 5 failed reclaims as single-day behavioral lesson
4. Consider "after 3+ consecutive losses, halt trading till next UTC day" rule
