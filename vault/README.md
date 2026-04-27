---
name: Trading Vault
description: Claude's working memory for autonomous trading
type: root-index
---

# Trading Vault — Claude's Working Memory

This vault is **Claude's persistent brain** between `/loop` cycles.

Context resets every cycle — but a professional trader does not forget yesterday's thesis, last week's lesson, or the reason a position was opened. The vault is where that continuity lives.

Every cycle Claude:
1. **Reads** the relevant slices of the vault to restore operating context
2. **Thinks** using the Playbook and accumulated Lessons
3. **Acts** on the live market (mechanical scan + LLM judgement)
4. **Writes** back — updates thesis, logs decisions, records outcomes

The vault is plain Markdown. Everything is versioned via git — every decision, every change of mind, every mistake is auditable.

---

## Folder Map

### `Playbook/` — The Rules I Operate By

Stable documents that codify how I trade. Living — I refine them when experience reveals a new truth, but they do not change per cycle.

| File | Purpose |
|---|---|
| `00-trader-identity.md` | Who I am as a trader. Read FIRST every cycle. |
| `entry-rules.md` | The conditions under which I open a position. |
| `exit-rules.md` | The conditions under which I close. |
| `regime-playbook.md` | What to do in Bull / Bear / Range / Transitional. |
| `session-playbook.md` | Asian / London / NY tactics and expectations. |
| `lessons-learned.md` | Mistakes I have made and vowed not to repeat. |

### `Thesis/` — My Current View On Each Pair

One file per tracked symbol (`BTCUSDT.md`, `ETHUSDT.md`, ...). Continuously updated as the market evolves. My current bias, structural levels I care about, what would invalidate my view.

**Frontmatter schema:**
```yaml
---
symbol: BTCUSDT
bias: long | short | neutral
timeframe_bias: { "4H": "bull", "1H": "range", "15M": "bull" }
key_levels: { support: [...], resistance: [...] }
invalidation: "4H close below $68k"
updated: 2026-04-17T14:32:00Z
---
```

### `Watchlist/active.md` — Setups I'm Waiting For

Specific conditions I am hunting. "If SOL sweeps 82 and reclaims — I long."
Once a setup triggers or invalidates, it is moved out of this file.

### `Journal/` — Daily Log

One file per trading day: `YYYY-MM-DD.md`. The narrative of the day — news, regime, key decisions made, mood of the market. Written by Claude continuously through the day.

### `Trades/` — Active And Closed Positions

One file per trade: `YYYY-MM-DD_SYMBOL_DIRECTION.md`. Created when I open a position, updated as it evolves, archived when closed. Not just numbers — the REASONING behind the trade.

**Frontmatter schema:**
```yaml
---
symbol: BTCUSDT
direction: long
status: open | closed
opened: 2026-04-17T14:32:00Z
closed: null
entry: 68420
sl: 67200
tp: 71000
size_usd: 5000
risk_r: 0.5
confluence: 6
regime: bull
thesis_snapshot: "4H OB + 1H sweep + BTC bull"
closed_reason: null
r_multiple: null
---
```

### `Postmortem/` — Learning From What Happened

After a trade closes, a postmortem is written analyzing what actually happened vs. what I expected. Wins AND losses. The goal is to extract a lesson that updates `Playbook/lessons-learned.md` if meaningful.

### `Research/` — Methodology Library

Symlink to `.claude/docs/research/` — 35 source books on market theory, SMC, technical analysis, algorithmic trading, ML, risk, crypto microstructure. I cite these directly when my reasoning leans on a specific methodology.

---

## The Cycle Protocol

See `CLAUDE.md` → `THE TRADER — Operating Protocol` for the canonical rules.

Short version, every `/loop 3m /trade-scan` fire:

```
PHASE 1 — LOAD CONTEXT (read)
  • Playbook/00-trader-identity.md          (who I am)
  • Playbook/lessons-learned.md             (what I must not repeat)
  • Thesis/{SYMBOL}.md                      (my current view)
  • Watchlist/active.md                     (what I am hunting)
  • Journal/{TODAY}.md                      (today's story so far)

PHASE 2 — GATHER DATA
  • npm run scan (mechanical: prices, indicators, confluence)
  • MCP Bybit tools if needed (orderbook, ticker)
  • WebSearch on 15-min cycle (macro, news)

PHASE 3 — THINK (as trader, not analyst)
  • Does my thesis still hold? Has something changed?
  • Is a watchlist setup now active?
  • Are open positions still valid?
  • What does the Playbook say about this regime/session/structure?

PHASE 4 — ACT
  • Open / close / adjust via executor (all accounts, Promise.all)

PHASE 5 — PERSIST (write back)
  • Update Thesis/{SYMBOL}.md if view changed
  • Append to Journal/{TODAY}.md — decisions + reasoning
  • Create Trades/{...}.md on new open
  • Update Trades/{...}.md frontmatter on close + create Postmortem/
  • If a non-obvious lesson emerged: append to Playbook/lessons-learned.md
```

---

## Principles

1. **Write decisions, not narration.** "I closed ETH because 1H BOS invalidated thesis" > "I was watching ETH and then it moved."
2. **Cite structure and data.** Every claim backed by a level, a level-of-structure, or a research source.
3. **Update don't accumulate.** A stale Thesis is worse than no Thesis. Rewrite it.
4. **Short files beat long files.** A sharp thesis in 10 lines beats a meandering one in 100.
5. **The vault is the source of truth for WHY.** Bybit is the source of truth for WHAT (positions, PnL). Both must agree.

---

## Archive workflow (introduced 2026-04-27)

**Why:** Pre-2026-04-27 the active `Journal/` directory grew to 2.7MB (80% of vault) because every 5-min cycle wrote a heartbeat section. Now: only material events go to Journal (see CLAUDE.md § Vault Protocol § Write on material events ONLY). For files that DO accumulate (Trades/, Postmortem/, daily Journals), periodic archive keeps the working directories small.

**How:** `npx tsx src/archive-vault.ts --days 60` moves files older than 60 days from `Journal/`, `Trades/`, `Postmortem/` into `{dir}/archive/{YYYY-MM}/` subdirectories.

**Cadence:** monthly. End of month or whenever working dir feels cluttered.

**Procedure:**

1. **Preview:** `npx tsx src/archive-vault.ts --days 60 --dry-run` — see what would move.
2. **Apply:** `npx tsx src/archive-vault.ts --days 60` — actually move files.
3. **Verify:** `git status` — confirm moves are tracked as renames.
4. **Commit:** `chore(vault): archive {YYYY-MM} files older than 60d` — single dedicated commit.

Archived files stay in git history. They're moved, not deleted. To browse old content: `vault/Journal/archive/2026-04/2026-04-17.md` etc.

**Templates and index files** (`_template.md`, `_index.md`, anything starting with `_`) are never archived — they're working files.
