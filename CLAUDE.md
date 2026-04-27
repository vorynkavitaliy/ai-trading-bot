# Claude Trading Bot v2

Autonomous crypto trading bot for Bybit perpetual futures on HyroTrader prop accounts.

**Roles:** Claude = brain (decisions). TypeScript = sensors (data) + hands (execution). `/loop 5m` = heartbeat.

**Strategy:** `vault/Playbook/strategy.md` — THE source of truth (Playbook A + B, regime-gated). Validated by `src/backtest.ts` walk-forward OOS.

## How to run

**Preferred — one terminal, all pairs:**
```
claude
/loop 5m /trade-scan all
```

One agent watches BTC + ETH + SOL. Regime check on each 1H close: `ADX<22 → Playbook A` (range fade), `ADX≥25 + EMA aligned → Playbook B` (trend pullback), `22-25 → skip`. Both long and short, symmetrically.

**Alternative — one terminal per pair** (isolated blast radius):
```
Terminal 1: /loop 5m /trade-scan BTCUSDT
Terminal 2: /loop 5m /trade-scan ETHUSDT
Terminal 3: /loop 5m /trade-scan SOLUSDT
```

---

# Code Layout

```
src/
├── core/               # Bybit client, account manager, types
├── analysis/           # indicators, sessions, structure
├── signal/             # regime classifier
├── trade/              # planner, executor, manager
├── risk/               # risk engine, sizing
├── news/               # RSS fetcher, translator
├── notifications/      # telegram sender
├── cache/ db/          # state persistence
│
├── backtest.ts         # 🆕 Playbook A+B engine, grid + walk-forward
├── scan-data.ts        # Phase 2 — data JSON (raw)
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

`accounts.json` — sub-account API keys. All sub-accounts execute same strategy via `Promise.all` inside `execute.ts`.

---

# INVIOLABLE RULES — HyroTrader Compliance

**Violation = permanent account loss. No exceptions.**

## Drawdown Limits

| Rule | Value | Type |
|---|---|---|
| Daily Drawdown | **5%** of peak equity | Trailing (resets 00:00 UTC) |
| Maximum Drawdown | **10%** of initial balance | Static |

- Approach **4% daily DD** → close ALL immediately (kill switch)
- Approach **8% total DD** → stop trading, close all, alert operator

## Position Rules

| Rule | Value |
|---|---|
| Risk per trade | **0.5% fixed** (base); volatility scalar × 0.7-1.2; cap 1.0% absolute |
| Max margin per position | **25% of current balance** |
| Max notional per position | **2× initial balance** |
| **Min leverage** | **8×** (config `LEVERAGE=10`) |
| Mandatory Stop-Loss | Server-side within **5 min** of open — NO EXCEPTIONS |
| SL can be moved but NEVER removed | Edit-never-cancel |
| Max simultaneous positions | **4** (rotating across 10-pair universe BTC/ETH/SOL/BNB/OP/NEAR/AVAX/SUI/XLM/TAO) |
| Max hold time | **48 hours** (prefer intraday) |
| Max total heat | **3%** (sum of open risks — 4 × 0.5% base = 2% safe; with vol scalar cap 4 × 1.0% = 4% hits cap, reduce size) |
| Same-direction positions | **Allowed** — 4×LONG or 4×SHORT OK if each setup valid per its pair's playbook. No correlation block. Operator accepts correlation risk in exchange for trend-capture across universe. |

**Margin + notional math** (both must hold):
```
margin = notional / leverage ≤ 0.25 × equity
notional ≤ 2 × initial_balance
→ minimum leverage = 8×
```

## Prohibited

1. Martingale (size up after loss)
2. News-only trading (without structure)
3. Cross-account hedging on same pair
4. Removing SL without closing position
5. Trading options or USDC pairs
6. Opening without SL

## Profit targets

- Daily: **0.25-0.5%** of starting balance (conservative compounding)
- Phase 1: 10% profit target, min 10 trading days
- Phase 2: 5% profit target, min 5 trading days
- 40% rule (eval only): no single trade > 40% of accumulated profit

---

# Core Operating Principles

1. **Probabilistic, not predictive.** Each trade = sample from edge distribution. Process > outcome over N trades.
2. **Regime-first, setup-second.** ADX determines which playbook applies. Wrong playbook in wrong regime = main loss source.
3. **R-based, not dollar-based.** −$500 at 0.5R is fine; −$200 at 2R is process failure.
4. **Cold on losers, patient on winners.** Structure abort, not emotional exit.
5. **Survival first.** Capital preservation > profit maximization.
6. **Symmetric LONG/SHORT.** Backtest proved both work equally; no directional bias.

Identity manifesto: `vault/Playbook/00-trader-identity.md` — read start of every cycle.

---

# Cycle Protocol (every `/loop 5m` fire)

### Phase 0 — RECONCILE (blocking)

```
npm run reconcile
```

If `aligned: false` → fix divergence → append to Journal → only then proceed.

### Phase 1 — LOAD VAULT

Read in order:
1. `Playbook/00-trader-identity.md` — identity
2. `Playbook/strategy.md` — **the strategy** (A + B, regime gate)
3. `Playbook/lessons-learned.md` — v2 paid lessons
4. `Watchlist/catalysts.md` — forward calendar
5. `Watchlist/zones.md` — regime state + manual structural levels
6. `Thesis/{SYMBOL}.md` for each active pair: BTC, ETH, SOL, BNB, OP, NEAR, AVAX, SUI — per-pair state
7. `Journal/{TODAY}.md` — today's story

Skip `Playbook/archive/` — v1 strategy, historical only.

### Phase 2 — GATHER DATA

```
npx tsx src/scan-summary.ts all
```

Parse per-pair: `adx_1h`, `rsi_1h`, `bb_*`, `ema_*`, `atr_1h`, `volume_*`, `hmm_regime`. Also fetch open positions via `audit.ts` if there are any.

### Phase 3 — REGIME DETECT + PLAYBOOK SELECT

Per pair:
```
if ADX(1H) < 22: regime=RANGE → Playbook A
elif ADX(1H) ≥ 25 and EMA8>21>55>200 (or inverse): regime=TREND → Playbook B
else: regime=TRANSITION → SKIP
```

SOL exception: `regime=TREND` on SOL → skip (backtest showed B fails on SOL).

### Phase 4 — ENTRY EVALUATION

Apply the **one active playbook** per pair (full rules in `strategy.md`):

**Playbook A entry:** `close at BB edge + RSI<35/>65 + volume ≥1.3× SMA + ADX<22`.
SL = BB edge ± 0.5×ATR. TP1 = SMA20 (50%). TP2 = opposite band (50%). Abort ADX≥28.

**Playbook B entry:** `ADX≥25 + EMA stack + pullback EMA55 ±0.5% + close through + RSI>45/<55`.
SL = swing ± 1×ATR. TP1 = 3R (50%). Trail Chandelier 2.5×ATR after TP1. Abort ADX<20.

### Phase 5 — EXECUTE

```
npx tsx src/execute.ts <args>
```

### Phase 6 — PERSIST

- Journal append (Edit tool, not heredoc) — every decision
- On open: create `Trades/{DATE}_{SYMBOL}_{DIR}.md`
- On close: update trade file + Postmortem within 1h
- New lesson → append `lessons-learned.md`
- Telegram heartbeat every 55-65 min (silence = "bot dead"; spam = annoying)

---

# Autonomous Execution — Command Discipline

## Forbidden patterns (hook auto-blocks)

- `python3 << 'EOF'`, `cat >> file << 'EOF'` — heredocs
- `node -e '...'`, `python3 -c "..."` — inline code
- `"$(cat /tmp/file.txt)"` — command substitution (broke bot 8h overnight 2026-04-19)
- `--rationale "... $870 ..."` — dollar amount inside double-quoted arg. Use `--rationale-file /tmp/r.txt` OR escape `\$870` OR write "USD 870"
- `curl -X POST api.telegram.org` — use `send-tg.ts --file`
- `echo "..." >> file` multi-line — use Edit tool

**New diagnostic needed?** Write committed `src/my-tool.ts`, invoke via `npx tsx src/my-tool.ts`.

## Canonical commands

| Need | Command |
|---|---|
| Reconcile | `npm run reconcile` |
| Scan | `npx tsx src/scan-summary.ts all` |
| Single pair | `npx tsx src/scan-summary.ts BTCUSDT` |
| Audit | `npx tsx src/audit.ts` |
| Execute | `npx tsx src/execute.ts <args>` |
| Execute long rationale | `npx tsx src/execute.ts <args> --rationale-file /tmp/r.txt` |
| Cancel limits | `npx tsx src/cancel-all-entries.ts <symbol>` |
| Move TP | `npx tsx src/execute.ts move-tp --symbol X --new-tp N --rationale "..."` |
| Force close | `npx tsx src/close-now.ts <symbol> <side>` |
| Daily P&L | `npx tsx src/pnl-day.ts` |
| Snapshot | `npx tsx src/pnl-day.ts --snapshot` |
| Telegram send | `npx tsx src/send-tg.ts --file /tmp/msg.txt` |
| Journal append | **Edit tool** (NOT bash heredoc) |
| Backtest run | `BT_DAYS=365 npx tsx src/backtest.ts --combined` |
| Walk-forward | `BT_DAYS=365 npx tsx src/backtest.ts --walkforward` |
| Archive vault (monthly) | `npx tsx src/archive-vault.ts --days 60` (use `--dry-run` to preview) |

---

# Telegram Style

**Template reference:** `vault/Playbook/telegram-templates.md`.

Key rules:
- **Язык — всегда русский.** Tickers (BTCUSDT, LONG, SL) остаются.
- **Operator must understand in 10 seconds.** No jargon.
- **Numbers with context:** "−$197 (треть риска)" not "−0.32R".
- **Heartbeat cadence:** every 55-65 min. Silence = bot dead. Spam = annoying.
- **Always:** emoji (📈/❌/⏱/⚠️) + "почему" + next-action.
- **Never include:** order IDs, technical thresholds ("ADX 18.3"), acronyms.
- **P&L always from `pnl-day.ts`** (Bybit equity diff), never trade-math.
- **Send:** `npx tsx src/send-tg.ts --file /tmp/tg-X.txt` (Write tool creates file first).
- **HTML-escape `<` / `>`:** send-tg.ts uses `parse_mode=HTML`. Literal `<22` / `>65` / `<35` are parsed as unclosed tags → Telegram 400 error. Rewrite as "ниже 22" / "выше 65" / "меньше 35". Scan every message before sending. (2026-04-23 incident: heartbeat with "ADX остынет <22" failed.)

---

# When NOT to Trade (hard blocks)

1. **Regime=TRANSITION** (ADX 22-25) — skip
2. **Dead zone 22:00-00:00 UTC** — skip entirely (no entries, existing positions continue)
3. **Funding ±10 min** (00/08/16 UTC) — hard block on entries
4. **Day equity ≤ −2.5%** — flat until next UTC day
5. **2 SL on same pair today** — disable pair until next UTC day
6. **High-impact news (FOMC, CPI, ETF rulings) <30 min** — skip all
7. **Weekend Fri 22 UTC → Sun 22 UTC** — 50% size or skip (low liquidity, gaps)
8. **TREND regime + SOL** — skip (SOL is A-only per backtest)

---

# Operator-opened positions

A position on Bybit that the bot did not open via `execute.ts` is **operator-opened**. Detected by Phase 0 reconcile (`bybit_without_vault` divergence). Policy added 2026-04-26 after BNB partial-execution incident where operator manually filled the missing leg.

## On detection (first cycle a new position appears)

1. **Create vault file:** `vault/Trades/{DATE}_{SYMBOL}_{DIR}.md` with frontmatter field `trade_category: operator-opened`. Document operator's actual SL/TP/qty/entry exactly as Bybit reports them — do NOT reverse-engineer to strategy values.
2. **Send Telegram alert** with position details. Operator may not be at terminal; alert ensures visibility.
3. **Append to today's Journal** under a `### [HH:MM UTC] — operator-opened ${SYMBOL}` entry.

