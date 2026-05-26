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

- **Goal:** +60–80% / year on starting balance (validated 2026-05-23 walk-forward — backtest +88%/year on $200k, MaxDD 6.73%, PF 1.53). Realistic OOS expectation 50–70% with degradation.
- **Strategy (v4, 2026-05-23):** CG-fade portfolio — per-pair strategy assigned via `src/runtime/pair-strategies.ts`. Decision cadence 4H (240m). Uses Coinglass percentile signals (L/S Top Position, funding rate, L/S Top Account) faded against pair-trend + BTC macro trend. SL = 1.5 × ATR(14), TP = 2.0 × ATR. Max hold 12 × 4H bars (48h).
- **Universe (Tier-1, 7 pairs):** BTCUSDT, INJUSDT, TAOUSDT, ATOMUSDT, LTCUSDT, ARBUSDT, XRPUSDT. All passed walk-forward (50/50 train/test, both halves positive). Per-pair strategy mapping:
  - **BTCUSDT** → `lsTopPositionFade` + pair trend (S1) — WR 61.5%, sumR +38.16/yr, PF 2.03
  - **INJUSDT** → `lsTopPositionFade` + BTC macro (S2) — WR 55.3%, sumR +19.59/yr
  - **TAOUSDT, ATOMUSDT, LTCUSDT, ARBUSDT** → `fundingFade` pct 0.75 + both trends (S3)
  - **XRPUSDT** → `fundingTaConfluence` pct 0.70 + both trends (S4) — WR 67.7%, PF 2.50 (highest quality)
- **Tier-2 (3/4 quarters, paused):** ETHUSDT, SOLUSDT, DOGEUSDT, BNBUSDT — passed walk-forward but per-quarter consistency lower (3/4 vs 4/4). Consider after Tier-1 stable in live.
- **Excluded (failed walk-forward 2026-05-23):** APTUSDT, TONUSDT — OOS sumR negative. Keep out of universe.
- **Accounts:** 200k + 50k HyroTrader prop accounts (currently `demoTrading: true`). Trades are broadcast to **every** sub-key inside `accounts.json` via `Promise.all`.
- **History:** v3 (VP-SMC) retired 2026-05-23 — backtest engine fixes (intra-bar resolution, D/W bar look-ahead, slip semantics, limit-entry) revealed VP-SMC edge was largely a data-bug artifact. CG-fade portfolio replaced it. See git log around 2026-05-23 for details.

## HyroTrader prop firm rules (non-negotiable)

| Rule | Limit | Action on breach |
|---|---|---|
| Daily DD trailing | −5% from session start | Account terminated by HyroTrader |
| Total DD static | −10% from initial balance | Account terminated by HyroTrader |
| Min leverage | ≥ 10× | Margin requirement |
| Server-side SL | within 5 min of position open | Compliance |

## Risk budget v4 (our internal limits, tighter than HyroTrader)

| Parameter | Value |
|---|---|
| Risk per trade (live trial) | **0.25% of equity** (7 pairs × 0.25% = 1.75% max heat) |
| Risk per trade (post-trial) | 0.5% if live metrics match backtest (WR ~55%, PF ~1.5, MaxDD < 5%) |
| Max parallel positions | 7 (one per Tier-1 pair max — natural cap = universe size) |
| Total heat cap | 3.75% of equity (legacy, room for Tier-2 expansion) |
| Soft kill (daily) | −2.5% → flat until next UTC day |
| Hard kill (daily) | −4% → halt + manual review |
| Total kill | −8% → halt + manual review |
| Max SL/pair/day | 2 → pair disabled until next UTC day |
| Cooldown after SL | 12h on the same pair (survives UTC day boundary) |
| Cooldown after any close | 4h on the same pair (prevents immediate re-entry on TP1/TP2/manual) |
| Strategy cooldown | 6h same-direction (in cg-fade.ts; prevents bouncing on same percentile extreme) |
| Funding window | ±10 min around 00/08/16 UTC → skip new entries |

## Inviolable execution rules

