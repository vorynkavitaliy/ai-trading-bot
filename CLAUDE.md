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

- **Goal:** +60–80% / year on starting balance. Живая конфигурация v5 = headline-вариант `validated` (Phase 2, 2026-06-11): **+64.1%/год, PF 1.68, MTM maxDD −8.17%, worst day −2.36%**, обе WF-половины положительные, permutation p=0.000 (`srcNew/backtest/cli/live-policy-experiments.ts`). Откатный вариант (market-вход, `entryOffsetAtr:0`): +52.5%/год, PF 1.50, maxDD −6.92% — работал в лайве 2026-06-10..11.
- **Strategy (v5 cgSlowFade; Phase 2 limit entries 2026-06-11):** портфель `cgSlowFadeV5` (`src/strategies/cg-slow-fade.ts`), per-pair конфиг в `src/runtime/pair-strategies.ts` — **истина = код, не этот файл**. Одно решение на закрытый 4H-бар (латч `decided_anchors`). Сигналы: перцентили Coinglass за 180×4H — L/S Top Position ≥0.95 → SHORT / ≤0.05 → LONG (fade), funding ≥0.95 → SHORT (fade), liq-каскад ≥0.97 → momentum SHORT. CG читается с лагом 1 бакет (`cgReadLagBars=1`). **Вход: отдыхающая ЛИМИТКА на пассивной стороне** (цена ∓ 0.3·ATR; long ниже, short выше), SL/TP якорятся от лимит-цены (SL = 2.0 × ATR(14), TP = 3.5 × ATR, один тейк tp1=tp2), TTL 230 мин (умирает за 10 мин до следующей границы — `src/runtime/entry-ttl.ts`). Trades-строка и maker-TP создаются ТОЛЬКО при исполнении (pendingOnly → промоушен демоном/reconcile); SL прикреплён к самому ордеру. Max hold 12 × 4H (48h) **от момента сигнала** — `src/runtime/max-hold.ts` (5-мин cron).
- **Universe (Tier-1, 4 pairs, 2026-06-10):** BTCUSDT (свои сигналы, риск 1.0%), ETHUSDT (btc-trend гейт, только SHORT, 0.5%), SOLUSDT (btc-signal — fade от позиционирования BTC, 0.5%), XRPUSDT (btc-signal, только SHORT, 0.5%). Истинный источник — `src/runtime/pair-strategies.ts:TIER1_PORTFOLIO`.
- **Archived (enabled:false, быстрый откат):** ADAUSDT, LINKUSDT (standalone-портфель 2026-06-03). Их валидация шла на до-ремонтных CG-данных (frozen-at-open, см. fix 2026-06-10) — перед ре-активацией обязателен повторный прогон на починенных данных.
- **Accounts (2026-05-28):** 4 HyroTrader prop subkeys — 1 × 50k (Ivan) + 3 × 200k (Vitalii, Vera, Andrey). Total equity ~$668k, all `demoTrading: true`. Trades are broadcast to **every** sub-key inside `accounts.json` via `Promise.all`.
- **History:** v3 (VP-SMC) retired 2026-05-23 — backtest engine fixes (intra-bar resolution, D/W bar look-ahead, slip semantics, limit-entry) revealed VP-SMC edge was largely a data-bug artifact. CG-fade portfolio replaced it. See git log around 2026-05-23 for details.

## HyroTrader prop firm rules (non-negotiable)

| Rule | Limit | Action on breach |
|---|---|---|
| Daily DD trailing | −5% from session start | Account terminated by HyroTrader |
| Total DD static | −10% from initial balance | Account terminated by HyroTrader |
| Min leverage | ≥ 10× | Margin requirement |
| Server-side SL | within 5 min of position open | Compliance |

## Risk budget v5 (our internal limits, tighter than HyroTrader)

