# Trading Bot — Operational Charter

You assist with a cron-driven crypto trading bot. TypeScript scripts in `src/` execute autonomously via cron — `src/runtime/auto-execute.ts` handles all live entries. Your role: ad-hoc maintenance, strategy iteration, news/black-swan halts, debugging when cron pipeline misbehaves.

**Source layout:**
- `src/core/` — shared infra (db, bybit, telegram, accounts, config, logger, …)
- `src/runtime/` — hot path: `scan-decide`, `auto-execute`, `execute`, `position-watcher`, `reconcile`, `risk-guard`
- `src/reporting/` — `scan-summary` (read-only snapshot)
- `src/bot/` — Telegram bot (`tg-bot`)
- `src/strategies/` — pure strategy logic (VP-SMC etc.)
- `src/backtest/` — engine + `cli/` (active runners) + `archive/` (legacy)
- `src/data/` — backfill, features, Coinglass + `cli/`
- `src/tools/` — utilities split into `db/`, `admin/`, `diagnostics/`, `ops/`

This document is the **inviolable contract**. It is loaded into every cycle. Never violate.

---

## Targets and Constraints

- **Goal:** ≥ 5% / month on starting balance (target, not guarantee). Current OOS evidence supports ~2–3%/month combined; 5% is aspirational.
- **Universe (v3):** BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, BNBUSDT, LTCUSDT, ATOMUSDT, TONUSDT, DOGEUSDT, APTUSDT, ARBUSDT, TAOUSDT, INJUSDT (13 pairs). Bybit perpetual futures, linear. Timeline:
  - 2026-05-12: trimmed 14→11 after week-1 live showed short-only pairs (NEAR/OP/AVAX) bleeding in bull-trend market (combined −$3.7k); ZEC tried, 1 live trade −$1.4k → removed; cap raised 5→6 (11×cap-6 bt: +115%/MaxDD 4.17%); APT/ARB added from candidate pool (per-pair bt 365d: APT WR 92.7%/PF 12, ARB WR 92.9%/PF 14).
  - 2026-05-17 (rotation): regime-decompose audit flagged LINK (−1.72R in trend_bull) and SUI (no preferred regime, 5.93R total) as weak; replaced with TAO (per-pair bt 365d slip 0.25%: WR 80.4%/PF 3.86/+5.87%) and INJ (WR 82.5%/PF 4.79/+5.09%).
  - 2026-05-17 (risk lift): after Coinglass coverage was swapped to active universe (DOGE/TON/APT in, AVAX/LINK/NEAR out) and a 12-hour cooldown-after-SL was added (motivated by the 2026-05-15→16 DOGE-cluster live losses), backtest MaxDD dropped from 4.64% → 2.01% bt @ slip 0.25%. With that buffer in hand, cap was raised 6 → 8 (heat 2.25 → 3.00), then a second step 8 → 10 (heat 3.00 → 3.75). Combined bt @ slip 0.25%, cap-10 + CG + cooldown 12h: +107.53%/13mo, PF 4.04, MaxDD 2.79%. Worst-case stress @ slip 0.40%: MaxDD 3.96% (HyroTrader 5% buffer ~1pp — tighter than cap-8, mind it). cap-10 is rarely binding (6/682 signals blocked) so it's effectively close to no-cap at current volume. Top weekly performers (pre-rotation): DOGE +$5.7k, TON +$2.1k, BTC +$1.7k. Removed pair data retained for re-evaluation.
- **Accounts:** 200k + 50k HyroTrader prop accounts (currently `demoTrading: true`). Trades are broadcast to **every** sub-key inside `accounts.json` via `Promise.all`.

## HyroTrader prop firm rules (non-negotiable)

| Rule | Limit | Action on breach |
|---|---|---|
| Daily DD trailing | −5% from session start | Account terminated by HyroTrader |
| Total DD static | −10% from initial balance | Account terminated by HyroTrader |
| Min leverage | ≥ 10× | Margin requirement |
| Server-side SL | within 5 min of position open | Compliance |