1. **Server-side SL within 5 minutes** of every position open. No manual stops.
2. **Edit-never-cancel** SL: to move a stop, use Bybit `amend_order`, never cancel-then-create.
3. **Pre-trade risk check** via `src/runtime/risk-guard.ts` blocks entries that would breach any limit above.
4. **Reconcile before every cycle.** If `trades` DB rows and Bybit positions diverge → halt analysis until aligned (`src/runtime/reconcile.ts`).
5. **No live entry until backtest gate passes:** PF ≥ 1.4, MaxDD ≤ 4%, expectancy ≥ 0.3R, ≥ 100 trades combined across the universe on OOS walk-forward. Per-pair expR may dip slightly (e.g. XRP 0.25R) provided combined portfolio metrics stay above gate.

## Architecture: cron-driven + sub-second WS daemon

**Two layers handle 100% of execution. Claude is invoked manually, not on schedule.**

```
[systemd: position-monitor.service]  (TASK-006, 2026-05-26)
  src/runtime/position-monitor.ts (long-running daemon, one Bybit V5 private
  WS connection per AccountKey for position/execution/order on linear)
  → TP1 partial fill (≤1s)        → handleTp1Fill (DB + Telegram)
  → Naked-SL detected (≤2s)       → handleNakedSl (amend OR closeAndVerify)
  → Full close (position.size==0) → autoCloseTrade (trade-closer module)
  → Dust (size < 1% × initial)    → closeAndVerify
  → DCA fill (size grew)          → handleDcaFill (TP re-place)
  → 30s REST poll fallback + on-reconnect REST resync
  → /tmp/position-monitor-heartbeat.json every 30s (consumed by heartbeat.ts)

[cron */5min]  scripts/cycle.sh:
  → reconcile.ts     (5-min catch-net audit: auto-close db_without_bybit, Telegram exits)
  → position-watcher.ts (legacy cron path — kept during TASK-006 overlap; daemon owns these events sub-second)
  → heartbeat.ts     (self-throttles to 1/hour; surfaces daemon-staleness via /tmp/position-monitor-heartbeat.json)
  → if top-of-hour (HH:00-04):
       → scan-decide.ts   (refresh + enrichment + risk-check, writes /tmp/scan-decide-latest.json)
       → if enterCount > 0:
            → auto-execute.ts (spawns execute.ts per actionable signal)
       → cg-incremental (Coinglass refresh)
```

Why no `/loop /trade-watch` execution: 365d walk-decide proved trade-level filtering on enrichment data is approximately neutral (≈+1.7% lift, mostly variance — algo edge already strong). Cron-direct execute closes a 5–30 min latency gap that previously caused 70%+ of intraday setups to slip past their entry windows.

### 24-48h overlap migration (TASK-006)

The WS daemon and cron `position-watcher` overlap for the first 24-48h after `npm run monitor:install && npm run monitor:start`. Both run; whichever sees an event first writes to DB. Handlers gate on `tp1_filled_at IS NULL` and `status='open'`, so a double-fire is a no-op for the loser.

Migration steps for the operator:

1. `npm run monitor:install` — copies systemd unit, enables on boot.
2. `npm run monitor:start` — starts the daemon.
3. `npm run monitor:health` — exit 0 means WS connected + heartbeat fresh.
4. `journalctl -u position-monitor -f` — watch for `TP1 fill processed` / `auto-closed trade` log lines during the overlap day.
5. Once daemon has been seen handling at least one real TP1/SL/close event AND `/tmp/cycle-watcher.out` shows `actions: []` for the same events: edit `scripts/cycle.sh` to remove the `position-watcher` block.
6. 2 weeks later: delete `position-watcher.ts main()` if no operator-side need to run it manually.

If the daemon misbehaves: `npm run monitor:stop` halts it. Cron `position-watcher` resumes responsibility within the next 5min tick.

**Claude's role (manual invocation only, no live execution path):**
- News halt — `/pause` via Telegram bot creates `vault/Watchlist/PAUSE.md` (auto-execute halts while it exists; `/resume` removes it).
- Strategy iteration — backtest re-runs, parameter tuning, universe changes.
- Reconcile escalation — manual investigation when auto-close fails repeatedly.
- Cron pipeline debugging — staleness on `/tmp/scan-decide-latest.json`, `/tmp/auto-execute-latest.json`, `/tmp/cycle.log` (heartbeat surfaces this).
- DOWNSIZE-grade signals (rrTp2 0.20–0.30) — auto-execute leaves them unsized; operator can review and execute manually if desired.

