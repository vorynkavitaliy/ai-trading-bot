---
symbol: BTCUSDT
direction: long
status: open
opened: 2026-04-22T08:13:00Z
entry: 78120
sl: 77880
tp: 78500
size_usd: 406
leverage: 10
risk_r: 0.5
confluence_score: 10
confluence_type: a-setup
regime: bull-continuation
session: london
btc_state_at_entry: bull-breakout-structural-confirmed
news_multiplier: 0.5
trade_category: structural-breakout-post-funding
thesis_snapshot: "A-setup 10/12 с полной structural confirmation. BOS 15m bullish confirmed C495 после весь day без BOS (post 1H BOS loss at 08:00). CVD5m sustained positive 2 cycles (+572k C494 → +521k C495). Funding window cleared 08:10. Price breakout с short squeeze dynamics (OBI bid $870k earlier cycle). Setup specifically pre-defined в C494 override as LONG unlock condition. Lesson 2026-04-22 applied — wider 240pt SL vs failed 157pt C472."
expected_duration: intraday
---

# BTCUSDT LONG — 2026-04-22 (Trade #3)

## Why This Trade (at entry)

**Setup type**: structural breakout continuation post-funding

**Primary factor**: 15m BOS bullish CONFIRMED (critical structural signal absent весь предыдущий day)—combined с 2-cycle CVD sustained positive (+$572k C494 → +$521k C495) and funding block cleared (08:10).

**Key distinction from C472 trade #2 failure:**
- **C472**: BOS 1h bullish only, 15m BOS none, CVD 1-cycle burst (transient), **SL 157pt too tight** = wick trap, -1R
- **C495 NOW**: BOS 15m bullish CONFIRMED, CVD 2-cycle sustained (not transient), **SL 240pt wider** (lesson applied), funding cleared (not edge-timing)

**Confluence breakdown @ 78120:**
1. **SMC/Structure + Flow = 1**: BOS 15m bullish confirmed (cross_pair 1/1 [BTCUSDT]) + CVD5m +\$521k sustained 2-cycle positive. Не STRONG=2 — нет sweep+reclaim clean pattern; это breakout continuation.
2. **Classic Technical = 1**: RSI 73.04 extended но MACD +208.5 strong positive, EMA21>EMA55 bullish alignment.
3. **Volume = 1**: OBV slope10 +23502 rising (near session peak +24339).
4. **Multi-TF = 1**: 4h 65.06 / 1h 73.04 / 15m 68.09 / 3m 62.22 — все TFs bullish aligned.
5. **BTC Correlation = 1**: self.
6. **Regime = 1**: bull confirmed — MACD +208, ADX 27.7, EMAs stacked, PDI 35.4 >> MDI 12.3.
7. **News = 1**: bias neutral mult 0.5 medium impact (2 triggers: Iran bullish + Kelp hack neutral).
8. **Momentum = 0**: strict rubric — ADX 27 + PDI dominant ✅ но sub-condition failed (rsi_accel neg, stoch k>50). Substantive momentum is strong, strict score = 0.
9. **Volatility = 1**: ATR healthy, не extreme.
10. **Liq clusters = 1**: **liq_cluster 78500 immediate magnet** (0.48% above entry) = primary TP target.
11. **Funding/OI = 0**: funding +0.0019% positive (crowded long), OI Δ1h −0.18% still slight neg.
12. **Session+Time = 1**: London quality 1.0, funding window CLEARED (near_funding=false), away from next funding 08:00 тoday already passed.

**Total LONG = 10/12 — A-setup**, risk 0.5% (A-setup nominal 0.75% не влезает в 2× notional cap при 240pt SL; 0.5% fits).