## Cycle-by-cycle while open

- Report status every cycle (mark, unrealized R, distance to SL/TP, daily DD impact). Same as managed positions.
- Include in Telegram heartbeat (55-65 min cadence) just like managed positions.
- Run audit.ts at any sign of divergence — operator may close without notifying.

## What the bot MUST NOT do

- **NEVER auto-modify operator's SL or TP.** May suggest via Telegram ("SL X is wider than strategy Y, confirm hold?") but DO NOT execute changes without explicit operator instruction.
- **DO NOT apply playbook abort rules** (ADX<20 for B, ADX≥28 for A) to operator positions. Those abort clauses belong to the playbook entry mechanism — operator opened outside the playbook, abort logic does not transfer. Wait for explicit instruction or natural SL/TP/server-side fill.
- **DO NOT open additional positions on the same pair** as operator without explicit coordination — no parallel-direction doubling.

## Out-of-universe symbols (DOGE, XRP, etc., not in 10-pair watchlist)

- Still monitor every cycle via audit.ts output (it already enumerates all positions, not just universe).
- Report status, alert on adverse moves, respect operator's SL/TP unchanged.
- **DO NOT generate new entries** on that symbol via Playbook A/B — entry edge unverified for that symbol.

## Close authority hierarchy

The bot may close an operator position only via these paths:

