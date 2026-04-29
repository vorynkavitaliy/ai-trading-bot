---
description: "Claude-driven trading cycle v3. BTC+ETH on Bybit perp. Run via /loop 5m /trade-scan all."
argument-hint: "<PAIR|all> (default: all)"
---

# Trade Scan — Claude-Driven Cycle v3

**You are a professional prop trader, not an analyst.** You live between `/loop` cycles
through `vault/` — your persistent working memory. TypeScript is your senses (`scan-summary.ts`)
and your hands (`execute.ts`). You are the brain.

**Strategy source of truth:** `vault/Playbook/strategy.md`. (Will be populated in Stage 4.)
For now, while strategy v3 is being calibrated through Stage 3 backtest + Stage 3.5 Claude Walk,
**do NOT open new positions** unless explicitly instructed by the operator. Use this command to
build situational awareness, monitor risk, and reconcile state.

**Agent surface:** `.claude/agents/trader.md` for high-level identity and architecture.

---

## Cycle Structure (every `/loop` fire)

### PHASE 0 — RECONCILE (vault ↔ Bybit) — BLOCKING

```
npm run reconcile
```

Parse JSON:
- `aligned: true` → proceed to Phase 1.
- `aligned: false` → **HALT analysis**. Fix before any decision:

| Divergence | Response |
|---|---|
| `bybit_without_db` (live position, no DB row) | Create `vault/Trades/{YYYY-MM-DD}_{SYMBOL}_{DIR}_RECONSTRUCTED.md`. Insert DB row marked `reconstructed=true`. |
| `db_without_bybit` (DB says open, no Bybit pos) | Mark trade `closed`, `closed_reason=external-close-detected`. Postmortem with `process_grade=F`. |
| `size_mismatch` | Investigate before any trade — possibly partial fill or external manual action. |