**Why this R:R**:
- Entry 78120 (market — breakout confirmed per entry-rules для ADX>25 + dominant DI)
- SL 77880 = ниже nearS 77976 + ATR buffer ~96pt = **240pt risk** (lesson applied — wider than C472's failed 157pt)
- TP 78500 = liq_cluster magnet (stops above 78000 round psych)
- R:R = (78500-78120)/(78120-77880) = 380/240 = **1.58** (minimum 1.5 met)
- Trail potential к 79000 round on momentum continuation

## Entry Context

- **Time**: 2026-04-22 08:13 UTC (Cycle C495, post-funding block clearance)
- **Price at entry**: 78120 (market)
- **Session**: London (quality 1.0)
- **BTC broader state**: post-funding short squeeze after chaotic 08:00 period; bull continuation resumed
- **Macro**: news bias neutral, Iran ceasefire extension bullish undertone, Kelp hack neutral-to-negative
- **DD state**: daily 0.38%/0.37%, total 1.57%/1.55% — comfortable
- **Funding**: 7.8h до next 16:00 funding — well outside block window

## Key zones active
- Support: 77976 (nearS, SL protection via 77880), 77500 round, 77000 round, 76810 EMA21_1h
- Resistance: **78142 nearR (immediate new swing high)**, **78500 liq_cluster (TP target)**, 79000 next round
- Invalidation: 15m close < 77880 OR 1H close < 77000 с CVD neg → bull structure broken

## Risk Position
- 50k account: **1.041 BTC**, risk **\$249.84 (0.5%)**, orderId `d3574104-69bb-4b01-8be3-df53adde48b9`
- 200k account: **4.166 BTC**, risk **\$999.84 (0.5%)**, orderId `13b7b7ab-8e65-4070-a47b-82d1f1ff4f55`
- Total notional: 50k \$81k (1.6× initial, within 2× cap) + 200k \$325k (1.6× initial, within cap)
- Margin: 50k ~\$8.1k (16.5% equity), 200k ~\$32.5k (16.5%) — well within 25% cap

## Management Plan
- Hold для TP1 78500 liq_cluster
- Move SL к BE (78120) at **+1R = 78360** (mark reaches)
- Trail 1×ATR(1H) after +1.5R (78480)
- Exit proactively if:
  - 15m close < 77880 (SL trigger) — server-side executes
  - 1H close < 77900 с CVD sustained neg — structural breakdown, manual close consideration
  - SHORT opposite 10/12 with BOS 15m bearish + rejection — proactive exit
- If TP1 78500 hit + momentum continuing + 1H close > 78500 с CVD+ → consider trail к 79000
- **Nearest risk event**: Apr 28 USTR + FOMC day 1 (6 days away, not immediate)

## Cite
- `stop-hunting-market-traps.md` — breakout после failed fake breakout (C472/C487 patterns) = continuation signal when structural confirm
- `momentum-trading-clenow.md` — ADX 27+ PDI dominant = trend confirmation
- `crypto-market-microstructure.md` — CVD sustained 2-cycle = trending flow not noise
- Lesson 2026-04-22: Structural SL requires ATR-buffer beneath, не AT level — applied 240pt vs 157pt C472

## Overrides history this session (documented)

This entry vs prior 4 overrides:

| Cycle | LONG score | Took? | Reason |
|---|---|---|---|
| C478 | 10/12 formally | Override SKIP | Post-flush weakness: CVD weak, bid-wall gone, OI unwinding |
| C480 | 10/12 formally | Override SKIP | OBI −0.97 hostile ask-wall $669k, CVD divergence |
| C486 | 10/12 formally | Override SKIP | Funding block в 4 мин, tight timing |
| C494 | 9/12 formally | Override SKIP | F1=0, R:R cramped 1.43, near resistance chase |
| **C495** | **10/12** | **TAKE** | **F1=1 BOS 15m confirmed, funding cleared, wider SL applied** |

The specifically-defined unlock condition ("BOS 15m + 2-cycle CVD") materialized. Trade executed на proper structural basis с lessons applied.

---

## Updates

### [08:13 UTC] — Entry
Executed LONG @ 78120. SL 77880, TP 78500. Risk 0.5% (effective ~0.25% с news mult 0.5). BOS 15m bull + CVD 2-cycle sustained + funding cleared + lesson-based wider SL.
