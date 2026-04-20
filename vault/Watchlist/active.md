---
name: Active Watchlist
description: Specific setups I am hunting. Triggered or invalidated setups are removed.
updated: 2026-04-20T13:00:00Z
---

## Cycle 686 (13:52 UTC) — BTC BROKE 75000, ETH LONG closed proactive, flat

**Context**: BTC третий тест 75000 FAILED (74968), eff_regime bull→range, slope3 crashed к -1.19. ETH LONG closed at ~2302.5 for -0.77R (~-$482). Day P&L -$305 (-0.12%).

**Current setups**: none active. Structure bearish tilt but не confirmed trend (bos_1h=none on all 8 pairs still). News MEDIUM with new collapse trigger.

**Watchlist for NY session**:
- **No LONGs** until BTC reclaims 75200+ with bullish BOS confirmation
- **SHORT setups tentative** — need BTC bos_1h bearish + cross-pair 4+/8 confirmation. Currently only 3m bearish visible.
- Wait for structure к develop — don't force trades в post-break chop

---

## Cycle 669 (13:00 UTC) — NY+London overlap START, BTC regime flipped BULL

**Context**: Post BTC LONG #2 TP 75500 (+$448), price retraced к 75253. Session transitioned London → NY+London overlap (quality 1.0 → 1.1). BTC eff_regime scanner-flipped range → **bull** (slope3 +4.18, slope1h +1.39, chg1h +0.68%). All 8 pairs bos_1h/15m/3m=none — momentum без SMC structural confirmation yet.

### ACTIVE WATCH: BTC LONG (cluster-confirm trigger)

**Scoring now**: 8/12 (SMC=0 блокирует). Need BOS structural trigger.

**Trigger conditions (ANY)**:
1. **bos_3m bullish cluster** (3+ pairs simultaneously) — как было при BTC LONG #2 entry C652
2. **bos_15m bullish** на BTC (самостоятельно достаточный signal)
3. **BTC sweep+reclaim 75400-75500** — re-break of TP zone with volume
4. **ETH 4H RSI cross >50** (currently 48.15) + ETH bos_1h bullish — альтернативный путь через ETH leadership