## Strategy mechanics (v4 — CG-fade, 2026-05-23)

Strategies live in `src/strategies/cg-fade.ts` (4 factories: `lsTopPositionFade`, `fundingFade`, `fundingTaConfluence`, plus base class). Per-pair assignment in `src/runtime/pair-strategies.ts`.

**Common setup logic:**
1. Compute percentile of CG signal over last 180 × 4H bars (30 days rolling).
2. If percentile ≥ pctHi → **SHORT** (fade extreme crowd long). If ≤ pctLo → **LONG**.
3. Apply trend filter: pair 4H EMA20 vs EMA50 (and/or BTC same).
4. SL = `entry ± slAtrMult × ATR(14)`. TP = `entry ± tpAtrMult × ATR`. Decision is at 4H bar close.
5. 6h in-strategy cooldown (same direction). Risk-guard `cooldownAfterSlHours=12` + `cooldownAfterAnyCloseHours=4` still active.

**Signal sources & pct thresholds per strategy:**
- S1/S2 use `cg.ls_top_position_history` (whale positioning)
- S3 uses `cg.funding_oi_weighted_history` (funding extreme)
- S4 requires BOTH funding + L/S Top Account confluent in same direction (high conviction)

## Cadence discipline

- **Sub-second** = position-monitor daemon (WS push). TP1, naked-SL, full-close, dust, DCA. NO decision-making.
- **5m fire** = reconcile + (during TASK-006 overlap) position-watcher catch-net. NOT decision-making.
- **1H close** = scan-decide runs (HH:00-04 cron). Strategy.decide() polls CG/bars; for 4H-based CG strategies, returns 'hold' unless 4H boundary has just closed → effectively triggers at 00/04/08/12/16/20 UTC.
- **Do not cancel pending limit orders younger than 15 minutes** except for catastrophic events (kill switch, FOMC surprise, exchange outage).

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

## What changed 2026-05-23 (v4 migration)

**Discovery:** 7 days of honest debugging revealed VP-SMC's claimed +120%/year was a data-bug artifact:
- `backfill.ts` previously used `ON CONFLICT DO NOTHING` → weekly/daily bars frozen at first insert (~30s after open)
- Backtest engine `b.ts < cutoff` filter included those frozen bars → strategy used **future full-week H/L** in historical periods (look-ahead bias)
- Without look-ahead, VP-SMC on honest data: −10.74%/year (Fix D')
- Two-layer fix (2026-05-23 commit cd2fce3 + TASK-003 2026-05-24):
  - `engine.ts aggregateHourlyTo` reconstructs the current D/W bar from 1h on the fly — backtest is authoritative
  - `backfill.ts insertCandles` now uses `ON CONFLICT DO UPDATE WHERE ts + tf_duration > now` — DB row for the open period is refreshed every cycle, closed bars are immutable (belt-and-suspenders)
- Investigation: see backtest engine fixes A, B, C, D, D' (intra-bar resolution, TP slip semantics, limit entry, D/W bar reconstruction from hourly)

**Replacement:** CG-fade portfolio. Backtest validated:
- 7 pairs walk-forward 50/50 split: all 7 OOS positive, gap < 0.20
- Engine validation: 511 trades / year, WR 54.8%, PF 1.53, MaxDD 6.73%, +88.88% on $200k
- Live trial started 2026-05-23 at 0.25% per trade

**Live runtime:**
- `src/runtime/pair-strategies.ts` — per-pair strategy assignment (Tier-1 = 7 pairs)
- `src/strategies/cg-fade.ts` — 4 strategy factories (S1/S2/S3/S4)
- `src/data/coinglass-features.ts` — extended with `*_history` arrays for percentile

**Known outstanding issues (to fix):**
- `cg-fade.ts` returns `tp1 = tp2` (single target) but `execute.ts` places 2 separate limit orders. Need true partial split (TP1 = 1× ATR partial, TP2 = 2.5× ATR runner) + re-backtest.
