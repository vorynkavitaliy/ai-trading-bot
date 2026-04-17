---
name: Session Playbook
description: How I trade each crypto session. Asia / London / NY each have distinct character.
type: playbook
priority: 4
last_revised: 2026-04-17
---

# Session Playbook

> **Crypto is 24/7, but it is not uniform. Each session has its own liquidity profile, its own participants, its own characteristic moves. Trading a New York breakout setup during Asian hours is a path to slow bleeding.**

---

## Session Timeline (all UTC)

| Session | Hours UTC | Hours Kyiv (UTC+3) | Quality Multiplier |
|---|---|---|---|
| **Asian** | 00:00–07:00 | 03:00–10:00 | × 0.85 |
| **London** | 07:00–13:00 | 10:00–16:00 | × 1.0 |
| **NY + London overlap** | 13:00–17:00 | 16:00–20:00 | **× 1.1 (best)** |
| **New York** | 17:00–22:00 | 20:00–01:00 | × 1.0 |
| **Dead zone** | 22:00–00:00 | 01:00–03:00 | × 0.7 — **no entries** |

**My trading window: 07:00 – 22:00 UTC (10:00 – 01:00 Kyiv).** Outside this window: monitoring only, no new entries. Existing positions manage themselves via server-side SL/TP.

**No-entry micro-windows within the trading window:**
- ±10 min around funding (00:00, 08:00, 16:00 UTC) — funding rebalancing distorts order flow
- First 15 min after major scheduled macro prints (FOMC, CPI, NFP)

---

## ASIAN SESSION (00:00–07:00 UTC)

### Character
- **Low volume, narrow ranges.** Accumulation phase.
- **Japan and Korea dominant.** Retail-heavy Japanese participation.
- **Typical range: 0.5-1.5% on BTC.** Alts often quieter.

### What typically happens
- Range expansion rare. Price consolidates.
- Stop hunts happen near previous-day highs/lows as Tokyo opens (00:00 UTC).
- Whale accumulation / distribution — large block trades that foreshadow direction for London.

### How I trade it
- **Quality multiplier 0.85** applies to all confluence scores. A 5/8 in Asian = 4.25 effective → barely qualifies.
- **Prefer range fades** if clear boundaries. Don't chase breakouts — they often fake.
- **Watch for the "Asia trap"** — large liquidation at Asian highs/lows that reverses into London. Clean setup: sweep of Asian high/low + reclaim = London reversal trade.
- **Don't oversize.** Spread is wider, slippage is higher.

### What I avoid in Asian
- Breakout-follow trades (usually fakes)
- Counter-trend plays (no follow-through without London)
- New positions in the last hour (06:00-07:00) — wait for London open

---

## LONDON SESSION (07:00–13:00 UTC)

### Character
- **The manipulation phase.** London open is notorious for stop-runs.
- **Liquidity ramps up.** Europe, Middle East active. Smart-money accumulation/distribution begins.
- **Typical range expansion: 1.5-3% on BTC.**

### What typically happens
- **London sweep** — price runs Asian highs or lows in the first 1-2 hours of London. This is a classic liquidity grab.
- **Reversal after sweep** — if the sweep is rejected (wick with reclaim), the real direction for the day often emerges.
- **Trend establishment** — by 10:00 UTC, the day's character is usually clear.

### How I trade it
- **Best setup: sweep + OB tap + reclaim.** This is my bread-and-butter entry. SL just beyond the sweep wick, target the opposite side of the range or next structural level.
- **Quality multiplier 1.0.** Full-confluence scoring applies.
- **Early London (07:00-09:00)** — be patient. Let the sweep happen. Don't enter before the sweep-reclaim structure.
- **Mid London (09:00-13:00)** — trend trades. Enter on pullbacks to 15M OBs in the direction of the established London trend.