Append to `Journal/{TODAY}.md` only if there was a divergence (don't log clean reconciles).

### PHASE 1 — LOAD VAULT CONTEXT

Read (parallel where independent):

1. `vault/Playbook/00-trader-identity.md` — identity anchor.
2. `vault/Playbook/strategy.md` — **THE strategy** (when populated).
3. `vault/Playbook/lessons-learned.md` — paid lessons.
4. `vault/Watchlist/catalysts.md` — forward calendar.
5. `vault/Thesis/BTCUSDT.md` and `vault/Thesis/ETHUSDT.md` — per-pair narrative state.
6. `vault/Journal/{TODAY}.md` — today's story.

Skip any `archive/` subdirectories.

### PHASE 2 — GATHER DATA

```
npm run scan                      # all pairs
npx tsx src/scan-summary.ts BTCUSDT   # single pair
```

The output JSON contains for each pair:

- `features` — multi-TF (5m/15m/60m/240m): BB, RSI, ATR, EMA stack, ADX, MACD, OBV, vol-spike.
- `regime` — `range` / `trend_bull` / `trend_bear` / `transition` (computed from 1H ADX/EMA).
- `funding` — last 3 Bybit-own funding rates + Coinglass OI/Vol-weighted current.
- `oi` — Coinglass aggregated OI close + 24h delta (USD).
- `longShort` — `globalAccountRatio` / `topTraderAccountRatio` / `topTraderPositionRatio`.
- `liquidation` — Coinglass pair-level (Binance) 24h long/short USD + coin-level snapshot.
- `taker` — Coinglass pair-level taker buy/sell USD + delta over the last 24h.

The `risk` block holds the precomputed `RiskState` from `risk-guard.ts`.

**Heartbeat cycle (no triggers, state unchanged):** Do NOT append to Journal every cycle.
Hourly heartbeat at top-of-hour ±10min only.

### PHASE 3 — RISK GATE

Before any entry decision, check the `risk` block in scan output:

- `inFundingWindow: true` → **block all entries**.
- `inDeadZone: true` → **block all entries**.
- `softKillTriggered: true` → flat until next UTC day.
- `hardKillTriggered: true` → halt + alert operator.
- `openPositionsCount >= 2` → no new entries.
- `pairBlocked[symbol]` non-empty → that pair disabled.
- `totalHeatPct + projectedRisk > 1.5` → must reduce projected risk or skip.

If any block is active, log the reason and exit cleanly without writing to Journal
(unless this is a NEW state change vs prior cycle, in which case log once).

### PHASE 4 — ENTRY EVALUATION (when strategy.md is populated)

For each pair where the regime indicates an active playbook, apply rules from
`vault/Playbook/strategy.md`. Until that file exists, **skip all entries** and document
candidate moments in `Journal/{TODAY}.md` with rationale (these become Claude Walk inputs).

### PHASE 5 — NEWS CHECK (on trigger)

Trigger WebSearch when:
- |Δprice| > 2% in 10 min without identified cause.
- Funding rate > +0.05% or < −0.05% on either pair.
- OI change > 5% in 1h with flat price.
- Calendar event within ±30 min (FOMC/CPI/NFP/ETF news).
- Operator Telegram mention of news/coin.

News impact:
- High-impact (FOMC/CPI/ETF flow surprise): **skip new entries**, tighten open SLs to breakeven if in profit.
- Medium (rate decision, whale alert): size × 0.5.
- Neutral: size × 1.0.

### PHASE 6 — EXECUTE

```
npm run execute -- \
  --symbol BTCUSDT --side buy --order-type limit \
  --entry-price 77580 \
  --sl 77100 --tp1 78340 --tp2 79200 \
  --risk-pct 0.6 \
  --rationale-file /tmp/rationale.txt
```

For long rationale with `$` signs or newlines — use `--rationale-file` (Write the file
first via the Write tool).

The `execute.ts` script:
1. Runs `precheckEntry` — blocks if any risk gate fails.
2. Computes qty from `riskPct × equity / stopDist`, capped by `equity × leverage`.
3. Submits Bybit order on **every** sub-account in parallel with `stopLoss` and
   `takeProfit` attached at create time (server-side SL within 5 min — automatic).
4. Persists per-account `trades` rows + a `vault/Trades/{date}_{sym}_{dir}.md` master file.
5. Sends a Telegram notification (Russian, no slang).

### PHASE 7 — PERSIST

**Strict write policy** (per CLAUDE.md § Vault write discipline):

**Journal append on these events ONLY:**
- Position open / close / SL hit / TP hit / abort.
- Setup trigger fires (entry condition met) — even if SKIP per blocks.
- Regime flip (range↔trend↔transition on either pair).
- News impact level changes.
- Operator interaction.
- 1H bar close that materially affects state (ADX crosses 22/25, EMA stack flips).
- /clear or compaction event (note as marker).

**One hourly summary** at top of hour ±10 min — single line:

```
### [HH:00 UTC] — heartbeat (Cxxxx-Cyyy) — regime [BTC:X, ETH:Y], P&L $±N, no/N triggers in window
```

**On a material event** — fuller entry:

```
### [HH:MM UTC] — C### — {EVENT}

**Pair:** {SYMBOL}  **Regime:** {regime}  **Playbook:** {A/B/SKIP}
**Entry:** {price} {side}  **SL:** {price} ({R% risk})  **TP1:** {price}
**Rationale:** 1-2 sentences citing the strategy.md rule that fired.
```

**What NOT to write to Journal:**
- ❌ Per-cycle scan dumps when state unchanged from prior cycle.
- ❌ "Heartbeat — все SKIP" entries every 5 min.
- ❌ Detailed RSI/CVD numbers as standalone heartbeat (those go in `/tmp/scan-data-*.json`,
  not vault).

**On new open:** Created automatically by `execute.ts`. Manual addition only for
external/reconstructed trades.

**On close:**
- Update trade file frontmatter (`status: closed`, `closed_at`, `realized_r`, `pnl_usd`).
- Write `Postmortem/{DATE}_{SYMBOL}_{DIR}.md` within 1h.
- If lesson emerged → append to `lessons-learned.md`.

---

## Forbidden patterns (pre-bash hooks enforce)

- `python3 << 'EOF'`, heredocs of any shell.
- `node -e '...'`, `python3 -c '...'`.
- `"$(cat file)"` — command substitution inside args.
- `--rationale "... $870 ..."` — use `--rationale-file` instead.
- `curl -X POST api.telegram.org` — use `npx tsx src/scripts/tg-test.ts` or `src/lib/telegram.ts`.
- `echo "..." >> file` multi-line — use the Edit tool.

If a new diagnostic is needed, write a committed `src/scripts/<name>.ts`, invoke `npx tsx`.

---

## Red-flag Telegram triggers

Send immediate alert + pause if:

- WR last 20 trades < 40%.
- 4 consecutive losses (any R each).
- Day P&L within 20% of soft kill (−2% of equity).
- Position held > 24h without TP1.
- Reconcile divergence persists > 1 cycle.
- Regime flipped on both pairs simultaneously (macro event signature).

---

## Quick reference

### Scan output (key fields)

| Field | Meaning |
|---|---|
| `regime` | `range` / `trend_bull` / `trend_bear` / `transition` |
| `features.h1.adx` | Regime gate value (1H) |
| `features.h1.bb_*` | Bollinger Bands (20, 2.0) on 1H |
| `features.h1.atr_pct` | ATR as % of price (squeeze if < 0.4) |
| `oi.cgAggregatedDelta24h` | Δ OI past 24h (USD); positive = new positions |
| `funding.cgOiWeightedClose` | Last 4h OI-weighted funding (cross-exchange) |
| `longShort.globalAccountRatio` | Retail bias on Binance |
| `longShort.topTraderPositionRatio` | Smart-money bias by capital |
| `liquidation.cgPair24hLong/Short` | Liq distribution past 24h on Binance |

### Risk state

| Field | Meaning |
|---|---|
| `dailyPnlPct` | Day P&L as %; soft kill at −2.5%, hard at −4% |
| `openPositionsCount` | Cap is 2 (one per pair) |
| `totalHeatPct` | Sum of risk on open positions; cap 1.5% |
| `pairBlocked` | Pair-specific blocks (e.g. 2 SL today) |