## Risk budget v3 (our internal limits, tighter than HyroTrader)

| Parameter | Value |
|---|---|
| Risk per trade (base) | 0.375% of equity (10×0.375% = 3.75% max heat) |
| Volatility scalar range | 0.7× – 1.2× of base |
| Hard cap per trade | 0.6% of equity |
| Max parallel positions | 10 (one per pair max, across 13-pair universe) — raised 2026-05-17 from cap-8 (and earlier 6→8) after CG+cooldown reduced MaxDD; cap-10 is rarely binding (6/682 signals blocked in bt) — effectively close to "no cap" given current signal volume |
| Total heat cap | 3.75% of equity |
| Soft kill (daily) | −2.5% → flat until next UTC day |
| Hard kill (daily) | −4% → halt + manual review |
| Total kill | −8% → halt + manual review |
| Max SL/pair/day | 2 → pair disabled until next UTC day |
| Funding window | ±10 min around 00/08/16 UTC → skip new entries |

## Inviolable execution rules

1. **Server-side SL within 5 minutes** of every position open. No manual stops.
2. **Edit-never-cancel** SL: to move a stop, use Bybit `amend_order`, never cancel-then-create.
3. **Pre-trade risk check** via `src/runtime/risk-guard.ts` blocks entries that would breach any limit above.
4. **Reconcile before every cycle.** If `trades` DB rows and Bybit positions diverge → halt analysis until aligned (`src/runtime/reconcile.ts`).
5. **No live entry until backtest gate passes:** PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R, ≥ 100 trades combined across the universe on OOS walk-forward. Per-pair expR may dip slightly (e.g. XRP 0.25R) provided combined portfolio metrics stay above gate.

## Architecture: cron-driven (no Claude in hot path)

**Cron handles 100% of execution. Claude is invoked manually, not on schedule.**

```
[cron */5min]  scripts/cycle.sh:
  → reconcile.ts     (auto-close db_without_bybit, sends Telegram exits — every 5min)
  → position-watcher.ts (TP1 detect→no-move SL, naked-TP recovery, drawdown alerts, SL safety-net)
  → heartbeat.ts     (self-throttles to 1/hour)
  → if top-of-hour (HH:00-04):
       → scan-decide.ts   (refresh + enrichment + risk-check, writes /tmp/scan-decide-latest.json)
       → if enterCount > 0:
            → auto-execute.ts (spawns execute.ts per actionable signal)
       → cg-incremental (Coinglass refresh)
```

Why no `/loop /trade-watch` execution: 365d walk-decide proved trade-level filtering on enrichment data is approximately neutral (≈+1.7% lift, mostly variance — algo edge already strong). Cron-direct execute closes a 5–30 min latency gap that previously caused 70%+ of intraday setups to slip past their entry windows.

**Claude's role (manual invocation only, no live execution path):**
- News halt — `/pause` via Telegram bot creates `vault/Watchlist/PAUSE.md` (auto-execute halts while it exists; `/resume` removes it).
- Strategy iteration — backtest re-runs, parameter tuning, universe changes.
- Reconcile escalation — manual investigation when auto-close fails repeatedly.
- Cron pipeline debugging — staleness on `/tmp/scan-decide-latest.json`, `/tmp/auto-execute-latest.json`, `/tmp/cycle.log` (heartbeat surfaces this).
- DOWNSIZE-grade signals (rrTp2 0.20–0.30) — auto-execute leaves them unsized; operator can review and execute manually if desired.

## Classifier — DISABLED (2026-05-03)

Every actionable signal (`action='enter' && riskCheck.allowed`) → TAKE at full 0.375% size. No SKIP/DOWNSIZE filtering.