| Parameter | Value |
|---|---|
| Risk per trade | **BTC 1.0% / альты 0.5%** от стартового баланса аккаунта (`LIVE_RISK_PCT_BTC` / `LIVE_RISK_PCT` в `src/runtime/pair-strategies.ts`). Single entry, без DCA. |
| Max parallel positions | 4 (`risk-guard.ts:20`) = один слот на пару при 4-парном универсуме. |
| Total heat cap | 3.75% of equity (full-deploy v5 = 1.0+3×0.5 = 2.5%) |
| Daily-DD защита | entry-block kill switches ОТКЛЮЧЕНЫ (`dailyKillSwitchesEnabled=false`, 2026-06-03); активная защита — DD-flatten daemon −4.3% от дневного пика (position-monitor). |
| Total kill | −8% → halt + manual review |
| Max SL/pair/day | 2 → pair disabled until next UTC day (с CD 12ч недостижимо легитимно — чистый backstop) |
| Cooldown after SL | 12h on the same pair. **Семантика = бэктест (1:1, 2026-06-11):** только выход по стопу (`exit_reason='sl'` или ≤ −0.9R как страховка от гэпа); ручной/тайм-аут убыток → 4h, как в движке srcNew |
| Cooldown after any close | 4h on the same pair (любое закрытие: TP/time/manual — как в валидированном движке) |
| Decision latch | одно решение на (пара, закрытый 4H-бар) — `decided_anchors`; в strategy-кулдаунах v5 не нуждается |
| Max hold | 48h (12 × 4H) → market-close, `exit_reason='time_stop'` (`src/runtime/max-hold.ts`) |
| Funding window | **Асимметричное (решение оператора 2026-06-10):** блок только 10 мин ДО settlement 00/08/16 UTC; вход сразу после settlement разрешён — валидированная политика `take` (+52.5%/maxDD −6.9% против +40.3%/−9.3% у defer +1h и +23.0% у drop). |

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
  → db-migrate       (idempotent — applies pending migrations/NNN_*.sql)
  → reconcile.ts     (5-min catch-net audit: auto-close db_without_bybit, Telegram exits)
  → position-watcher.ts (legacy cron path — kept during TASK-006 overlap; daemon owns these events sub-second)
  → max-hold.ts      (48h time-stop для v5-позиций от момента сигнала; работает и под PAUSE.md — пауза останавливает входы, не выходы)
  → entry-ttl.ts     (Phase 2: снимает неисполненные лимитные входы старше TTL 230 мин; под PAUSE.md снимает ВСЕ отдыхающие входы)
  → heartbeat.ts     (self-throttles to 1/hour; surfaces daemon-staleness via /tmp/position-monitor-heartbeat.json)
  → if top-of-hour (HH:00-04):
       → cg-incremental (Coinglass refresh ДО scan-decide — upsert, открытый бакет финализируется первым фетчем после закрытия)
       → scan-decide.ts   (refresh + латч decided_anchors + enrichment + risk-check, writes /tmp/scan-decide-latest.json)
       → if enterCount > 0:
            → auto-execute.ts (spawns execute.ts per actionable signal)
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
- **Ad-hoc scan probe: ВСЕГДА `SCAN_LATCH_RECORD=0 npx tsx src/runtime/scan-decide.ts`** — без этого env ручной прогон потребляет якорь латча `decided_anchors`, и сигнал этого 4H-окна будет молча пропущен кроном (auto-execute запускается только из cycle.sh).
- **После изменения кода, который импортирует демон** (`src/runtime/{position-monitor,account-monitor,position-events,trade-closer}.ts`, `src/data/trade-repo.ts`, `src/core/*`): `npm run monitor:stop && npm run monitor:start` — long-running процесс держит старый код в памяти до рестарта.
- Reconcile escalation — manual investigation when auto-close fails repeatedly.
- Cron pipeline debugging — staleness on `/tmp/scan-decide-latest.json`, `/tmp/auto-execute-latest.json`, `/tmp/cycle.log` (heartbeat surfaces this).
- DOWNSIZE-grade signals (rrTp2 0.20–0.30) — auto-execute leaves them unsized; operator can review and execute manually if desired.

## Strategy mechanics (v5 — cgSlowFade, 2026-06-10)

Стратегия: `src/strategies/cg-slow-fade.ts` (`cgSlowFadeV5` factory, класс `CgSlowFade`). Per-pair assignment в `src/runtime/pair-strategies.ts`. Legacy v4 `cg-fade.ts` остаётся для архивных пар (ADA/LINK, enabled:false).

**Setup logic (один проход на закрытый 4H-бар):**
1. CG-чтение с лагом 1 бакет от анкера (`cgReadLagBars=1`): перцентиль текущего значения против 180×4H окна, исключая само значение.
2. Fade: L/S Top Position ≥0.95 → SHORT, ≤0.05 → LONG; funding (OI-weighted) ≥0.95 → SHORT. `btcMode`: `none` (BTC — свои сигналы), `trend` (свои сигналы + гейт по BTC EMA20/50, ETH), `signal` (fade от перцентилей BTC, SOL/XRP). `shortsOnly` режет LONG-ногу (ETH/XRP).
3. Если fade не сработал — liq-каскад: long-ликвидации пары ≥0.97 перцентиля → momentum SHORT (по направлению каскада, НЕ реверсия).
4. SL = `entry ± 2.0 × ATR(14)`, TP = `entry ± 3.5 × ATR` (один тейк, tp1=tp2). Цена входа = close анкера, ордер market.
5. Кулдауны только в risk-guard (12h после SL / 4h после любого закрытия). In-strategy кулдауна нет — его заменяет латч `decided_anchors`.

## Cadence discipline

- **Sub-second** = position-monitor daemon (WS push). TP1, naked-SL, full-close, dust, DCA. NO decision-making.
- **5m fire** = reconcile + position-watcher catch-net + max-hold time-stop. NOT decision-making.
- **1H close** = scan-decide runs (HH:00-04 cron). Латч `decided_anchors` даёт ровно одно решение на закрытый 4H-бар → фактические решения на границах 00/04/08/12/16/20 UTC; входы на funding-границах идут сразу после settlement (асимметричное окно).
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
- ~~`cg-fade.ts` returns `tp1 = tp2` (single target) but `execute.ts` places 2 separate limit orders~~ — RESOLVED: `tp-planner.ts` SingleLimit mode ставит ОДИН reduce-only LIMIT на полный размер при tp1≈tp2 (проверено аудитом 2026-06-10).