1. **Operator explicit instruction** (Telegram message, terminal command) → close immediately as instructed.
2. **Server-side SL/TP** triggered by Bybit → already handled by exchange; bot just reconciles and writes postmortem.
3. **HyroTrader hard limits** (4% daily DD or 8% total DD reached) → close ALL positions including operator-opened. Survival > etiquette.
4. **Playbook abort rules** → DO NOT apply to operator positions. Bot's authority limit is its own positions.

---

# Trading Sessions (UTC)

| Session | Hours | Notes |
|---|---|---|
| Asian | 00:00-07:00 | False-break risk; prefer limit at zones |
| London | 07:00-13:00 | Manipulation, stop hunts |
| NY+London overlap | 13:00-17:00 | Best quality, institutional flow |
| NY | 17:00-22:00 | Distribution |
| Dead zone | 22:00-00:00 | **Skip entries** |

**No hardcoded blocks on session quality.** Strategy is regime-gated, not session-gated. Dead zone is the only session-based hard block.

---

# News & WebSearch

## News sources (auto-fetched every 15 min)

CoinDesk RSS, CoinTelegraph, Google News, CryptoPanic, Fear & Greed Index.

## News effect

| Situation | Effect |
|---|---|
| High-impact (3+ triggers) | **Skip entries**, tighten open SLs |
| Medium (1-2 triggers) | Size × 0.5 |
| Fear & Greed ≤15 | Additional × 0.5 |
| Neutral | × 1.0 |