**Why removed:**
- Backtest cap-6 @ 0.375% delivered +88.45%/365d **without** the classifier.
- Walk-decide showed only ~+1.7% lift, within noise of the full-strategy variance.
- Live trial 2026-05-02 → 2026-05-03: 5/5 actionable signals SKIP'd (rrTp2 hovering at 0.198 — borderline by 0.002). Classifier was rejecting ~all live setups, defeating its purpose.

Discarded rules (already validated harmful at 365d):
- counter-BTC short → +27.58R / 87% WR / 100 trades (this is the strategy's core edge)
- short extension (m15m<32) → +5.01R / 84% WR / 19 trades
- 4H stack contradicts → mean-reversion strategy is counter-trend BY DESIGN

## Cadence discipline

- **5m fire** = trigger engine + regime read. NOT for re-scoring pending limits.
- **15m close** = re-score limits, re-check proactive exits.
- **1H close** = re-evaluate regime, refresh thesis.

**Do not cancel pending limit orders younger than 15 minutes** except for catastrophic events (kill switch, FOMC surprise, exchange outage).

## Forbidden shell patterns (enforced by hooks)

- Heredocs of any shell (`<<EOF`, `<<-`, etc.)
- `node -e '...'`, `python3 -c '...'`
- `"$(cat file)"` and `$(...)` command substitution — Claude Code prompts on every cycle. Use Read tool instead.
- **`$?` exit-code echoes** (`; echo "exit $?"`) — same reason. The npx/tsx tool output already shows success/failure. Just run the command, then use Read tool on the output file.
- **Process substitution `<(...)` and `>(...)`** — Claude Code prompts. Use `cmd > /tmp/out 2>&1; jq ... /tmp/out` instead.
- `--rationale "... $value ..."` with shell-special chars — use `--rationale-file /tmp/r.txt` instead (Write the file first via the Write tool)
- `curl -X POST api.telegram.org` — use `npx tsx src/tools/diagnostics/tg-test.ts` or `src/core/telegram.ts`
- Multi-line `echo "..." >> file` — use the Edit tool

If a new diagnostic is needed, write a committed `src/tools/diagnostics/<name>.ts` and invoke it via `npx tsx`.

## Telegram style (Russian, no slang)

- Allowed terms: вход, выход, стоп, тейк, доход, убыток, размер, риск, регим (диапазон/тренд/переход), пара, аккаунт, ключ.
- Forbidden: лонг (use «покупка» or «вход BUY/LONG в латинице»), фьюч, шорт-сетап, профит, луп, кэш-аут, лонгуем, шортуем.
- Every message: clear *what happened*, *why*, *what next* (or "ничего, ждём").

## Red-flag triggers (immediate alert + pause)

- WR < 40% on last 20 trades
- 4 consecutive losses
- Day P&L within 20% of kill switch (−2% of equity)
- Position held > 24h without TP1
- Reconcile divergence > 1 cycle
- Regime flipped on ≥9 of 13 pairs simultaneously (macro signature)

When any fires: send Telegram alert, trigger `/pause` (writes `vault/Watchlist/PAUSE.md`), do not open new entries until operator confirms.

## What changed vs v2

- Universe set to 10 pairs (BTC, ETH, SOL, XRP, AVAX, BNB, LTC, LINK, NEAR, ATOM) — prior 10-pair v2 was different selection (had OP/SUI/XLM/TAO instead of XRP/LTC/LINK/ATOM); v3 universe rebuilt around VP-SMC strategy validation. Walk-forward OOS: ~90% of windows profitable, 658 combined trades on 1y.
- Risk increased to 0.6% base / 1.0% cap (from 0.5% flat) — operator authorized "чуть больше рисков".
- Strategy v3 = VP-SMC (Volume Profile + PWL/PWH + FVG + Coinglass crowd-fade). Implementation lives in `src/runtime/scan-decide.ts` and `src/strategies/`.
- Postgres (Docker) for historical candle DB — incremental, no daily exchange re-pull. (Redis cache removed 2026-05-16 — wasn't load-bearing.)
