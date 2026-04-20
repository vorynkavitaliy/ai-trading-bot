---
date: 2026-04-19
symbol: XRPUSDT
direction: Long
entry: 1.4249
exit: 1.4277
entry_time: 2026-04-19T11:10:00Z
exit_time: 2026-04-19T12:49:26Z
hold_minutes: 99
r_multiple: 0.58
realized_gross_usd: 264.71
process_grade: A-
outcome_grade: B+
closed_reason: news-risk-off-2-cycle-defensive
---

# Postmortem — XRPUSDT Long 2026-04-19

## Summary

First trade of London session 2026-04-19. Opened at cycle C282 (11:10 UTC) on multi-pair bullish reversal signal (9/12 B+ standard). Peaked at +1.24R unrealized (C303, $551.47 total). Never triggered +1.5R trail (peak 1.4310 vs trigger 1.4323 = missed by 13 pts). Consolidated for 35+ min. News bias flipped risk-off at C314 on new Hormuz closure event (WebSearch validated). Closed defensively at C315 on 2-cycle confirmation per trade file invalidation rule. Realized +0.58R avg / +$264.71 gross over 99 min.

## Timeline

| Cycle | Time (UTC) | Event | R avg | Unrealized |
|---|---|---|---|---|
| C282 | 11:10 | Opened 1.4249 (fills 19 pts better than quoted 1.4268) | 0 | $0 |
| C283-C288 | 11:13-11:28 | Grace period → +$257 peak | +0.57R | +$257 |
| C291 | 11:37 | TG hourly heartbeat sent | +0.61R | +$275 |
| C294 | 11:46 | XRP touched 1.4288 break level | +0.65R | +$305 |
| C297 | 11:55 | XRP almost +1R ($356 peak) | +0.78R | +$356 |
| C299 | 12:01 | **+1R MILESTONE CROSSED** (1.4299 broke 1.4288 R) | +1.02R | $459 |
| C300 | 12:04 | BTC slope3 +19.59 session max | +1.17R | $531 |
| C303 | 12:13 | **PEAK $551** (1.4310, +1.24R 200k) | +1.19R | $551 |
| C304 | 12:16 | XRP decoupled от BTC, Iran/Hormuz stale trigger | +0.83R | $369 |
| C307 | 12:25 | Market pullback, BTC -102 pts | +0.76R | $345 |
| C310 | 12:34 | TG hourly heartbeat #2 | +0.53R | $238 |
| C312 | 12:40 | **4H RSI 50.80 critical threshold** close call | +0.22R | $101 |
| C313 | 12:43 | Bounce recovery | +0.39R | $174 |
| C314 | 12:46 | ⚠️ **News bias: neutral → risk-off** (1st cycle). WebSearch validated new Hormuz closure. TG alert. | +0.54R | $240 |
| C315 | 12:49 | **🔴 Risk-off 2-cycle confirmed → DEFENSIVE CLOSE** | +0.58R | $264 |

## Process Evaluation (Grade: A-)

### What went right

1. **Signal identification accurate**: Multi-pair reversal thesis correctly identified at C282. 9/12 B+ standard qualified. Factor scoring was disciplined.
2. **Entry execution excellent**: Fills at 1.4249 vs quoted 1.4268 = 19 pts edge (~$175 bonus across both subs).
3. **Held through noise correctly**: 4 close-call moments (C304, C307, C310, C312) could have triggered panic-exits but structure-based rules said HOLD. Each time bounced.
4. **2-cycle news rule applied correctly**: At C314 (1st risk-off cycle), held per 2-cycle rule — didn't panic. At C315 confirmed → executed defensive exit. Textbook discipline.
5. **WebSearch proactively used**: Verified news trigger wasn't stale at C314. Confirmed real event.
6. **Position management complete**: Journal entries every cycle, trade file milestones at +1R, TG alerts at open/milestone/heartbeat/close.

### What went wrong / lessons

1. **Missed +1.5R trail trigger by 13 pts** (peak 1.4310 vs target 1.4323). This is the biggest cost — would have moved SL to BE and enabled trailing, locking in minimum ~+1R if the trade reversed. Instead watched peak drain from +1.24R to +0.58R over 35 min.
2. **Consider tighter trailing after +1R even below +1.5R trigger**: When peak is within 20 pts of +1.5R trigger AND structure oscillating → protect 50-75% of max R manually. This cycle cost ~$300 of captured but unlocked profit.
3. **Fee reality check**: Realized +$264.71 gross. Two market orders (open + close) on 50k+200k notional ~$130,000 combined = ~$145 in taker fees (~0.055% × 2). Net realized ~$120 after fees. Always factor fees into R calculation on smaller moves.
4. **Didn't score pair-specific SMC strength as 2 (STRONG)**: Factor 1 SMC scored 1 for "bullish BOS only" — but multi-pair + 4H RSI crossings could have been 2 points. Would have made 10/12 A-setup eligible for 0.75% risk. That's 1.5× the capital deployed.

## Outcome Evaluation (Grade: B+)

Positive R outcome, locked gains via defensive exit before thesis fully broke. Not A because:
- Left ~0.65R on table (peak +1.24R vs close +0.58R).
- Exit was defensive, not at TP — didn't realize full thesis potential.

## Key Statistics

- **R multiple**: +0.58 avg (goal was +2R at TP 1.4370).
- **Realized gross**: $264.71 (50k: $51.47 + 200k: $213.24).
- **Realized net estimated**: ~$120 after fees.
- **Hold time**: 99 min (intraday, well within 48h max).
- **Max unrealized**: +$551.47 at C303.
- **Max drawdown within trade**: +0.22R ($101) at C312 — trade NEVER went negative from entry.
- **DD impact on account**: session-peak daily DD 0.19%, well below 5% limit.

## Generalizable Lessons

### New lesson to codify (candidate for lessons-learned.md):

**Peak within trail trigger proximity needs active protection.**
When position peaks at +1.0R–+1.4R (below 1.5R trail trigger) AND subsequent structure shows consolidation/oscillation, consider manual move-sl to breakeven (or +0.3R locked) even before +1.5R trigger. The cost of waiting for exact 1.5R trigger is losing 40-60% of captured gains if momentum cools.

**Candidate rule revision:**
- Current: "Move SL past breakeven only after +1.5R"
- Proposed: "Move SL past breakeven after +1.5R OR after +1.0R if peak held ≥ 3 cycles without progress AND structure starts consolidating (MACD hist peaking, slope3 declining 2+ cycles)."

Cost of this trade's rigid rule: unnecessary $287 drawdown from peak, ~$150-200 realized vs ~$400+ locked.

### Confirmed lessons (validated this trade):

1. **2-cycle news rule works** — C314→C315 risk-off confirmation prevented both panic-exit AND held past stale trigger. Textbook.
2. **Multi-pair confirmation + 4H RSI crossings = legitimate reversal signal** (unlike isolated fake-outs).
3. **Fills are often better than quoted on liquid pairs** — 19 pts edge on XRP.
4. **Structure > noise** — 4H RSI 50.80 close call at C312 did NOT invalidate thesis, bounced at C313 confirming discipline.

## Account Status Post-Close

- **Portfolio**: FLAT.
- **50k equity**: $49622 (DD 0.76% total).
- **200k equity**: $198536 (DD 0.73% total).
- **Total realized today**: +$264.71 gross (~+$120 net after fees).

## Next Action

- Clean up watchlist (remove XRP LONG entry, add new watch if relevant).
- Continue /loop monitoring. News bias risk-off active — no new LONG signals until bias reverts.
- Session transition approaching (London close 13:00 UTC).