**Entry plan (if trigger fires)**:
- Place-limit retest (не market chase) — 75200 если BTC above 75300, иначе 75250
- SL: under 75050 structural + 0.4×ATR (~75000)
- TP: 75500 first (prior TP level + 447 from Trade #2 validated), extend с trail above
- R:R ≥ 1.5 required
- Risk: 0.5% (B+ 9/12) × news mult 0.25 (HIGH impact) = **0.125% final**

**Invalidation**: BTC 15m close < 75050 (below recent 15m swing) AND bos_3m reverts bearish. OR news impact drops к MEDIUM and bias к risk-off 2-cycle.

### ACTIVE WATCH: ETH LONG (MTF completion)

**Scoring now**: 7/12. Blockers: SMC=0, MTF=0 (4H RSI 48.15).

**Trigger conditions (ALL)**:
1. ETH 4H RSI closes > 50 (currently 48.15 — within 2 pts)
2. ETH 1H BOS bullish (currently none)
3. ETH price > 2320 (current 2318)

**Entry plan (if trigger fires)**:
- Place-limit 2310-2312 (pullback to prior nearR → S)
- SL 2296 (under EMA21 2300 - 0.4×ATR buffer)
- TP 2340 (structural prior high), extend с trail
- R:R ~1.5+ target

---

## Cycle 601 (09:31 UTC) — all overnight SHORT cluster INVALIDATED

BTC bounced 74661 → **74980** (+319 pts) между C591 и C601. bos_1h bull reclaimed на 3 парах (BTC+ETH+BNB). Все SHORT invalidation levels breached:
- BTC > 74700 ✅ breached (was trigger for bear thesis intact)
- BNB > 621.5 ✅ breached (now 625.5)
- XRP > 1.414 ✅ breached (now 1.4161)
- ETH > 2283 ✅ breached (now 2304)

**Removed this cycle**:
- BNB/XRP London-open SHORT re-trigger — 1H close reclaimed EMA21 area.
- BTC SHORT bounce-fail at EMA21 retest — BTC 74980 *is* the EMA retest зона but bos_1h now bullish, not bearish. Setup thesis flipped.
- ETH SHORT re-trigger — ETH at 2304 (above nearR 2306 needed re-break < 2268; impossible short-term).

**No active short-priority setups**. Market is neutral/range — wait for fresh structure.

## ✅ TRIGGERED C607 09:48 UTC — BTC LONG place-limit 75100 executed

Limit placed after regime flip к bull at C607. See `Trades/2026-04-20_BTCUSDT_long.md`. 9/12 news-override, R:R 2.0, risk 0.25%.

~~## C605 (09:42 UTC) — BTC LONG breakout-retest setup forming~~

**Context**: BTC bouncing 74660 → 75145 за 15 min. 4H RSI crossed 50 (+supportive). bos_3m bullish now on BTC+ETH+BNB+SOL+LINK (5 pairs). MACD1h hist +105 and growing. slope3 +6.28 accelerating. Pure rubric BTC LONG = 9/12 with news-neutral override (Aave trigger stale).

**Why WAIT, not enter now**:
- BTC 75145 = AT nearR 75161 (not broken). Market entry = chase-into-resistance.
- R:R constrained: market 75145 SL 74750 TP 75500 → 0.9 R:R. Below 1.5R min.
- News doctrine still formally risk-off (needs flip OR compelling override).

**Trigger к enter LONG (next cycle)**:
1. BTC 15M close > 75200 (clean break of 75161 R), AND
2. Pullback retest 75161-75180 (former R → S), AND
3. News bias к neutral OR stale-override validated (BTC +0.5%+ in last 15m while news-classifier still risk-off)

**Entry plan BTC LONG**:
- Place-limit entry 75165 (retest zone)
- SL 74750 (below EMA21 74791 + buffer)
- TP 75500 (prior range support → resistance) / 75700 extended
- R:R (75500-75165)/(75165-74750) = 335/415 = **0.81 insufficient**. Need TP 75700: 535/415 = **1.29**. Need TP 76000: 835/415 = **2.01** ✅
- Risk 0.5% (B+ 9/12) × news mult 0.5 if risk-off persists = **0.25% final**

**Invalidation**: BTC 1H close < 74700 (below EMA21 clean break). OR news flips neutral → risk-off HIGH.

**Session**: London quality 1.0, funding 378 min away — clean.

---

# Active Watchlist

> Setups I am waiting for. Each has a trigger condition and an invalidation. When a setup either triggers or invalidates, I remove it from this list.

---

## Active Setups

### Watch: **BTC/ETH SHORT retest-and-fail** of broken support (75400-75500 zone) — PRIMARY TODAY

**Status (C403 17:13 UTC):** BTC dumped 75590→75067 (-523 pts, -0.7% в 15 min, C396→C401). Bouncing now +163 к 75230. **Scenario:** classic retest of broken support (prior range 75500-75650) as resistance.

**Scoring currently (ETH SHORT):** 7/12. BOS1h=none блокирует SMC=1. News neutral, Mom strong (ADX 35, -DI 30), Multi-TF aligned, BTC trend1h=down.

**Trigger SHORT:**
1. Price bounces to **75400-75500 zone** (BTC) или **2320-2335 EMA21** (ETH), AND
2. 15M/1H rejection wick with volume at retest, AND
3. BOS1h flips bearish (scanner confirms), AND
4. OBV slope flips negative OR loses residual positive divergence.

**Entry zone BTC:** 75400-75500 (place-limit preferred over market).
**SL:** 75750 (above EMA55 + 0.4×ATR).
**TP:** 74500 (psychological), 74000 (next liquidity), 73500. R:R 2-3.5.
**Risk:** 0.5% (B+ standard), news mult 0.5 → 0.25% applied = **0.25% final**.

**Entry zone ETH:** 2320-2335 (EMA21 retest area). **✅ CLOSED DEFENSIVELY C441 19:06 UTC @ 2298.40** — realized **+$66.59 net / +0.11R** (gross ~+0.21R). Peak +0.40R / +$239 at C435 gave back 48%. Closed on 3-cycle BTC momentum deceleration judgment override. See `Trades/2026-04-19_ETHUSDT_short.md`.

**Status:** FLAT. Setup complete.

**Re-entry scenarios** (for future cycles если structure reinvigoorates):
- BTC slope1h returns below -4 + fresh 15M BOS bearish сross-pair 5+/8 → re-enter SHORT on bounce to 2310-2320 zone
- ETH 1H close above 2330 → thesis invalidated, watch for bounce LONG setup

**Invalidation:** BTC 1H close **above 75600** reclaiming EMA21 → bear thesis dead. Bullish BOS confirmation → flip to bounce LONG scenario.

**Session:** NY (quality 1.0), funding ok (>400 min).

### Watch: BTC bounce-fail SHORT at EMA21/55 retest

**Status (C208 07:05 UTC, London open):** BTC dumped overnight 75731 → 74965 (~-1%). Yesterday's BTCUSDT thesis trigger fired: "1H close < 75000 → trend-aligned SHORT becomes valid." Bos1h=bearish across all 8 pairs. ADX 32 mDI 32.8 > pDI 10.5 — strong sustained bear DI dominance. RSI ~oversold (BTC RSI1h ≈ 27 zone per BTC context).

**Why WAIT not chase:** RSI oversold = bounce risk. Late to short the impulse. Need bounce-and-fail at EMA21/EMA55 retest for clean R:R + structural confirmation.

**Trigger to enter SHORT:**
1. BTC bounces back to 75500–76200 zone (EMA55/EMA21 1H), AND
2. 1H or 15M rejection wick at the retest with volume, AND
3. 15M bearish BOS confirmation post-retest, AND
4. ADX stays > 25 with mDI dominant.

**Entry zone:** 75600–76100 (sell-the-rip zone).
**SL:** above 76300 (above EMA21 + 0.4×ATR buffer).
**TP:** 75000 (psychological retest) → 74500 (next swing low) → 74000 (R:R ≥ 2.0).
**Risk:** 0.5% (B+ standard size, news mult 1.0 currently).
**Invalidation:** 1H close > 76300 reclaiming both EMAs → bear thesis dead, neutral reset. OR BTC RSI1h reclaiming > 50 with volume.
**Session window:** London (07:00–13:00 UTC).

### Watch: XRP LONG counter-trend (sweep+reclaim formation в процессе)

**Status (C211 07:38 UTC):** sweep low 1.4151 (1 bar ago) + 4 higher lows подряд (1.4151 → 1.4185 → 1.4208 → 1.4225). **bos1h перешёл из bearish в `none` впервые за сессию** — bearish структура invalidated. ADX 28.4 (самый низкий из 8), pdi 14.8 (самый высокий из 8). Setup на пороге A-quality counter-trend, но ещё нет bullish BOS.

**Trigger to enter LONG:**
1. 15M или 1H bullish BOS confirmation (price closes выше structural HL), AND
2. RSI slope flip к positive (currently -0.95), AND
3. BTC RSI1h reclaiming > 30 (currently 28.8) ИЛИ BTC chg_20_1h > -1.0%, AND
4. ADX cross: pdi > mdi (currently 14.8 vs 26.7 — далеко).

**Entry zone:** 1.4225–1.4250 (post-confirmation).
**SL:** 1.4140 (под sweep low 1.4151 - 0.4×ATR).
**TP:** 1.4288 (nearR) → 1.4317 (broken structural) → 1.4400. R:R 1.5+ при entry 1.4225 / TP 1.4288.
**Risk:** 0.375% (counter-trend × news mult 0.5 = 0.75 × 0.5).
**Invalidation:** XRP closes 15M < 1.4180 (под текущей серией HL) ИЛИ BTC RSI rolls back < 27.5 ИЛИ news bias flips risk-off.
**Session window:** Лондон (07:00–13:00 UTC), но funding window в 22 мин (08:00 UTC) — entry block 07:50–08:10.

### Watch: BTC oversold bounce LONG (sweep+reclaim of 75000 / 74500)

**Setup form:** BTC RSI ~27 oversold + sustained -DI dominance for hours = capitulation. Watch for sweep of psychological 75000 (already hit) or 74500 with sharp 15M bullish reclaim.

**Trigger:** 15M sweep low + reclaim with volume spike + 15M bullish BOS + BTC RSI bullish divergence (price LL, RSI HL).

**Entry zone:** 74700–75100 (post-reclaim).
**SL:** below the swept low + 0.4×ATR (~74400 if sweep at 74500).
**TP:** 75500 (EMA55 1H) → 76200 (EMA21 1H) → R:R ≥ 1.7.
**Risk:** 0.5% (counter-trend, requires 10/12 confluence min).
**Invalidation:** 1H close < 74400 on volume → trend extends, no bounce.
**Session window:** London.

---

## Invalidations (this cycle — C208 07:05 UTC)

### ❌ XRP LONG TOP-priority (10/12 A-setup) — INVALIDATED

**Reason:** Watchlist invalidation rule "XRP closes 15M < 1.4282" — current XRP price 1.4177, well below. Overnight gap-down also separately invalidates.
**Outcome:** zero position, zero loss. Defer-to-clean-management decision yesterday saved ~0.75R that would have been at risk.
**Re-entry:** Only on fresh structural reset (sweep+reclaim of 1.4151 swept low + retest of 1.4288 nearest resistance from above). Not on score-flicker.

### ❌ BNB Wyckoff Spring LONG — INVALIDATED

**Reason:** Setup required reclaim 630.5+ + 1H close > 630.5. BNB now 618.5 — well below sprung lows (629.0 SL level breached). Sweep+reclaim pattern aborted.
**Re-entry:** Fresh structural setup required (new spring formation, not continuation of old).

### ❌ DOGE LONG (pop above 0.09519) — INVALIDATED

**Reason:** Trigger required 1H close > 0.09520. Current price 0.09361, well below. Pattern dead.

---

## Recently Removed (last 24h)

- **ETHUSDT SHORT #2** — CLOSED DEFENSIVELY 2026-04-20 03:59 UTC @ ~2285.12 (market). +0.27R / ~+$151 gross / ~+$90 net. Entry @ 2291.48 20:03 UTC. Peak +0.57R / +$319 at 20:48 UTC — stuck ниже +1R trigger 7+ hours. Thesis flipped overnight: BOS 1h/15m lost bearish, MACD1h sign flip -2.91→+0.063, RSI1h recovered 28→40, BTC slope -6→+2.6. 53% peak give-back. Postmortem: `2026-04-19_ETHUSDT_short_2.md`. Candidate lesson CONFIRMED (3rd recurrence today): 50%-peak-give-back rule below +1R.
- **XRPUSDT LONG multi-pair-reversal** — CLOSED DEFENSIVELY 2026-04-19 12:49 UTC @ 1.4277. +0.58R / +$264.71 gross. Entry @ 1.4249 (fills 19 pts better than 1.4268 quoted). Peak +1.24R ($551) at C303 but missed +1.5R trail trigger by 13 pts. Defensive close on news risk-off 2-cycle confirmation (new Hormuz closure validated by WebSearch). Postmortem: `2026-04-19_XRPUSDT_long.md`. Lesson codified: Peak Proximity Trail Protocol.
- **XRPUSDT LONG TOP-priority** — INVALIDATED 2026-04-19 07:05 UTC. Overnight gap-down breached 1.4282 invalidation level. Re-entry requires fresh sweep+reclaim structural setup, not score flicker.
- **BNB Wyckoff spring LONG** — INVALIDATED 2026-04-19 07:05 UTC. Sprung lows breached.
- **DOGE LONG pop** — INVALIDATED 2026-04-19 07:05 UTC. Trigger level not held overnight.
- **BNBUSDT LONG** — TRIGGERED 2026-04-17 11:01:34 UTC. Fill: 629.9, SL 626.2, TP 635.5, R:R 1.51. Closed +1.46R (TP hit during cron outage).
- **AVAXUSDT LONG** — removed 4× on flicker, will not re-add without 3+ consecutive 6/8 cycles.
- **LINKUSDT LONG** — removed 2026-04-17 09:00 UTC. R:R floor + confluence floor invalidation.
- **DOGEUSDT LONG** — removed 2026-04-17 10:45 UTC. Confluence dropped 6/8 → 5/8.