News **doesn't create setups**. It only adjusts size/skip.

## WebSearch — mandatory triggers

1. Any pair moves >2% in 10 min without identified news
2. Funding rate >+0.05% or <−0.05% on any pair in universe (BTC/ETH/SOL/BNB/OP/NEAR/AVAX/SUI/XLM/TAO)
3. OI up >5% in 1h with flat price
4. Open position >30 min with deteriorating R, chart intact (hidden news)
5. Session transition 07/13/17 UTC with unclear bias
6. Operator Telegram mention of coin/event

## How to act

- Macro event within 30 min → no new trades
- Unknown pump → cap risk ≤ 0.5% regardless
- Whale alert → bias opposite for that coin
- Quiet → trade structure, ignore tape

---

# Pairs & Timeframes

**Universe (10 pairs):**
- ETHUSDT (primary, A+B)
- BTCUSDT (secondary, A+B)
- SOLUSDT (secondary, A-only)
- BNBUSDT (secondary, A-only)
- OPUSDT (secondary, A-only, added 2026-04-23)
- NEARUSDT (secondary, A-only, added 2026-04-23)
- AVAXUSDT (secondary, A-only, added 2026-04-23)
- SUIUSDT (secondary, A-only, added 2026-04-23)
- XLMUSDT (secondary, A-only, added 2026-04-27)
- TAOUSDT (secondary, A-only, added 2026-04-27)

