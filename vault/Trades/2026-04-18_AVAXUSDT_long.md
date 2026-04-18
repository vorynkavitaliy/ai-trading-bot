---
symbol: AVAXUSDT
direction: long
status: closed
opened: 2026-04-18T08:36:15Z
closed: 2026-04-18T08:39:00Z
entry: 9.544
sl: 9.438
tp: 9.701
exit: ~9.535
size_usd: 22713
leverage: 10
risk_r: 0.5
confluence_score: 5
confluence_type: standard
regime: bull
session: london
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: momentum
thesis_snapshot: "AVAX 5/8 Long в Bull regime после 08:15 regime-flip. BTC weakening (L:2 S:3) — contradictory macro."
expected_duration: intraday
closed_reason: proactive-exit
r_multiple: ~-0.15
fees_usd: ~40
pnl_usd: ~-45
note: "Closed после 3 мин. BTC продолжает weakening (L:1 S:4). 4th alt-Bull 5/8 fire → 4th loss. System rightly exited fast."
---

# AVAXUSDT LONG — 2026-04-18 (London +1h 36min)

## Why This Trade (at entry)

4th alt-Bull 5/8 mechanical fire сегодня. Scanner autonomously triggered. Pause-rule (from morning XRP lesson) не применяется — я сейчас flat. Но контекст wary:
1. BTC weakening (L:2 S:3) = bearish macro tilt
2. XRP (6/8), DOGE (5/8) сегодня оба alt-Bull longs → оба убытки
3. Similar setup pattern. Statistical suspicion of chop.

- **Setup type:** momentum 5/8 standard
- **Primary factor:** Bull regime + R:R 1.5 mechanical trigger
- **Confluence (L:5/8 S:4/8):** dir=Long но SHORT ALSO 4/8 (tension). Similar tension to XRP morning.
- **Why this R:R:** SL 9.438, TP 9.701, R:R 1.5 mechanical.

## Entry Context

- **Time:** 2026-04-18 08:36 UTC
- **Session:** London
- **BTC state:** Transitional, L:2/8 S:3/8 (mild bearish)
- **Regime:** Bull
- **Macro concern:** BTC weakening during London = macro headwind на alt-Bull bets.

## Plan at Entry

- **Entry:** 9.544 (market)
- **SL:** 9.438
- **TP:** 9.701
- **Size:** 2380.9 AVAX on 50k (~$22,713 notional)
- **Risk:** ~$250
- **Already -$52 (-0.2R) at fill** — bad start, watch carefully.

## Portfolio conflict

- BNB SHORT limit @ 642.8 pending (age 18m when AVAX fired)
- If BNB fills: hedged portfolio (AVAX Long + BNB Short simultaneously)
- Resolution on fill: compare signals, close weaker.
- Currently: BNB S:6/8 (strong) vs AVAX L:5/8 (weaker). If both fill, close AVAX.

## Life of Trade

### [2026-04-18 08:36 UTC] — Opened
- R current: ~-0.2R (already red on fill)
- Structural: Bull regime but BTC weakening
- Action taken: none

### [2026-04-18 08:39 UTC] — Closed by proactive-exit (3 min duration)
- Mark 9.535, ~-$45 / ~-0.15R
- BTC continued weakening (L:1 S:4). Alt-Bull regime bias too thin to support long entry into bearish macro shift.
- System closed fast — same pattern as XRP this morning.

---

## Close Summary

- **Closed at:** 2026-04-18 08:39 UTC
- **Exit price:** ~9.535
- **Reason:** proactive-exit (signal degradation + BTC bearish macro)
- **R multiple:** ~-0.15R
- **Net PnL USD:** ~-45 (price delta) + ~$40 fees = ~-$85 total
- **Duration:** 3 min

## Immediate Takeaway

**This trade should not have been accepted.** Pattern of today: 5 mechanical alt-Bull fires, 4 losses + 1 scratch:
- XRP 6/8 → -0.3R
- DOGE 5/8 → -0.25R
- BNB 5/8 → ~0 (uncorrelated, не alt-Bull actually)
- AVAX 5/8 → -0.15R (this trade)

**The pattern is clear:** alt-Bull 5-6/8 fires during BTC weakening produce losses. My pause-rule blocks correlated re-entries after open positions, но NOT **post-loss re-entries в same deteriorating macro environment**. Gap in my rules.

→ Full Postmortem: [[Postmortem/2026-04-18_AVAXUSDT_long]]
