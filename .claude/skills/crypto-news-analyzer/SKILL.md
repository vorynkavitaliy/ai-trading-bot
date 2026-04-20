---
name: crypto-news-analyzer
description: >
  Analyze news, geopolitical events, and macro triggers for impact on crypto markets.
  Integrates vault/Watchlist/catalysts.md (forward calendar) and applies the 2-cycle rule.
  Use when scanning news, assessing event impact, or checking if macro conditions affect trading.
  Triggers: "news", "geopolitics", "macro", "Fed", "CPI", "BlackRock", "event impact", "what happened"
user_invocable: true
arguments:
  - name: topic
    description: "Specific topic or event to analyze (optional — omit for general scan)"
    required: false
---

# Crypto News Analyzer

Assess news for crypto market impact with actionable trading implications. Two complementary data sources: the **real-time news block** from scan-summary (last 15-min RSS + CryptoPanic + F&G) and **`vault/Watchlist/catalysts.md`** (forward calendar of known upcoming events).

## When to Use

- Every cycle as part of Phase 1 LOAD VAULT (`catalysts.md` is mandatory read).
- When scan news block shows a fresh trigger.
- Before any 11+/12 entry (check for upcoming catalysts).
- When unusual price action suggests news-driven move.

## HyroTrader Rule (inviolable)

**News-ONLY trading is PROHIBITED.** News is a **sizing and bias modifier**, never a standalone signal. You need structural confluence (≥ 9/12 factors) regardless of the narrative.

## Data sources

### 1. `vault/Watchlist/catalysts.md` — forward calendar

Sections:
- 🔴 IMMEDIATE — within 24h (highest-impact gates)
- 🟡 THIS WEEK — 1-7 days (sizing ×0.5 days, entry blocks)
- 🟢 MONITOR — 7-14 days (context, no action yet)
- ✅ RESOLVED — archived (for postmortem context)

**Maintenance:** when an event resolves → move to RESOLVED with 1-line outcome. Add the next upcoming catalyst. Rewrite block, do not append. This file is refreshed during the 1H-Close Protocol or when a catalyst changes materially.

### 2. Scan-summary news block

Per-cycle fields:
- `bias` — risk-on / risk-off / neutral
- `impact` — high / medium / low
- `risk_multiplier` — applied to sizing (pre-computed by scanner)
- `triggers` — count of Tier 1/2 matches
- `headlines` — last N items (English; translate inline if escalating to Telegram)

## The 2-Cycle Rule

**Do NOT act on a single-cycle news flip.** A single RSS cycle may show a trigger that reverses next cycle (rumor, bot-generated headline, stale crosspost). Rule:

1. Cycle N: news block emits new trigger → **flag it in Journal, do not act**.
2. Cycle N+1: trigger still present (same or reinforced) → **apply sizing / bias effect**.
3. If trigger disappears in cycle N+1 → treat as noise, log, ignore.

**Exception:** Tier 1 events from catalysts.md (pre-known, binary — e.g., FOMC release, CPI print, scheduled binary geopolitical deadline) — apply the catalysts.md rules immediately without the 2-cycle gate, because they are pre-committed.

## Event Classification

### Tier 1 — High Impact
Fed rate decisions, FOMC, CPI/PPI/NFP, SEC major actions, ETF decisions, BlackRock/Fidelity large moves, war escalation/de-escalation, major exchange hacks, sovereign crypto moves.

**Effect:** reduce exposure ×0.25, no new entries 30 min before/after the print.

### Tier 2 — Medium Impact
Crypto-company earnings (COIN, MSTR), protocol upgrades, stablecoin depeg risk, regulatory framework announcements, whale movements >$100M.

**Effect:** ×0.5 sizing, monitor SLs.

### Tier 3 — Low Impact
Partnerships, listings, analyst opinions, social trends.

**Effect:** note for context, no action.

## Stale news filter

If a news trigger references price > 3% from current price (e.g., "BTC crashes to $73k" when BTC is now at $76k) → **score News = neutral, not bearish**. Lesson from 2026-04-19 incident in `vault/Playbook/lessons-learned.md`.

## Bias → direction gating

| News bias | Effect on 12-factor Factor 7 | Entry gating |
|---|---|---|
| risk-off (2-cycle confirmed) | SHORT = 1, LONG = 0 | block LONG, allow SHORT |
| risk-on (2-cycle confirmed) | LONG = 1, SHORT = 0 | block SHORT, allow LONG |
| neutral | both = 1 | no gating |
| stale / >3% from current | both = 1 (neutral) | no gating |

## Workflow

### Step 1 — Read catalysts.md every cycle (Phase 1)
Check 🔴 IMMEDIATE section. If any event within 30 min → block new entries (especially ≥ 10/12 A setups) and tighten SLs on open positions.

### Step 2 — Read scan-summary news block
Note bias, impact, triggers, headlines. Apply 2-cycle rule before acting on any non-catalogued trigger.

### Step 3 — Apply sizing multiplier
Stacking multipliers (news × regime × F&G), but floor at ×0.1:
```
effective_risk = base_risk × news_multiplier × regime_multiplier × fng_multiplier
```

### Step 4 — WebSearch on trigger (Phase 3)
When catalysts.md flags a binary event within 2h, WebSearch for latest read: "{event} today update". Don't summarize headlines — extract the narrative pivot.

### Step 5 — Output

```
## News & Macro — {timestamp}

### From catalysts.md
- Immediate (<24h): {list}
- This week: {list}
- Active sizing effect: ×{multiplier}

### From scan-summary
- Bias: {risk-on/off/neutral} ({first-cycle / 2-cycle confirmed})
- Impact: {high/med/low}
- Fresh triggers: {count}
- Stale filter: {any headlines discarded}

### Trading implications
- Entry gating: {block LONG / block SHORT / open both}
- Size multiplier: ×{value}
- No-trade window: {time range if any}
- Tightening SLs on: {pairs}
```

## Key Principles

1. **News is context, not signal** — inviolable HyroTrader rule.
2. **2-cycle rule** — don't act on single-cycle news flips. Wait for confirmation.
3. **Catalysts.md is pre-committed** — scheduled Tier 1 events bypass 2-cycle and act immediately.
4. **Stale filter** — headlines referencing price >3% off current = neutral, not directional.
5. **Buy rumor, sell news** — most expected events are priced in before print.
6. **30-min buffer** — no new entries around scheduled macro prints.
7. **Geopolitical in every decision** — the forward calendar is part of the rubric, not a separate track.