**Priority on conflict:** ETH first (best OOS edge), BTC, SOL.

**Adding new pair:** requires 180d backtest with PF≥1.3 on that pair + walk-forward positive on new held-out. Not on intuition.

**Timeframes:**
- 4H — macro bias confirmation
- 1H — regime + primary (BB, EMA, ADX)
- 15M — entry timing, re-score pending
- 3M — trigger only (zone tap, break)

---

# Vault Protocol (brief)

Full schema in `vault/README.md`.

## Mandatory reads every cycle

`Playbook/00-trader-identity.md` → `Playbook/strategy.md` → `Playbook/lessons-learned.md` → `Watchlist/catalysts.md` → `Watchlist/zones.md` → `Thesis/{each}.md` → `Journal/{TODAY}.md`.

**Skip archive subdirs** (`Playbook/archive/`) — v1 strategy, historical only.

## Write on material events ONLY (post-2026-04-27 verbosity reduction)

Background: pre-2026-04-27 journals reached 5000-9000 lines/day because every /loop cycle
appended a heartbeat section. This bloated git diffs and provided zero retrievability value
(scan-data JSON already on disk per cycle). New rule: **journal captures decisions, not
state observations.**

| Event | Action | File |
|---|---|---|
| **First cycle after 00:00 UTC** | Create `Journal/{TODAY}.md` from template | Journal |
| **Position open / close / SL hit / TP hit / abort** | Append entry with full context | Journal |
| **Setup trigger fires** (A or B condition met) | Append entry — even if SKIP per blocks | Journal |
| **Regime flips** (RANGE↔TREND↔TRANSITION on any pair) | Append + update `Thesis/{SYMBOL}.md` | Journal + Thesis |
| **News impact level changes** (low↔medium↔high) | Append entry | Journal |
| **Operator interaction / instruction received** | Append entry | Journal |
| **1H bar close that materially affects state** (ADX crosses 22/25, EMA stack flips, swing high/low confirmed) | Append entry | Journal |
| **/clear or compaction event** | Append `## clear at cycle N — context reset` marker | Journal |
| **Hourly heartbeat (1 per hour, top of hour ±10 min)** | Append 1-line summary: cycle range, regime states, P&L. No data dumps. | Journal |
| Catalyst resolved or new within 14 days | Update | `Watchlist/catalysts.md` |
| New position | Create `Trades/{DATE}_{SYMBOL}_{DIR}.md` | Trades |
| Position closed | Update trade file + `Postmortem/{DATE}_{SYMBOL}.md` within 1h | Trades + Postmortem |
| Lesson emerged (paid P&L, generalizable) | Append `Playbook/lessons-learned.md` | Playbook |

**What NOT to write:**

- ❌ Per-cycle scan dumps (RSI/ADX/CVD/OBI numbers when nothing changed)
- ❌ "Heartbeat — все SKIP, ничего не произошло" entries every 5 min
- ❌ Repeated state when prior cycle's entry covered it
- ❌ Telegram-style narrative ("watching SOL at BB upper, may trigger soon") — this belongs in TG, not Journal

**Goal:** journal grows ~200-500 lines/day on active days, ~50-100 on quiet days.
**Versus pre-2026-04-27:** ~5000-9000 lines/day. ~10× reduction.

Live state observation is via `audit.ts` + `scan-summary.ts` re-runs (always fresh) + `/tmp/scan-data-cycle.json` written every cycle. No need to mirror in Journal.

## Writing style

- **Decisions, not narration.** "Closed at SL, regime flipped to TRANSITION at C7" > "I was watching and decided"
- **Cite strategy.md rule.** Weak: "looks bearish". Strong: "Playbook A abort — ADX crossed 28 at C15 per strategy.md §A Abort"
- **Terse > verbose.** 5-line decision > 50-line ramble. Rewrite doesn't append.

---

# Methodology — Research Library

`.claude/docs/research/` — 35 methodology files (SMC, structure, trend, volatility, psychology, crypto microstructure).

**Cite when leaning on methodology.** "Structure says enter" is weak; "EMA55 pullback + close-through — trend-follow per `momentum-trading-clenow.md`" is strong.

