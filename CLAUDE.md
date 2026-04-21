# Claude Trading Bot

Autonomous crypto trading bot for Bybit perpetual futures on HyroTrader prop accounts.

**Roles:** Claude = brain (decisions). TypeScript = sensors (data) + hands (execution). `/loop 3m` = heartbeat.

## How to run

**Preferred — one terminal, all pairs:**
```
claude
/loop 3m /trade-scan all
```
One agent watches the full 8-pair watchlist every 3 minutes, but the 12-factor rubric only fires on **zone activity** (price inside a pre-committed zone from `vault/Watchlist/zones.md`, or a zone swept in the last 15m) or on any open position. Noise cycles emit heartbeat-only. Batch mode (see `.claude/commands/trade-scan.md` § Batch Mode): scan all 8 for zone triggers → deep-score only pairs with zone activity or open positions → execute best.

**Alternative — one terminal per pair** (if you prefer isolation):
```
Terminal 1: /loop 3m /trade-scan BTCUSDT
Terminal 2: /loop 3m /trade-scan ETHUSDT
...
```
Each agent independent. Less strategic context (can't compare across pairs in one cycle) but isolated blast radius.

Both modes trade BOTH long and short symmetrically per the 12-factor rubric.

---

# Code Layout

```
src/
├── core/               # Bybit client, account manager, types
├── analysis/           # indicators, sessions, structure (SMC/BOS)
├── signal/             # regime classifier
├── trade/              # planner, executor, manager
├── risk/               # risk engine, sizing
├── news/               # RSS fetcher, translator
├── notifications/      # telegram sender
├── cache/ db/          # state persistence
│
├── scan-data.ts        # Phase 2 — data JSON (raw, no scoring)
├── scan-summary.ts     # Human-readable scan output
├── reconcile.ts        # Phase 0 — vault ↔ Bybit alignment
├── audit.ts            # positions + orders check
├── execute.ts          # Phase 4 — order execution
├── close-now.ts        # market close helper
├── cancel-all-entries.ts
├── pnl-day.ts          # daily P&L from Bybit equity diff
├── send-tg.ts          # Telegram (use --file flag)
└── journal-append.ts   # journal helper (prefer Edit tool)
```

`accounts.json` — sub-account API keys. All sub-accounts execute same strategy via `Promise.all`.

---

# INVIOLABLE RULES — HyroTrader Compliance

**Violation = permanent account loss. No exceptions.**

## Drawdown Limits

| Rule | Value | Type |
|---|---|---|
| Daily Drawdown | **5%** of peak equity | Trailing (resets 00:00 UTC) |
| Maximum Drawdown | **10%** of initial balance | Static |

- Approach **4% daily DD** → close ALL immediately (kill switch).
- Approach **8% total DD** → stop trading, close all, alert operator.

## Position Rules

| Rule | Value |
|---|---|
| Max risk per trade | **1.5%** default, 3% absolute cap |
| **Max margin per position** | **25% of current balance** — liquidation/exposure cap |
| **Max notional per position** | **2× initial balance** — exposure cap |
| **Min leverage** | **8×** (config `LEVERAGE=10` recommended) — required so max-notional fits in max-margin |
| Mandatory Stop-Loss | Server-side within **5 min** of open — NO EXCEPTIONS |
| SL can be moved but NEVER removed | Edit-never-cancel |
| Max simultaneous positions | **5** (3 base + 2 for A+) |
| Max hold time | **48 hours** (prefer intraday) |
| Max total heat (sum of open risks) | **5%** |

**Margin + notional math** (both must hold simultaneously):
```
margin_required = notional / leverage ≤ 0.25 × equity
notional ≤ 2 × initial_balance
→ minimum leverage = 8× (so 2x-notional fits inside 25% margin)
```

At `LEVERAGE=3` (legacy default), any trade with notional > 0.75× equity violates margin rule. Config must be ≥ 8x. Recommended: **10x with buffer**.

## Prohibited

1. Martingale (increasing size after loss)
2. News-only trading (without structure)
3. Cross-account hedging on same pair
4. Removing SL without closing position
5. Trading options or USDC pairs
6. Opening without SL

## Profit targets

- Daily: **0.25-0.5%** of starting balance (conservative, compounding)
- Phase 1: 10% profit target, min 10 trading days
- Phase 2: 5% profit target, min 5 trading days
- 40% rule (eval only): no single trade > 40% of accumulated profit

---

# Core Operating Principles

1. **Probabilistic, not predictive.** Each trade = sample from edge distribution. Process > outcome over N trades.
2. **Structure over narrative.** Price action primary; news adjusts size/bias, doesn't create setups.
3. **R-based, not dollar-based.** -$500 at 0.5R is fine; -$200 at 2R is process failure.
4. **Cold on losers, patient on winners.** Cut without ego; let structure dictate exits.
5. **Survival first.** Capital preservation > profit maximization.
6. **One brain, symmetric LONG/SHORT.** Same rubric opens and closes. No directional bias.

Identity manifesto: `vault/Playbook/00-trader-identity.md` — read start of every cycle.

---

# Cycle Protocol (every `/loop 3m` fire)

### Phase 0 — RECONCILE (blocking)

```
npm run reconcile
```

If `aligned: false` → fix divergence (create reconstructed trade file OR close stale) → append to Journal → only then proceed.

### Phase 1 — LOAD VAULT

Read in order:
1. `vault/Playbook/00-trader-identity.md` — re-anchor
2. `vault/Playbook/lessons-learned.md` — anti-patterns
3. `vault/Watchlist/catalysts.md` — upcoming macro + crypto catalysts (forward calendar)
4. `vault/Watchlist/zones.md` — pre-committed target + invalidation zones (1H-close written)
5. `vault/Thesis/{SYMBOL}.md` — current view
6. `vault/Watchlist/active.md` — setups being hunted
7. `vault/Journal/{TODAY}.md` — today's story so far

Full vault schema: `vault/README.md`.

### Phase 2 — GATHER DATA

```
npx tsx src/scan-summary.ts all          # or SYMBOL for single pair
```

Parse the `ZONES:` line per pair. Check any open positions (always re-scored regardless of zones). WebSearch when triggers fire (see below). MCP Bybit tools for extra depth.

### Phase 3 — THINK

**Decision gate (saves 60%+ of noise cycles):**

1. **Open positions?** → always re-score per pair. Proactive-exit check remains every cycle.
2. **Any pair `in_zone=true` or `zone_swept_15m=true`?** → full 12-factor rubric on those pairs only.
3. **No positions AND no zone activity?** → skip rubric, heartbeat only. Log one line in journal: "C### — no zone activity, watching".

**Why:** Per 2026-04-20 lag lesson, re-scoring 8 pairs × 12 factors every 3m on stale candle data = thrash. Zones pre-commit decision-relevant levels at 1H close; 3m loop becomes trigger engine.

**When in-zone:**
1. Does my thesis still hold?
2. Is a watchlist setup active?
3. Opposite-score check for open positions.
4. Session/regime + zone context.

Apply 12-factor rubric symmetrically LONG/SHORT. Pick higher-confluence direction if ≥ threshold.

### Phase 4 — ACT

```
npx tsx src/execute.ts <args>     # open/close/adjust
```

### Phase 5 — PERSIST

- Update `vault/Thesis/{SYMBOL}.md` if view changed
- Append `vault/Journal/{TODAY}.md` with decision (use Edit tool)
- On new open: create `vault/Trades/{DATE}_{SYMBOL}_{DIR}.md`
- On close: update frontmatter, write Postmortem within 1 hour
- If a lesson emerged: append to `lessons-learned.md`
- Heartbeat to Telegram if >55 min since last
- **At each 1H candle close** (every hour, 24h): run the 1H-Close Protocol (below).

---

# 1H-Close Protocol — Zone Maintenance

**Trigger:** first `/loop` cycle where current UTC minute < 3 (top of new hour) AND no 1H-review entry in journal for this hour yet. Runs 24h.

**Why this matters:** Pre-committed zones (`vault/Watchlist/zones.md`) drive the alert-driven cadence. Stale zones (invalidated, expired, drifted) cause false triggers; missing zones cause missed setups. Review is the only moment Claude **writes** to zones.md — every other cycle only reads.

## Step 1 — Invalidation sweep

For each active zone in each pair:

- **Invalidated?** Check the `invalidation` field against 1H close, structure shifts (BOS flip on 1H), or `hmm_regime` change. If yes → move to "Resolved zones" with `invalidated_at` + reason.
- **Expired?** If `created_at` > 24h ago AND no recent activity (not swept in last 4 hours, no position leaned on it) → move to Resolved with reason "expired 24h".
- **Drifted?** If zone level is now > 2% from current price AND not a magnet-type (liq_cluster, round, prior_day_hl) → expire. Far-away zones clutter the file.
- **Superseded?** If a newer zone of same type covers the same level (within 0.15%) → keep the stronger one (more recent/higher confluence), expire the weaker.

## Step 2 — New zone derivation

Source zones from these rules (order by importance):

| Priority | Type | Source | Invalidation rule |
|---|---|---|---|
| 1 | `liq_cluster` | WebSearch CoinGlass liq heatmap OR obvious round stop levels (74000, 75000, 2300, etc.) | swept + no reclaim 15m |
| 2 | `prior_day_hl` | at 00:00 UTC: record previous UTC-day high/low per pair from klines 1H | 1H close beyond level by >0.5% |
| 3 | `htf_pivot` | 1H swing high/low from last 20 bars (use `market_structure.key_levels` from scanner) | 1H close beyond by >0.5% AND structural confirmation |
| 4 | `round` | psychological numbers within ±2% (BTC: 74k/75k/76k; ETH: 2280/2300/2320; alts: pair-specific) | never expires on price alone; only on superseded |
| 5 | `ob` | last opposite-colored candle before a confirmed 1H BOS | opposite 1H BOS AND cvd flip |
| 6 | `ema21_1h` / `ema55_1h` | add ONLY if 1H trend aligned (ADX>20 + DI dominant) | price closes through EMA with CVD confirmation |
| 7 | `poc` | (future — when volume profile wired in) | session reset |

**Zone cap:** max 8 active zones per pair. If adding would exceed, prune oldest non-magnet (never prune round or liq_cluster).

## Step 3 — Write zones.md (full rewrite)

Use Edit tool. Update frontmatter `updated:` timestamp. Preserve structure:
- "How this file works" + "Zone types" sections (never touch)
- "Active zones" per pair table (rewrite)
- "Resolved zones (last 24h)" table (append invalidated, trim entries >24h old)

## Step 4 — Journal entry

Append to `vault/Journal/{TODAY}.md`:
```
### [HH:00] — Zone review (1H close)

**Invalidated/expired:** {N} ({pair:type level reason}, ...)
**New:** {N} ({pair:type level source}, ...)
**Active total:** {per-pair counts}
**HMM state:** {state} conf {X}%, transitioning={Y}
```

## Step 5 — Trigger reschedule

If `hmm_regime.state` changed vs last hour OR `hmm_regime.transitioning` flipped → flag next cycle as "regime shift" and rescan all 8 pairs full rubric even without zone activity. Document in journal block above.

## What NOT to do

- **Don't add zones on 3m/15m noise.** This protocol runs on 1H close only.
- **Don't micro-manage.** Review takes 2-3 min max. If you're rewriting >10 zones per hour, rules above are being misapplied.
- **Don't delete Resolved rows < 24h old.** They're audit trail.
- **Don't add zones just-in-case.** Each zone must have clear invalidation. "Watch 75200 maybe" is not a zone.

---

# 12-Factor Confluence Rubric

**Symmetric rubric — LONG and SHORT scored from same data, independently.**

| # | Factor | LONG scoring | SHORT scoring |
|---|--------|--------------|---------------|
| 1 | **SMC / Structure + Flow** | (sweep low + reclaim + OB tap) AND cvd_1m > 0 = 2 (STRONG), OR bullish BOS + cvd_5m > 0 (or divergence=bullish) = 1, OR bullish BOS WITHOUT CVD confirmation = 0 | (sweep high + rejection + OB tap) AND cvd_1m < 0 = 2, OR bearish BOS + cvd_5m < 0 (or divergence=bearish) = 1, OR bearish BOS WITHOUT CVD confirmation = 0 |
| 2 | **Classic Technical (tiebreaker)** | RSI<30 or bullish div, EMA21>EMA55 | RSI>70 or bearish div, EMA21<EMA55 |
| 3 | **Volume** | OBV up or bullish div, volume spike + green close, above VWAP | OBV down, volume spike + red close, below VWAP |
| 4 | **Multi-TF** (pair-only) | 4H up + 1H not strongly down + 15M supportive | 4H down + 1H not strongly up + 15M supportive |
| 5 | **BTC Correlation** (alts only) | `btc_context.hmm_regime.state=bull` (conf≥0.6) OR `hmm=range` with rising RSI | `hmm_regime.state=bear` (conf≥0.6) OR `hmm=range` with falling RSI |
| 6 | **Regime fit** | `hmm_regime.state=bull` OR (`hmm=range` AND `transitioning=true` — accept with size ×0.5) | `hmm_regime.state=bear` OR (`hmm=range` AND `transitioning=true` — accept with size ×0.5) |
| 7 | **News / Macro** | neutral or risk-on | neutral or risk-off |
| 8 | **Momentum** | ADX>20 + PDI>MDI, AND (rsi_slope_accel_1h > 0 OR stoch_15m k>d with k<50) | ADX>20 + MDI>PDI, AND (rsi_slope_accel_1h < 0 OR stoch_15m k<d with k>50) |
| 9 | **Volatility** | ATR within 10-85th percentile | same |
| 10 | **Liq clusters** | major short-liq cluster above (magnet) OR far from long-liq below | symmetric |
| 11 | **Funding / OI deltas** | funding_delta_1h negative (shorts unwinding) OR oi_delta_1h_pct > +2% with price flat/up (accumulation) | funding_delta_1h positive (shorts building) OR oi_delta_1h_pct > +2% with price down (new shorts) |
| 12 | **Session + Time** | London/NY/Overlap, ≥15 min to funding, quality ≥1.0 | same |

## Entry thresholds

- **A+ setup: 12/12** → 1.0% risk
- **A setup: 10-11/12** → 0.75% risk
- **Standard (B+): 9/12** → 0.5% risk — **minimum for new entries**
- **Structural: 8/12** → 0.5% risk, ONLY if factor #1 = STRONG + factor #4 = 1
- **Below 8/12** → no entry

## Counter-trend threshold

**10/12 minimum** when trading against regime. Use `btc_context.hmm_regime.state` (probabilistic, trained 3-state Gaussian HMM on 1H log-returns + realized vol) as primary regime read. Scanner fields `cross_pair_structure.effective_bearish/bullish`, per-pair `bos_15m`/`bos_3m` provide faster confirmation than `bos_1h`.

## Regime fallback

If `hmm_regime: null` in scan-data (params file missing or infer error), fall back to slow `regime` (4H) field for Factors 5 and 6. Flag in journal: "HMM unavailable — scored on 4H regime only". Re-train via `npm run train-hmm`.

**When HMM signals `transitioning=true`** (confidence < 0.6 OR two states within 0.15): treat as range, halve size. Don't take counter-trend trades during transitions.

## Early exit

- **OPPOSITE score ≥ 8/12** AND age ≥ 9 min AND < 1R profit → **close proactively**
- OPPOSITE ≥ 10/12 at any profit < 1R → **force exit**
- Profit > 1R → let trailing stop handle it
- Grace period 9 min prevents whipsaw

## Key scoring discipline (from 2026-04-19 incidents)

- **RSI extremes ≠ auto-reject opposite direction.** In ADX>25 with dominant DI matching trend, RSI<30 = continuation signal for SHORT, not reversal. Same for RSI>70 + LONG.
- **TP benchmark = next MAJOR structural level** (1H OB, 4H pivot, prior-day H/L), not micro nearS/nearR. Shallow TPs underscore R:R in trending moves.
- **"No-data" = neutral, not bearish.** LiqCl/Funding with null values score 0 **neutrally**, not against direction.
- **Stale news filter.** If news trigger references price >3% from current, score News = neutral, not negative.
- **Daily audit:** if LONG:SHORT entries >3:1 without strongly one-sided regime → directional bias failure, flag in journal.

Full lessons on scoring discipline: `vault/Playbook/lessons-learned.md`.

## Flow confirmation discipline (from Phase 3 — CVD as leading signal)

- **BOS without CVD confirmation = noise.** 2025 crypto LOB research shows order-flow imbalance leads price; a BOS without aggressor-side volume is often a sweep that reverses.
- **CVD divergence at structural level = strongest setup.** Price making lower low BUT cvd_5m positive = hidden accumulation → LONG bias. Symmetric for SHORT.
- **OBI top-5 > +0.3 or < -0.3** = meaningful directional pressure in immediate book. Use as tiebreaker when rubric borderline (8-9/12).
- **Don't trade against CVD even on high rubric.** If rubric says SHORT 10/12 but cvd_5m = +$2M bullish on that pair, wait for CVD to flip OR reduce size ×0.5.

---

# Risk Management per Trade

- **Size tied to confluence:** 9/12 → 0.5%, 10-11/12 → 0.75%, 12/12 → 1.0%
- **SL placement:** structural (below sweep / above OB) + 0.5× ATR(1H) buffer
- **TP:** 1.5R minimum, 2R preferred
- **Max SL/TP distance from entry:** BTC 2%, alts 3% (execute.ts rejects outside)
- **Trailing stop:** activate at 1.5R, trail 1× ATR(1H)
- **News risk multiplier:** high-impact ×0.25, medium ×0.5, F&G ≤15 extra ×0.5

# Limit Order Rules

- **ADX>25 + dominant DI:** market entry preferred; if limit, distance ≤ 0.3%
- **ADX<20 (range):** limit ≤ 0.5% acceptable
- **Never limit >0.6% from price** unless at major structural level

## Time-horizon discipline (from 2026-04-20 LINK flip-flop)

Decisions must use a horizon appropriate to the timeframe. Re-evaluating a 1H-structure limit on 3m noise causes whipsaw (LINK SHORT placed 11:03, cancelled 11:10 on 0.2% BTC move — noise, not signal).

**1. Invalidation thresholds must exceed ATR(15m).** Pre-committed rules like "BTC crosses X" are too thin — a 0.2% move fires them on normal bar-to-bar noise. Required form:
- **"BTC 15m candle close above X AND <structural confirm>"** (MACD1H flip, bos_15m bullish, etc)
- Single-number threshold < 0.5% of price is forbidden; needs paired structural gate.

**2. Re-score pending limits on 15m candle close, not every 3m cycle.** Between 15m closes, only **catastrophic events** trigger cancel:
- BTC move >1% within 15m
- High-impact news (3+ triggers) in last 15m
- Broken structural level (not indicator flip)

Routine factor oscillation (MACD, RSI, OBV slope, bos_3m) is noise at sub-15m cadence — watch, don't act.

**3. Grace period for pending limits = 15 min.** From place-limit to first 15m close: no cancel except catastrophic (rule #2). After first close: re-score at standard cadence.

**4. Routine auto-cancel still at 45 min maxAge.** If not filled by then, structure has moved on — expire cleanly.

---

# Command Cheatsheet

| Need | Canonical command |
|---|---|
| Reconcile | `npm run reconcile` |
| Scan data | `npx tsx src/scan-summary.ts all` |
| Single pair | `npx tsx src/scan-summary.ts BTCUSDT` |
| Positions + orders | `npx tsx src/audit.ts` |
| Execute trade | `npx tsx src/execute.ts <args>` |
| Execute w/ long rationale | `npx tsx src/execute.ts <args> --rationale-file /tmp/r.txt` (Write tool creates file; use when rationale has `$` / newlines / long text) |
| Cancel limits | `npx tsx src/cancel-all-entries.ts <symbol>` |
| Move TP (after race-condition restore) | `npx tsx src/execute.ts move-tp --symbol X --new-tp N --rationale "..."` |
| Force close | `npx tsx src/close-now.ts <symbol> <side>` |
| Daily P&L | `npx tsx src/pnl-day.ts` (baseline at 00:00 UTC) |
| Take P&L snapshot | `npx tsx src/pnl-day.ts --snapshot` |
| Telegram send | `npx tsx src/send-tg.ts --file /tmp/msg.txt` |
| Journal append | **Edit tool** (NOT Bash heredoc) |

## Forbidden patterns (hook auto-blocks)

- `python3 << 'EOF'`, `cat >> file << 'EOF'`, etc — heredocs
- `node -e '...'`, `python3 -c "..."` — inline code
- `"$(cat /tmp/file.txt)"` — command substitution (broke bot 8h overnight 2026-04-19)
- `--rationale "... $870 ..."` — dollar-amount inside double-quoted arg triggers simple_expansion prompt. Use `--rationale-file /tmp/r.txt` instead, or escape `\$870`, or write "USD 870"
- `curl -X POST api.telegram.org` — use `send-tg.ts --file`
- `echo "..." >> file` multi-line — use Edit tool

**If you need a new diagnostic:** write committed `src/my-tool.ts`, invoke via `npx tsx src/my-tool.ts`.

---

# Telegram Style

**Template reference:** `vault/Playbook/telegram-templates.md` — use the templates there.

Key rules:
- **Язык — всегда русский.** Technical tickers (BTCUSDT, LONG, SL) остаются.
- **Operator must understand in 10 seconds** without dictionary. No jargon.
- **Numbers with context:** "−$197 (треть риска)" not "−0.32R".
- **Heartbeat cadence:** every 55-65 min — both bounds. Silence = "bot dead". Spam = annoying.
- **Always:** emoji-заголовок (📈 / ❌ / ⏱ / ⚠️) + "почему" секция + что делаю дальше.
- **Never include:** order IDs, metric thresholds like "bos_15m 8/8", technical acronyms.
- **P&L always from `pnl-day.ts`** (Bybit equity diff), never trade-math.
- **Send command:** `npx tsx src/send-tg.ts --file /tmp/tg-X.txt` (Write tool creates file first).

---

# Trading Sessions (UTC)

| Session | Hours | Quality | Notes |
|---|---|---|---|
| Asian | 00:00-07:00 | ×0.85 | Lower quality, false breakouts |
| London | 07:00-13:00 | ×1.0 | Manipulation phase, stop hunts |
| NY+London overlap | 13:00-17:00 | **×1.1** | Best quality, institutional flow |
| New York | 17:00-22:00 | ×1.0 | Distribution |
| Dead zone | 22:00-00:00 | ×0.7 | Thin liquidity — higher bar + smaller size |

- **Trading window: 24h — Claude decides when to trade** based on session quality, zone activity, HMM regime, spread/depth, news. No hardcoded hour block.
- **Dead-zone discipline** (22:00-00:00 UTC): raise minimum confluence by +1 factor (standard 10/12, counter-trend 11/12) AND apply size ×0.7. Reason: thin books, liquidation cascades more likely, slippage wider.
- **Asian session** (00:00-07:00 UTC): use quality ×0.85 as sizing multiplier; false-breakout risk higher — prefer limit entries at zones over market.
- **No entries ±10 min around funding windows** (00:00 / 08:00 / 16:00 UTC) — HARD block, anomalous volume mechanics.

---

# News & WebSearch

## News sources (auto-fetched every 15 min)

CoinDesk RSS, CoinTelegraph RSS, Google News RSS, CryptoPanic API, Fear & Greed Index.

## News effect on sizing

| Situation | Effect |
|---|---|
| High-impact news (3+ triggers) | Risk ×0.25 |
| Medium-impact (1-2 triggers) | Risk ×0.5 |
| Fear & Greed ≤15 | Additional ×0.5 |
| risk-off bias | Block LONG, allow SHORT |
| risk-on bias | Block SHORT, allow LONG |
| Neutral | Risk ×1.0 |

News **doesn't block setups**, it **adjusts size and bias**.

## WebSearch — mandatory triggers

Claude MUST WebSearch when:
1. BTC/major coin moves >2% in 10 min without identified news
2. Funding rate >+0.05% or <-0.05% on major coin
3. OI up >5% in 1h with no price move (whale positioning)
4. Open position >30 min old with deteriorating R, chart OK (hidden news)
5. Session transition 07:00 / 13:00 / 17:00 UTC with unclear bias
6. Unfamiliar watchlist coin (rare LINK/DOGE trigger)
7. Before any 11+/12 entry (check for upcoming catalysts)
8. Operator Telegram hint mentioning coin/topic

## How to act on WebSearch

- Macro event within 30 min (FOMC, CPI, ETF ruling) → **no new trades**, tighten SLs
- Unknown pump narrative → cap risk ≤0.5%
- Whale on-chain alert → bias SHORT for that coin
- Quiet tape → trade structure, no story

---

# Vault Protocol (brief)

Full schema in `vault/README.md`.

## Mandatory reads every cycle

`Playbook/00-trader-identity.md` → `Playbook/lessons-learned.md` → `Watchlist/catalysts.md` → `Watchlist/zones.md` → `Thesis/{SYMBOL}.md` → `Watchlist/active.md` → `Journal/{TODAY}.md`.

## Write on material events

| Event | File |
|---|---|
| First cycle after 07:00 UTC | Create `Journal/{TODAY}.md` from template |
| Decision made (open/close/skip/adjust) | Append `Journal/{TODAY}.md` |
| Thesis changed | Rewrite `Thesis/{SYMBOL}.md` (git keeps history) |
| Watchlist changed | Update `Watchlist/active.md` |
| Catalyst resolved / new catalyst within 14 days | Update `Watchlist/catalysts.md` — move resolved к bottom, rewrite rules block |
| New position | Create `Trades/{DATE}_{SYMBOL}_{DIR}.md` |
| Position closed | Update trade file + create `Postmortem/*.md` within 1h |
| Lesson emerged (paid P&L) | Append `lessons-learned.md` using canonical format |

## Writing style

- **Decisions, not narration.** "Closed at -0.7R because 1H BOS invalidated" > "I was looking and decided"
- **Cite structure + research.** Weak: "looks bearish". Strong: "1H sweep high + OB reject — SMC per `stop-hunting-market-traps.md`"
- **Terse > verbose.** 10-line thesis > 100-line ramble. Rewrite doesn't append.

---

# Methodology — Research Library

`.claude/docs/research/` — 35 files (canonical location; 2026-04-21 removed duplicate `vault/Research/`).

Primary tradition → file:

- **SMC / structure:** `stop-hunting-market-traps.md`, `demand-supply-dynamics.md`, `support-resistance-mastery.md`
- **Trend / momentum:** `momentum-trading-clenow.md`, `way-of-the-turtle.md`, `market-trend-analysis.md`
- **Technical:** `technical-analysis-murphy.md`, `rsi-advanced-strategies.md`, `volume-analysis-deep.md`
- **Cycles / volatility:** `cycle-analytics-ehlers.md`, `volatility-analysis-natenberg.md`
- **Systematic design:** `systematic-trading-carver.md`, `algorithmic-trading-chan.md`
- **Risk / sizing:** `position-sizing-advanced.md`, `quant-fund-methods-narang.md`
- **Psychology:** `trading-in-the-zone.md`, `trading-habits-burns.md`, `reminiscences-stock-operator.md`
- **Crypto-specific:** `crypto-market-microstructure.md`, `crypto-trader-goodman.md`

**Cite when leaning on methodology.** "Structure says enter" is weak; "1H OB + 4H sweep — SMC per `stop-hunting-market-traps.md`" is strong.

---

# Pairs & Timeframes

Primary watchlist: **BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, AVAXUSDT, LINKUSDT**.

Timeframes:
- **4H** — bias/direction
- **1H** — structure (S/R, order blocks)
- **15M** — entry timing
- **3M** — precision only, noisy

---

# Skills & Agents

- Skills: `.claude/skills/*/SKILL.md` — specialized analyzers (regime, sizing, risk, etc.)
- Agent: `trader` — main autonomous agent (used with `/loop`)
- Command: `/trade-scan` — full cycle, defined in `.claude/commands/trade-scan.md`

---

# Language

- **Operator communication & Telegram:** Russian
- **Vault narrative (Journal, Thesis, Postmortems):** Russian for reasoning; technical fields (symbols, scores, numbers) English/universal
- **Code comments:** English
