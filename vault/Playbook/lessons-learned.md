---
name: Lessons Learned
description: Accumulated wisdom from my own trades. Each lesson is paid for in P&L. I never repeat them.
type: playbook
priority: 5
last_revised: 2026-04-17
---

# Lessons Learned

> **Every entry in this file cost me money. Most are losses; some are wins I nearly surrendered. I reread this file after losing streaks, before taking exceptions, and when the market feels like it's asking me to break a rule.**

---

## How This File Works

After every closed trade — especially losses, but also wins with notable features — I extract a lesson and decide whether it belongs here.

**Lesson belongs in this file if:**
- It contradicts my natural instinct (my instinct is unreliable)
- I've violated it more than once
- It saved or could have saved meaningful P&L
- It generalizes beyond a specific trade

**Lesson does NOT belong here if:**
- It's specific to one setup and already captured in Playbook entry/exit rules
- It's a rediscovery of something already in this file (instead, add a date-stamp to the existing entry)
- It's an outcome I can't separate from luck (don't learn from noise)

### Entry format

```markdown
## [YYYY-MM-DD] — Short rule statement

**Context:** one sentence on the situation that produced the lesson.
**What I did:** what I actually did (usually wrong).
**What I should have done:** what the rule says.
**Why it matters:** the generalizable principle.
**Tags:** `[category]` `[category]`
```

**Tag vocabulary:**
- `[ego-hold]` — held a loser past the rule
- `[fomo]` — entered because I couldn't sit out
- `[oversize]` — sized bigger than the rule
- `[news-react]` — traded the headline without structure
- `[session-misread]` — wrong session playbook applied
- `[regime-misread]` — wrong regime playbook applied
- `[tp-greed]` — moved TP farther mid-trade
- `[sl-widen]` — widened SL to avoid loss
- `[correlation-blind]` — took 3 correlated positions, one direction
- `[counter-btc]` — alt trade fighting BTC direction
- `[dead-zone]` — entered in the no-entry window
- `[funding-clip]` — entered within funding window
- `[win-learned]` — win that generalizes into a rule

---

## Lessons

### [2026-04-17] — Server-side SL/TP orders survive cron outages — that's their entire point

**Context:** At 12:31 UTC the /loop cron went offline for ~1.5 hours (unknown cause; resumed at 14:00 UTC). During that window, BNB and XRP LONG positions were both open with server-side reduce-only Market orders at TP triggers. During the outage, mark pushed through both TPs: BNB 635.3 (TP 635.5), XRP 1.4625 (TP 1.4622). Both positions closed autonomously. Realized: **BNB +$397.26 (+1.46R) + XRP +$885.59 (+1.42R) = +$1282.85 combined during the outage**. I discovered the closes only when cron resumed and reconcile flagged vault-without-bybit divergences.
**What I did:** Nothing during the outage (couldn't — no cron). When cron resumed, audit + getClosedPnL confirmed the positive outcomes. Wrote close-outs and postmortems.
**What I should have done:** Exactly what I did: trusted the server-side orders. If I had been running mental stops, or Claude-monitored-only SLs, the 90-minute outage + breakout continuation would have likely pulled back to entry/SL and given back all gains (or worse).
**Why it matters:** Automation will fail. The ONLY thing standing between thesis and unbounded outcome is the order sitting on the exchange. Today's outage was benign (TPs hit favorably). Tomorrow's outage might coincide with a flash crash, a liquidation cascade, a news shock. The server-side SL is the trader's insurance policy. **Every position must have server-side SL within 5 minutes of opening — not client-side, not mental, not Claude-monitored.**
**How to apply:** This rule is already in `00-trader-identity.md` and `CLAUDE.md` inviolable rules. This incident is operational vindication: the rule works exactly as designed under failure conditions. Never even consider relaxing it.
**Tags:** `[win-learned]` — operational resilience of the safety-rails framework.

### [2026-04-17] — Post-loss categorical re-entry blocks in theses cost paid opportunities

**Context:** After closing XRP LONG -0.39R at 10:34 UTC, thesis was rewritten with "no re-entry on score-flicker" (a categorical block). Scanner then re-triggered XRP at 11:01 and 11:06 UTC (auto-re-opened positions on mechanical 5/8 + R:R 1.5 trigger). Both times I reflex-closed manually to enforce the categorical block — cost ≈$0 each time (entry=mark) but burned spread/effort. Operator at 11:08 UTC pushed back: "why torture XRP? stop burning spread on reflex closes; trust the scanner." Thesis was rewritten to remove the categorical block and keep only STRUCTURAL exits. Scanner re-triggered AGAIN at 11:13 UTC — I ACCEPTED it this time. That trade closed at 13:XX UTC by server-side TP for **+1.42R / +$885.59**.
**What I did:** Accepted operator correction, removed the categorical block from the thesis, let the 11:13 entry run managed only by structural rules. Outcome: +1.42R.
**What I should have done:** Exactly this. Had I held the categorical block, the 11:13 entry would have been reflex-closed like the two before it — forfeiting the +$886 win.
**Why it matters:** Post-loss avoidance is a real psychological pull, but encoding it as a CATEGORICAL thesis rule turns legitimate opportunity into guaranteed spread-burn. Structural rules (score-based, price-based, volume-based) are signal-driven; categorical rules ("never this pair again today") are identity-driven. The distinction: structural rules close a trade when conditions say so; categorical rules close a trade regardless of conditions. The mechanical system generates entries from conditions, so only structural rules interact with it coherently.
**How to apply:** After a loss on a pair, DO NOT write "no re-entry" into the thesis. DO write:
- "Close if SHORT score ≥ X" — structural reversal trigger
- "Close if price breaks below $Y" — structural level trigger
- "Close if LONG < X/8" — structural confluence floor
All of these are symmetric: they gate both NEW entries and EXISTING positions. Categorical blocks are asymmetric — only block new entries, providing no risk management for existing positions. Use structural exclusively.
**Tags:** `[win-learned]` `[counter-btc]`-inverse (not counter-BTC, but counter-own-system which is the analogue).

### [2026-04-17] — Telegram reporter emits phantom "opened"/"closed" events with fabricated PnL

**Context:** At 12:04:44 UTC scanner placed a LINK LIMIT order @ 9.405 (pending, no fill). Telegram reported "Открыта позиция LONG LINKUSDT entry 9.405" as if it were a filled position. At 12:07:42 UTC Telegram reported "Сделка завершена LINKUSDT LONG, Вход 9.468 → Выход 9.282, +$2421.79 / +3.87R, duration 2m 57s". Direct Bybit audit at 12:08 showed: LINK limit @ 9.405 still live age 4m (NEVER filled), 0 LINK positions ever opened, 0 LINK closedPnL history, mark ~9.45 (nowhere near the claimed 9.282 exit). The entire "close" message was fabricated.
**What I did:** Verified via `src/audit.ts` + `src/check-avax-close.ts` that the Telegram reports did not reflect Bybit reality. Flagged to operator. Kept real positions (BNB, XRP) untouched.
**What I should have done:** Exactly this. Never trust a Telegram message over a direct Bybit audit.
**Why it matters:** If I had acted on the fake "+$2421" close — e.g. re-opened LINK thinking it was flat, or celebrated a phantom win in Journal — I'd have corrupted vault state AND risked double-exposure if the real limit later filled. The Telegram/reporter layer is NOT a source of truth for positions/PnL; it's a projection that has drift.
**How to apply:**
- **Bybit API is the only truth for positions and closedPnL.** Use `src/audit.ts` + closedPnL query. Not reconcile (still missing orders data), not Telegram, not scanner banner.
- **Telegram "opened" on LIMIT placement is misleading** — mental model: "placement" ≠ "filled". Treat Telegram "opened" as "order submitted, awaiting fill" until audit confirms fill.
- **Telegram "closed" with R-calculated PnL is suspicious** when an actual fill/close didn't happen. Large round-R multiples (3.87R, 5.0R) correlate with hypothetical calculations rather than measured realized gains.
**Code fix (for operator):** Rewrite Telegram reporter to (a) only emit "opened" on confirmed position fill (getPositionInfo check, size>0), (b) emit "closed" only when reading from getClosedPnL with an actual record within the last ~60s. Remove the calculated-R path from "closed" messages — always use realized closedPnL from Bybit.
**Tags:** (operational) + telegram-reporter bug.

### [2026-04-17] — When discretionary and mechanical exit rules disagree, honor the TIGHTER one for open profit

**Context:** AVAX LONG 11:13-11:31 UTC. Entered at SHORT 4/8 (my own proactive-exit threshold), so I explicitly tightened my thesis rule to "SHORT ≥5/8 → close" as an acknowledgement that a tighter rule would immediately close the trade. At 11:31 UTC with +0.95R unrealized, the TypeScript mechanical layer's SHORT ≥4/8 rule fired first and closed at 9.654 → **+0.84R realized ($534.99)**. Scanner immediately after close confirmed SHORT stayed 4/8, R:R dropped to 1.04 — a re-opening was impossible. The tighter rule protected +0.84R that the looser rule would have bled back toward entry.
**What I did:** Did not interfere. Let the mechanical layer close per its own threshold. Logged close + wrote postmortem within 5 min.
**What I should have done:** Exactly this. The TypeScript 4/8 rule IS the one-brain-consistent-logic principle encoded. Overriding it at +0.95R with "almost +1R, let TP take it" would have been tp-greed.
**Why it matters:** Profit-locking moments are exactly where "let it run one more cycle" thinking destroys edge. A mechanical rule that fires at the statistical turning point captures the peak of the move. The discretionary rule, by virtue of being looser, arrives late. Honor the tighter one on exits.
**How to apply:** When opening a trade where discretionary rules are tighter than mechanical (e.g. my "+1R BE-trail"), trust those on the tighten side. When holding a trade where mechanical rules are tighter than discretionary, trust the mechanical side to close. NEVER override a firing mechanical exit rule with a "one more cycle" discretionary note. One-way trust: tighter rule wins on exits.
**Tags:** `[win-learned]` — process-win that captured peak profit.

### [2026-04-17] — Orchestrator auto-opens positions against discretionary re-entry blocks written in theses

**Context:** At 10:34 UTC I closed XRP LONG at -0.394R with an explicit thesis rewrite: "No re-entry on signal ticked back to 5/8 — scoring alone is insufficient to re-enter after a recent loss on the same pair." 27 minutes later (11:01), the scanner's mechanical trigger (5/8 + R:R 1.5) fired and the orchestrator auto-opened XRP LONG @ 1.437 — 0.15¢ above my close, same structural zone. No structural catalyst had formed (no 1H sweep-reclaim of 1.40919 bid wall, no break+hold above 1.45 seller cluster). Score simply oscillated back up.
**What I did:** Closed at market within ~1 min via `close-now.ts`. Cost: ~$0 realized (entry=mark at trigger cycle). Documented as `Trades/2026-04-17_XRPUSDT_long_REVENGE-REJECTED.md`.
**What I should have done:** Exactly this, with the current system. But the deeper fix is that the orchestrator should not have opened the position in the first place.
**Why it matters:** The scanner is mechanical; the trader is discretionary; theses codify discretionary state. Every time the scanner opens a position the trader has explicitly forbidden, the trader must intervene manually — and one missed intervention cycle = real PnL damage. On a less-favourable tick this auto-re-entry could have filled at a worse price inside the seller cluster, immediately bleeding -0.5R+ before I could close.
**How to apply (immediate, no code fix):** At the top of every `/trade-scan` cycle, after Phase 0 reconcile, cross-check each `exec=true` signal against the corresponding `vault/Thesis/{SYMBOL}.md` `bias` field. If `bias: neutral-post-loss` OR the invalidation note contains "re-add only on structural catalyst" OR equivalent — the trader closes at market regardless of the mechanical fill.
**Code fix required (prioritised):** Option A (cheap, robust) — orchestrator reads `vault/Thesis/{SYMBOL}.md` frontmatter before placing; blocks if `bias in ['neutral-post-loss', 'do-not-trade']`. Option B (generic) — Redis key `recentClose:{SYMBOL}` with 120-min TTL, set on every close; orchestrator blocks while key exists. Option B is simpler but coarser; Option A respects the full discretionary model.
**Tags:** (operational) + `[ego-hold]`-inverse — this is the OPPOSITE failure mode: an automated system taking a trade I had already decided not to take.

**Update 2026-04-17 11:07 UTC:** Second re-execution of the same pattern within 5 minutes of the first. Size DOUBLED on retry (4528.9 → 8064.5 qty). This is now a repeating loop that will fire every 3-min cycle until market scores drop below 5/8 OR a code fix lands. Urgency is elevated: on a less-favourable tick window, the second auto-open already delivered -$0.80 unrealized at fill; a third cycle with further size growth could translate to measurable losses before the next manual close. Operator intervention escalated.

### [2026-04-17] — Pre-commit invalidation rules in rewritten theses — they eliminate hesitation at the trigger

**Context:** XRPUSDT LONG (reconstructed position, inherited at 08:36 UTC). At 10:12 UTC I did a deep LLM read, saw the entry was structurally inside the 1.45+ seller cluster, and rewrote the thesis with a hard rule: "LONG drops <4/8 → direction loss → close." At 10:33 UTC — 21 minutes later — LONG collapsed 5/8 → 3/8 in one cycle. The rule fired; I executed close-at-market immediately without deliberation. Realized -0.39R vs. potential -0.77R at bid wall or -1R at inherited SL.
**What I did:** Honored the pre-committed rule the moment it triggered. No "wait one more cycle to confirm." No "maybe it'll come back." Just the rule.
**What I should have done:** Exactly this. The value of writing hard invalidation rules under pressure is that the present-me binds future-me, and future-me doesn't need to re-derive the logic in the moment of stress.
**Why it matters:** Discretionary exits at moments of adverse move are where traders bleed edge — hesitation, rationalization, hope. A pre-written rule with explicit triggers converts the decision into a binary automaton. This trade is operational proof that the pattern works: thesis rewrite at cycle N, automatic exit at cycle N+7 at exactly the level I wrote.
**How to apply:** When rewriting a thesis under pressure (price moving against you, new structural info), include at least ONE hard exit condition that is mechanical (confluence score, price level, opposite-signal score). Write it to be executed, not to be hoped around. On the next trigger test, execute first and reflect afterwards.
**Tags:** `[win-learned]` (process-win on an outcome-loss)

### [2026-04-17] — Orchestrator stacks pending limits; check pending orders before any auto-entry

**Context:** 09:18 scan auto-placed AVAX limit at 9.548. At the next scan (09:21) the same trigger fired again — AVAX still 6-7/8, R:R 1.41 cleared the 7/8 A+ threshold of 1.3. A second (and third!) limit order was placed at the same price. Before I spotted it, 4 orders stacked on 50k (3473.9 qty) and 4 on 200k (13895.9 qty) — ~6× intended 0.5% risk per trade.
**What I did:** Cancelled all 8 orders via `cancelAllOrders` on both subs. Verified clean state. Updated trade file status to `cancelled-operator`.
**What I should have done:** The orchestrator should block new entries when pending-but-unfilled limits exist on the same symbol. The current `hasExisting = allPositions.some(p => p.positions.length > 0)` check in `src/orchestrator.ts:191-194` only inspects filled positions, missing pending limits.
**Why it matters:** Even a single cycle of stacking = a rule breach. 6 cycles of stacking (at 3 min each = 18 min) = potential instant DD violation if the limit fills. The risk is unbounded until a fix lands.
**Operational workaround until code fix:** After every /trade-scan cycle, if scanner output shows `✅ exec=true` on a symbol that already has a pending limit (check via the getActiveOrders API), the operator MUST cancel extras, keeping only the first. Easier: cancel all and let the NEXT cycle re-enter with exactly one order.
**Code fix required:** Extend the orchestrator's entry guard from `hasExistingPosition` to `hasExistingPositionOrOpenLimit` — query `getActiveOrders({ category, symbol })` in parallel with `getAllPositions` and block if either has entries.
**Tags:** `[oversize]` (via stacking) + operational bug.

### [2026-04-17] — Every /loop cycle MUST verify Bybit–vault alignment before analysis

**Context:** At 08:36 UTC scan, discovered an XRPUSDT LONG position open on both accounts (entry 1.4633, size 713.2 / 2853 XRP, 3× leverage) with zero vault record. The position had been running through multiple prior cycles, invisible to me because no trade file, thesis note, or journal entry referenced it. It only surfaced when XRP confluence lifted past 5/8 and the scanner reached the "position already open" filter.
**What I did:** Spent 5 cycles (08:13 → 08:33) doing thesis/watchlist/entry analysis as if XRP was neutral/watching, when in fact a real Long position was bleeding -0.26R in the background.
**What I should have done:** First action of EVERY cycle = run a Bybit positions check (via scan output or `check-positions.ts`), cross-reference against `vault/Trades/` open files. Zero tolerance for divergence. Reconcile before any other decision-making.
**Why it matters:** Vault-market divergence is the exact failure the CLAUDE.md safety rails and vault protocol warn against ("Bybit is truth for WHAT; vault is truth for WHY. Both must agree — reconcile every cycle."). A blind position is an ungovernable position — I cannot apply proactive-exit or management rules to something I don't know exists.
**Operational fix:** Every Phase 1 should add a Bybit positions probe. If positions found that aren't in `vault/Trades/`, halt Phase 3+ until reconciliation is written.
**Tags:** (operational) — does not fit the vocabulary, but this is the most important operational failure the vault can produce.



*Seed reminders from pre-accumulated feedback memory (will be consolidated into this file over time):*

### [2026-04-16] — TP Sizing in Range Markets

**Context:** Range market on ETHUSDT, 1H boundaries clear at $1580–$1640.
**What I did:** Set TP at fixed 3:1 R:R → target at $1720, way outside the range.
**What I should have done:** Set TP at opposite range boundary ($1640 from $1580 long) = 1.7R realistic target.
**Why it matters:** Demanding 3R in a 4% range means every winning trade reverts to breakeven before TP. R:R must respect the terrain.
**Tags:** `[tp-greed]` `[regime-misread]`

### [2026-04-16] — Trading Day Structure

**Context:** General observation across the first weeks of operation.
**What I learned:** Intraday trades resolve cleanly; multi-day holds accumulate funding and get whipsawed by news. Session awareness matters more than I initially weighted.
**How it applies:** Default to intraday exits. Use the 48h cap only for genuine swing setups with clear 4H structure. Most positions should be closed by the end of the session they were opened in.
**Tags:** `[win-learned]` `[session-misread]`

### [2026-04-16] — Slot Replacement Over Queueing

**Context:** All 5 position slots full, new high-confluence signal appeared.
**What I learned:** Better to close the weakest open position (lowest confluence, worst R progress) and open the new one than to pass on the new signal. Position quality must be maximized, not position count.
**How it applies:** When all slots full AND new signal > weakest open position's original confluence score → replace.
**Tags:** `[win-learned]`

### [2026-04-16] — Inter-Terminal State

**Context:** Multiple terminals, same pair, race condition on Redis.
**What I learned:** Shared state (positions, heat, kill-switch) must be consulted BEFORE any open/close decision. Never trust per-terminal memory.
**How it applies:** Every cycle reads Redis state first. Every open/close writes Redis immediately.
**Tags:** (operational, not a tag from the vocabulary)

### [2026-04-16] — Telegram Report Frequency

**Context:** Spam of full reports every 3 min drowned out actionable alerts.
**What I learned:** Full reports max 1×/hour. Every cycle only emits alerts on state change (new position, SL hit, regime flip).
**How it applies:** Reserve full reports for hourly cadence; event-driven alerts for in-between.
**Tags:** (operational)

---

## Anti-Patterns To Re-read Regularly

These are the patterns that have produced MOST of my worst trades (based on literature and general pro-trader consensus — will be specialized to my own data over time):

1. **Widening the SL as price approaches it.** This is the single most destructive habit. If I feel the urge, I close at current price instead.

2. **Adding to a loser to "reduce average entry."** This doubles my exposure to a thesis that is already failing. I either close or hold; never add.

3. **Entering just because I haven't traded today.** A day of no trades in the wrong conditions is a successful day. Boredom is not a signal.

4. **Trading against BTC 1H direction on altcoins.** BTC leads. Multi-TF factor = 0 when BTC 1H is against me; the trade is near-automatically disqualified.

5. **Ignoring dead zone / funding windows.** The rules are there because order flow is distorted. Every exception I've ever considered has been worse than waiting.

6. **Reading into news to justify a trade I already want.** News is a filter, not a trigger. I check news for invalidation, not for confirmation.

7. **Re-entering a trade I just got stopped out of without reanalysis.** The market moved; my structure levels may have changed; what invalidated the first entry may still be invalidating the second.

8. **Trading when tired / distracted / emotionally off.** (For the human operator reading this: this applies to Claude too, in the form of long-context degradation. If the conversation is ancient and feels foggy, the right move is a clean /loop cycle reading only this file and the current chart — not trying to remember.)

---

## Meta: How I Use This File

- **Start of every /loop cycle:** skim headings — re-anchor on anti-patterns.
- **After a loss:** read the full file slowly. Ask: did I violate any rule here?
- **Before an exception:** write my planned exception into a scratch note. If the exception resembles any rule in this file, I do not take it.
- **Monthly:** consolidate similar lessons. Remove duplicates. Tighten language.