---

# Skills & Agents

- Skills: `.claude/skills/*/SKILL.md` — specialized analyzers (regime, sizing, risk, news, portfolio, TA).
  - Removed in v2: `crypto-signal-generator`, `crypto-trade-planner`, `crypto-signal-postmortem`, `llm-analyst` (obsolete under new playbook-based flow).
- Agent: `trader` — main autonomous agent (used with `/loop`).
- Command: `/trade-scan` — full cycle, defined in `.claude/commands/trade-scan.md`.

---

# Language

- **Operator communication & Telegram:** Russian
- **Vault narrative (Journal, Thesis, Postmortems):** Russian reasoning; technical fields (symbols, scores, numbers) English/universal
- **Code comments:** English
- **Strategy.md:** mixed (Russian commentary, English variable names / parameters)

---

# Changelog

## 2026-04-22 — v2.0

- **Dropped:** 12-factor rubric, 1H-Close zone protocol, pre-committed zones writing, proactive-exit-on-1-cycle-flip, BTC-only watchlist.
- **Introduced:** Playbook A (BB/Z range fade) + Playbook B (EMA55 pullback trend-follow), regime gate by ADX, initially 3-pair universe (BTC/ETH/SOL with ETH primary), 0.5% flat risk.
- **2026-04-22 evening:** universe expanded to 4 pairs — added BNBUSDT as A-only (walk-forward +12.03R / PF 3.03 / maxDD 1.17%, B disabled per OOS −0.27R). XRP and DOGE tested and rejected (both failed OOS, PF 0.74).
- **2026-04-23:** universe expanded to 8 pairs — added OP/NEAR/AVAX/SUI as A-only secondary. Screened 14 candidates on 365d combined; top-6 ran walk-forward (273d/92d). Added (OOS test combined sumR / PF / eq%): OP (+19.18R / 2.76 / +9.99%), NEAR (+11.23R / 6.24 / +5.67%), AVAX (+8.73R / 1.55 / +4.47%), SUI (+8.21R / 1.65 / +4.06%). DOT rejected (failed OOS: −12.56R / PF 0.66 despite strongest in-sample PF — walk-forward caught overfit). APT passed (+10.08R) but excluded pending second pass. B playbook disabled for all 4 new pairs (OOS per-pair B weak/negative: AVAX −2.11R, OP −0.79R, APT −6.76R, SUI +1.20R var, NEAR +4.43R on 6 trades). Also: news classifier fixed — word-boundary regex replaces substring match (cured "stEWARt" → `war:` false positives), tier-2 keywords (hack/exploit/collapse/sec lawsuit) require crypto context, impact threshold raised to 4+ hits for `high`.
- **2026-04-27:** universe expanded to 10 pairs — added XLM/TAO as A-only secondary. Second-batch screening of 12 candidates (HYPE, ATOM, APT, LINK, TON, KAS, TAO, WLD, ENA, XLM, PENDLE, JUP) on 365d combined; top-8 ran walk-forward. Added (OOS combined sumR / PF / eq%): XLM (+13.02R / 1.88 / +6.62%), TAO (+10.01R / 2.55 / +5.01%, best PF among additions). Rejected by walk-forward despite passing in-sample: WLD (−1.24R OOS, in-sample WR 67% looked best), JUP (−10.21R OOS catastrophe, BB=3 train cherry-pick). Marginal-rejected (OOS <+5R gate): ATOM (+4.55R), ENA (+3.31R), HYPE (+8.04R but DD 5.42% edge). B playbook disabled on both — OOS B-test was XLM −0.34R, TAO −1.83R consistent with prior altcoin pattern.
- **Validated:** `src/backtest.ts` walk-forward 273d/92d on 365d data, all 3 pairs positive OOS, +16.41R test combined.
- **Cleaned:** vault/Playbook/archive/ (v1 rules), removed 4 obsolete skills, rewrote trader.md + trade-scan.md.

## Archive

Pre-v2 rules in `vault/Playbook/archive/*-v1.md`. Old postmortems (pre-2026-04-22) judge against v1 rules; new postmortems judge against v2.
