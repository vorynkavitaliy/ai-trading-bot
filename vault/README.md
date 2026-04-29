---
name: Trading Vault
description: Claude's working memory for autonomous trading (v3)
type: root-index
---

# Trading Vault — Claude's Working Memory (v3)

This vault is **Claude's persistent brain** between `/loop` cycles.

Context resets every cycle — but a professional trader does not forget yesterday's thesis, last week's lesson, or the reason a position was opened. The vault is where that continuity lives.

Every cycle Claude:
1. **Reads** the relevant slices to restore operating context.
2. **Thinks** using the Playbook and accumulated lessons.
3. **Acts** on the live market via `npm run execute` (mechanical scan + LLM judgement).
4. **Writes** back — material events to the Journal, frontmatter updates to Trade files, Postmortem after close.

Plain Markdown. Everything versioned via git.

---

## Folder map

### `Playbook/` — The rules I operate by

| File | Purpose |
|---|---|
| `00-trader-identity.md` | Who I am as a trader. Read FIRST every cycle. |
| `strategy.md` | THE strategy. Numeric entry/exit rules. **Empty until Stage 4 finalization.** |
| `lessons-learned.md` | Paid-in-PnL lessons. Append after each Postmortem if non-obvious. |
| `telegram-templates.md` | Russian templates for operator messages. No slang. |

### `Watchlist/` — Forward-looking state

| File | Purpose |
|---|---|
| `catalysts.md` | Auto-updated by `npm run news:fetch` — calendar events ±72h. |
| `zones.md` | Manual structural levels (S/R, weekly opens, etc). |
| `PAUSE.md` | Created when red flags fire — blocks new entries until operator clears. |

### `Thesis/` — Per-pair narrative

`BTCUSDT.md`, `ETHUSDT.md`. Current bias, key levels, scenario tree. Updated when a 1H/4H close materially changes the picture, not every cycle.

**Frontmatter schema:**
```yaml
---
symbol: BTCUSDT
bias: long | short | neutral
timeframe_bias: { "4H": "bull", "1H": "range", "15M": "bull" }
key_levels: { support: [...], resistance: [...] }
invalidation: "4H close below $68k"
updated: 2026-04-29T14:32:00Z
---
```

### `Trades/` — Active and closed positions

`{YYYY-MM-DD}_{SYMBOL}_{LONG|SHORT}.md`. Created by `execute.ts` on open. Updated to `closed` on exit. The full reasoning lives here.

**Frontmatter schema:**
```yaml
---
symbol: BTCUSDT
side: buy | sell
order_type: market | limit
status: open | closed
opened_at: 2026-04-29T14:32:00Z
entry_price: 77580
sl: 77100
tp1: 78340
tp2: 79200
risk_pct: 0.6
total_qty: 0.34
accounts: ["200000/Vitalii=0.27","50000/Ivan=0.07"]
---
```

### `Postmortem/` — Learning from what happened

`{YYYY-MM-DD}_{SYMBOL}_{LONG|SHORT}.md`. Written within 1h of close. Wins AND losses. The goal is to extract a lesson worth adding to `Playbook/lessons-learned.md`.

### `Journal/` — Daily event log

`{YYYY-MM-DD}.md`. Material events + one hourly heartbeat (top of hour ±10 min). NOT every cycle, NOT every scan dump.

After each closed ISO week, `npm run vault:compact` aggregates the dailies into `_weekly/{YYYY-Www}.md` and removes the dailies. Weekly summaries are the long-term archive of journal narrative.

### `Backtest/` — Stage 3.5 Claude Walk artifacts

`queue.json`, `snapshots/`, `decisions/`, `outcomes/`. Created by `npm run walk:prepare` and processed via `/loop 30m /claude-walk-decide`. Reports go to `report.txt`.

---

## Cycle protocol (short)

See `CLAUDE.md` and `.claude/commands/trade-scan.md` for the canonical version.

```
PHASE 0 — RECONCILE         npm run reconcile (blocking)
PHASE 1 — LOAD CONTEXT       Playbook + Watchlist + Thesis + today's Journal
PHASE 2 — GATHER DATA        npm run scan
PHASE 3 — RISK GATE          Check funding window / dead zone / kill switch / heat
PHASE 4 — DECIDE PER PAIR    Apply strategy.md when populated; otherwise SKIP
PHASE 5 — NEWS CHECK         WebSearch on trigger only
PHASE 6 — EXECUTE            npm run execute -- --symbol ... --rationale-file ...
PHASE 7 — PERSIST            Material events → Journal; new open → Trade file; close → Postmortem
```

---

## Principles

1. **Write decisions, not narration.** "Closed ETH SHORT at SL: ADX 22→26 during bar, regime flipped" > "ETH was strong so I closed."
2. **Cite structure and data.** Every claim backed by a level, an indicator value, or a research note.
3. **Update don't accumulate.** A stale Thesis is worse than no Thesis. Rewrite it on regime change.
4. **Short files beat long files.** A sharp thesis in 10 lines beats a meandering one in 100.
5. **Vault is source of truth for WHY.** Bybit is source of truth for WHAT (positions, PnL, fills). Both must agree (`reconcile.ts` enforces this every cycle).
6. **Skipping is a valid answer.** No setup ≠ no decision. SKIP-because-X is a recorded decision.

---

## Compaction policy

| Folder | Compacted? | Notes |
|---|---|---|
| `Playbook/*` | No | Stable rules, hand-edited only. |
| `Watchlist/*` | No | Auto-overwritten on each news fetch. |
| `Thesis/*` | No | Updated in place when bias changes. |
| `Trades/*` | **Never** | Paid memory. Each trade is a permanent record. |
| `Postmortem/*` | **Never** | Same — these are the source of lessons. |
| `Journal/{date}.md` | Weekly | `vault:compact` runs Sunday 23:55 UTC. |
| `Backtest/*` | Never | Frozen artifact of Stage 3.5. |

---

## What changed vs v2

- `entry-rules.md` / `exit-rules.md` / `regime-playbook.md` → unified into `strategy.md`.
- `Watchlist/active.md` → setups live in Journal as material events; `catalysts.md` is forward-looking.
- `archive-vault.ts` (60-day move-to-archive) → `weekly-compact.ts` (Sunday roll-up of dailies into `_weekly/`).
- Universe: 10 pairs → 2 pairs (BTC + ETH).