## What changed 2026-06-11 (Phase 2 — limit entries)

Операторское GO на возврат лимитных входов: лайв = headline-вариант `validated` (+64.1%/год, PF 1.68). Механика входа: отдыхающая лимитка цена ∓ 0.3·ATR (пассивная сторона), SL/TP от лимит-цены, TTL 230 мин. Marketable-при-размещении лимитка исполняется сразу как taker — ровно first-bar правило движка.

Инцидент-класс 2026-06-04 (фантомные 'open'-строки неисполненных лимиток) закрыт **тройной защитой**:
1. `entry-ttl.ts` (5-мин cron) — снимает входы старше TTL; под PAUSE.md снимает все отдыхающие входы (пауза = никакой новой экспозиции); гонка «исполнилась во время отмены» разрешается в пользу промоушена.
2. risk-guard: занятость пары статусная (нерешённый pending занимает пару TTL+60мин grace, был фикс. 90 мин — дыра в минутах 90..230); отдыхающая лимитка занимает слот cap-4 (паритет с движком).
3. execute: cancel-before-place — снимает чужие нерешённые входы по паре перед размещением нового.

Жизненный цикл: pending_orders при размещении (со strategy + ttl_minutes, миграция 015) → trades-строка ТОЛЬКО при исполнении (pendingOnly; промоушен демоном ≤1с или reconcile ≤5мин) → maker-TP ставится при промоушене (`armTpAfterPromotion`); SL прикреплён к самому ордеру (взводится на бирже в момент исполнения). Неисполнение = отмена БЕЗ кулдауна (паритет: пара ре-сигналит на следующей границе). Max-hold 48ч считается от момента сигнала (`pending_orders.requested_at`), не от исполнения.

## What changed 2026-06-10 (v5 cgSlowFade migration)

**Strategy:** srcNew-research (изолированный честный минутный движок) → live `src/`. Портфель BTC+ETH+SOL+XRP, BTC 1.0% / альты 0.5%, single market entry, SL 2.0 / TP 3.5 ATR, hold 48h. Валидация srcNew: permutation p=0.000, bootstrap P(loss)=0.19%, параметрический куб 27/27, двунаправленный WF OOS +18%/половина.

**Миграционный аудит нашёл и закрыл 4 блокера:**
1. **CG-инжест был заморожен на bar-open снимках** — `coinglass-backfill.ts` использовал `ON CONFLICT DO NOTHING`: каждый 4H-бакет фиксировался первым (частичным) фетчем. Liq-серии стояли на ~0 с мая (мёртвый сигнал + бомба ложных SHORT при заполнении окна нулями). Fix: upsert по PK + полный ре-бэкфилл 360d. Та же болезнь, что убила VP-SMC в 2026-05-23, в зеркальном виде.
2. **Не было латча «одно решение на 4H-бар»** — cron сканирует ежечасно с идентичным анкером; заблокированный сигнал ре-файрился на stale-якоре. Fix: `decided_anchors` (DB) + флаг `Strategy.decideOncePerAnchor`; funding-window блок — единственное исключение (один ретрай +1h; полный дроп этих сигналов режет эдж вдвое: +54.7% → +23.0%).
3. **48h time-stop не существовал в живом рантайме** — бэктест закрывал по времени, лайв держал до SL/TP. Fix: `max-hold.ts` в 5-мин cron, пре-тег `exit_reason='time_stop'` + market-close, скоуп только strategy-trades (ручные позиции оператора не трогаются).
4. **Формирующийся 4H-бар попадал в ATR/EMA** (`b.ts < nowTs` вместо `b.ts+4h <= nowTs`) — стопы систематически на ~5-7% уже валидированных. Fix: только закрытые бары.

**Policy-решения (эмпирика, `srcNew/backtest/cli/live-policy-experiments.ts`):**
- `cgReadLagBars=1` — CG читается с лагом 1 бакет (валидированный информационный сет; свежий бакет ревизится CG задним числом и удваивает maxDD: −12.25% vs −6.92%).
- Funding-window: оператор утвердил `take` 2026-06-10 — окно асимметричное (блок только 10 мин ДО settlement), входы на границах 00/08/16 идут сразу (00:01-04). Альтернативы измерены: defer +1h −12pp/год, drop −30pp/год.
- Ожидаемый живой конверт (market, lag-1, take): **+52.5%/год, PF 1.50, maxDD −6.92%, worst day −2.96%**, обе половины положительные.

**Атрибуция сделок:** `trades.strategy` (миграция 014) — пишется из execute.ts; max-hold и отчётность ключуются по ней.
