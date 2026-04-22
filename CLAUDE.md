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
| Max simultaneous positions | **4** (one per pair in universe BTC/ETH/SOL/BNB) |
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
6. `Thesis/BTCUSDT.md`, `ETHUSDT.md`, `SOLUSDT.md`, `BNBUSDT.md` — per-pair state
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
2. Funding rate >+0.05% or <−0.05% on BTC/ETH/SOL/BNB
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

**Universe:** BTCUSDT (secondary), ETHUSDT (primary), SOLUSDT (secondary, A-only), BNBUSDT (secondary, A-only).

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

## Write on material events

| Event | File |
|---|---|
| First cycle after 07:00 UTC | Create `Journal/{TODAY}.md` from template |
| Any decision (open/close/skip/abort) | Append `Journal/{TODAY}.md` |
| Regime flipped on a pair | Update `Thesis/{SYMBOL}.md` |
| Catalyst resolved / new within 14 days | Update `Watchlist/catalysts.md` |
| New position | Create `Trades/{DATE}_{SYMBOL}_{DIR}.md` |
| Position closed | Update trade file + Postmortem within 1h |
| Lesson emerged (paid P&L) | Append `lessons-learned.md` |

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
- **Validated:** `src/backtest.ts` walk-forward 273d/92d on 365d data, all 3 pairs positive OOS, +16.41R test combined.
- **Cleaned:** vault/Playbook/archive/ (v1 rules), removed 4 obsolete skills, rewrote trader.md + trade-scan.md.

## Archive

Pre-v2 rules in `vault/Playbook/archive/*-v1.md`. Old postmortems (pre-2026-04-22) judge against v1 rules; new postmortems judge against v2.