### What I avoid in London
- Fading the first big move of the session (it's usually a trap → real move comes next)
- Trading 1M structure noise — London is fast but 15M/1H still lead

---

## NY + LONDON OVERLAP (13:00–17:00 UTC) — BEST QUALITY

### Character
- **Maximum institutional participation.** US banks, European desks, major funds all active.
- **Highest volume, tightest spreads.**
- **Clearest structural moves.** BOS, OB taps, liquidity runs all have highest follow-through.

### What typically happens
- **Continuation or reversal of the London trend** — the overlap either confirms London's direction (extension) or rejects it (reversal).
- **Clean BOS trades** — breakout-of-structure on 1H/4H with volume = highest-probability trend trades.
- **Macro prints** — most US economic data drops at 12:30 / 14:30 UTC. Price reacts for 30-90 min then resumes structural move.

### How I trade it
- **Quality multiplier 1.1 — the prime window.** I scale up confidence here.
- **A+ setups get full 1.0% risk.** This is where I deploy the extra slots (slots 4-5) if setups justify.
- **Prefer structural BOS + retest** entries. These have best follow-through in overlap.
- **Don't miss it.** If I'm going to take one trade per day, take it in the overlap.

### What I avoid in overlap
- Entering ±10 min around scheduled prints (12:30, 14:30 UTC)
- Shorts into aggressive buying programs (usually visible via consistent green 15M closes on strong volume)
- "Reversion" plays against strong BOS — in overlap, trends have teeth

---

## NY SESSION (17:00–22:00 UTC)

### Character
- **Distribution phase.** US equities close at 20:00 UTC (21:00 summer); after close, volume tapers.
- **Still good liquidity** until ~20:00, then it thins.
- **News-reactive.** Company earnings, late-breaking macro.

### What typically happens
- **Continuation of overlap direction** in the first 2 hours (17:00-19:00).
- **Distribution / profit-taking** by US close (20:00 UTC). Expect some mean-reversion.
- **Low-volume drift or consolidation** in the final hour (21:00-22:00) before dead zone.

### How I trade it
- **Quality multiplier 1.0.**
- **Trend continuations** from overlap still work in first 2 hours.
- **Reduce new entries after 20:00 UTC.** Volume thins, slippage increases.
- **No new entries after 21:30 UTC.** Dead zone approaches; setups triggered then have no one to follow through.

### What I avoid in NY
- Counter-trend plays late in the session (no follow-through in dead zone to close the trade)
- Opening positions that require multi-hour holds late in NY (72h clock is ticking with no liquidity to work against)

---

## DEAD ZONE (22:00–00:00 UTC) — NO ENTRIES

### Character
- **Lowest volume of the 24-hour cycle.**
- Institutional desks closed. Asian desks not yet in.
- **Wide spreads, thin books, manipulation risk.**

### Rule
**NO new entries in the dead zone.** Period.

Exception: none.

### What I do
- Monitor existing positions via server-side orders
- Plan next session
- Write Journal entry for the day
- Update Thesis files based on the day's action

---

## Session-Specific Confluence Weighting

When scoring confluence, I apply the session quality multiplier to the final score:

```
effective_score = raw_confluence_score × session_multiplier
```

| Raw Score | Asian (0.85) | London (1.0) | Overlap (1.1) | NY (1.0) |
|---|---|---|---|---|
| 4/8 | 3.4 → below threshold | 4.0 → structural entry OK | 4.4 → strong | 4.0 → OK |
| 5/8 | 4.25 → marginal | 5.0 → standard OK | 5.5 → strong | 5.0 → OK |
| 6/8 | 5.1 → standard | 6.0 → counter-trend OK | 6.6 → A- | 6.0 → OK |
| 7/8 | 5.95 → strong | 7.0 → A+ | 7.7 → A+ | 7.0 → A+ |

Session multiplier does not block entries below threshold in high-quality sessions — it raises the bar in low-quality sessions.

---

## Post-Session Ritual

At 22:00 UTC (dead zone begin), I write the daily Journal entry:
- What the session character was
- Key setups taken and why
- Key setups passed and why
- Open positions' state
- Tomorrow's watchlist — what I want to see in Asia/London

This is not busywork — it is how tomorrow's context gets preserved.

---

## Key Research References

- `crypto-market-microstructure.md` — session volume profiles
- `stop-hunting-market-traps.md` — London sweep mechanics
- `market-microstructure-flash-boys.md` — overlap institutional flow
- `execution-algorithms-johnson.md` — slippage in thin sessions
