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
| Mandatory Stop-Loss | Server-side within **5 min** of open — NO EXCEPTIONS |
| SL can be moved but NEVER removed | Edit-never-cancel |
| Max simultaneous positions | **5** (3 base + 2 for A+) |
| Max hold time | **48 hours** (prefer intraday) |
| Max total heat (sum of open risks) | **5%** |

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
- **At each 1H candle close** (07:00, 08:00, ..., 22:00 UTC during active session): review `vault/Watchlist/zones.md` — add new zones formed by structure, remove invalidated/expired, move resolved to "Resolved zones" table.

---

# 12-Factor Confluence Rubric

**Symmetric rubric — LONG and SHORT scored from same data, independently.**

| # | Factor | LONG scoring | SHORT scoring |
|---|--------|--------------|---------------|
| 1 | **SMC / Structure** | sweep low + reclaim + OB tap = 2 (STRONG), OR bullish BOS on any TF = 1 | sweep high + rejection + OB tap = 2, OR bearish BOS on any TF = 1 |
| 2 | **Classic Technical (tiebreaker)** | RSI<30 or bullish div, EMA21>EMA55 | RSI>70 or bearish div, EMA21<EMA55 |
| 3 | **Volume** | OBV up or bullish div, volume spike + green close, above VWAP | OBV down, volume spike + red close, below VWAP |
| 4 | **Multi-TF** (pair-only) | 4H up + 1H not strongly down + 15M supportive | 4H down + 1H not strongly up + 15M supportive |
| 5 | **BTC Correlation** (alts only) | BTC Bull OR Range with rising RSI | BTC Bear OR Range with falling RSI |
| 6 | **Regime fit** | Bull OR Range | Bear OR Range |
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

**10/12 minimum** when trading against regime. Use `btc_context.effective_regime` (real-time, not lagging 4H) as primary regime read. Scanner fields `cross_pair_structure.effective_bearish/bullish`, per-pair `bos_15m`/`bos_3m` provide faster confirmation than `bos_1h`.

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
| Dead zone | 22:00-00:00 | ×0.7 | **No new entries** |

- Trading schedule: 07:00–22:00 UTC
- **No entries ±10 min around funding windows** (00:00 / 08:00 / 16:00 UTC)

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

`.claude/docs/research/` — 35 files (also mirrored at `vault/Research/`).

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
