---
name: crypto-news-analyzer
description: >
  Analyze news, geopolitical events, and macro triggers for their impact on crypto markets.
  Use when scanning news, assessing event impact, or checking if macro conditions affect trading.
  Triggers: "news", "geopolitics", "macro", "Fed", "CPI", "BlackRock", "event impact", "what happened"
user_invocable: true
arguments:
  - name: topic
    description: "Specific topic or event to analyze (optional — omit for general scan)"
    required: false
---

# Crypto News Analyzer

Assess news and geopolitical events for crypto market impact, with actionable trading implications.

## When to Use

- Every 15 minutes as part of the trading protocol
- When a major event breaks (Fed decision, CPI data, regulatory news)
- Before entering any trade (macro context check)
- When unusual price action suggests news-driven move

## Research Foundation

- `docs/research/fundamental-analysis-crypto.md` — On-chain metrics, protocol fundamentals
- `docs/research/efficient-markets-critique.md` — Behavioral finance, FOMO, herding
- `docs/research/psychology-of-money.md` — Market psychology
- `docs/research/market-microstructure-flash-boys.md` — News impact mechanics

## IMPORTANT: HyroTrader Rule

**News-ONLY trading is PROHIBITED.** News analysis is used as context and confluence factor, NEVER as the sole reason for a trade. Always combine with technical analysis.

## Event Classification

### Tier 1 — High Impact (reduce exposure, no new entries 30min before/after)
- Fed rate decisions / FOMC statements
- CPI / PPI / NFP data releases
- Major regulatory actions (SEC lawsuits, country bans, ETF decisions)
- Large institutional moves (BlackRock, Fidelity, sovereign wealth funds)
- War escalation / de-escalation
- Major exchange hacks or failures

### Tier 2 — Medium Impact (monitor, adjust SL if needed)
- Earnings from crypto-related companies (Coinbase, MicroStrategy)
- Protocol upgrades (ETH upgrades, BTC halvings)
- Stablecoin events (USDT/USDC depeg risk)
- Regulatory framework announcements
- Large whale movements (>$100M transfers)

### Tier 3 — Low Impact (note for context)
- Partnership announcements
- Exchange listings/delistings
- Analyst opinions, predictions
- Social media trends

## Workflow

### Step 1: Source Scanning

Use available tools to scan:
1. **News APIs** (via MCP) — crypto headlines, financial news
2. **Web search** — "crypto news today", "{pair} news"
3. **On-chain alerts** — whale movements, exchange flows
4. **Economic calendar** — scheduled events (Fed, CPI, earnings)

### Step 2: Event Assessment

For each relevant event:
1. **Classify tier** (1/2/3)
2. **Determine direction** (bullish/bearish/neutral for crypto)
3. **Assess timing** — is the impact immediate or delayed?
4. **Check if priced in** — was this expected? Surprise factor?
5. **Identify affected pairs** — which assets most impacted?

### Step 3: Geopolitical Context

Maintain a running geopolitical assessment:
- US-China relations status
- Middle East situation
- Russia-Ukraine status
- Regulatory environment (US, EU, Asia)
- Dollar strength / weakness trend
- Global risk appetite (risk-on / risk-off)

### Step 4: Output

```
## News & Macro Report — {timestamp}

### Geopolitical Context
- Risk appetite: {RISK_ON / RISK_OFF / NEUTRAL}
- Dollar: {STRONG / WEAK / STABLE}
- Key tensions: {summary}

### Active Events
| Event | Tier | Impact | Direction | Affected Pairs |
|---|---|---|---|---|
| {event} | {1/2/3} | {HIGH/MED/LOW} | {BULL/BEAR/NEUTRAL} | {pairs} |

### Upcoming Events (next 24h)
| Event | Time (UTC) | Expected Impact |
|---|---|---|
| {event} | {time} | {impact} |

### Trading Implications
- Exposure adjustment: {increase/decrease/maintain}
- Pairs to avoid: {list}
- Pairs with catalyst: {list}
- No-trade windows: {time ranges}

### Macro Triggers Active
- [ ] Fed decision pending
- [ ] CPI data release
- [ ] BlackRock filing/announcement
- [ ] Regulatory action
- [ ] Geopolitical escalation
```

## Key Principles

1. **News is context, not signal** — never trade on news alone (HyroTrader rule)
2. **Buy the rumor, sell the news** — most events are priced in by the time they happen
3. **Tier 1 events = reduce exposure** — protect capital first
4. **Surprise drives price** — expected events have less impact
5. **Geopolitical context in every decision** — per trading protocol
6. **30-minute buffer** — no entries around scheduled macro events
