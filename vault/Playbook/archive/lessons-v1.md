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

### [2026-04-22] — Structural SL requires ATR-buffer beneath, не AT the level

**Context:** BTCUSDT LONG #2 (trade_2), 07:14 UTC. Setup = sweep+reclaim round 78000 after 2-cycle news bias neutral confirmation. Rubric 10/12 A-setup. Entry market 78057, SL 77900 (157pt below, "below round 78000 flipped-S"), TP 78500 (R:R 2.82). Risk 0.4% (cap-fit after 0.75%/0.5% margin+notional rejects).
**What I did:** Placed SL AT structural level (77900 is just below round 78000 psychology). Ignored 0.5×ATR buffer rule. BTC 1H ATR ~150-200pt = SL 157pt from entry sits INSIDE normal wick range. Operator flagged "SL too close, any wick takes it out" ~30s after entry; SL hit seconds later. Price dropped к 77842 в ~5 min с CVD swing −\$3M (+\$1.55M → −\$1.49M = massive single-candle reversal).
**What I should have done:** Per `entry-rules.md` / CLAUDE.md: "SL placement: structural + 0.5×ATR buffer". Apply buffer **below** structural level. Proper SL = below nearS 77846 (not below round 77900) + ATR buffer ~96pt = **SL 77750** (307pt). Size smaller к fit risk-pct within notional cap. Or — preferred — place limit LONG at 77500 flipped-S для pullback entry с natural buffer and better R:R.
**Why it matters:** Trade thesis was defensible, но SL placement invalidated structure-over-noise discipline. Tight SL inside ATR range guarantees noise-wick exits regardless of thesis validity. **Took full -1R loss in ~5 min на process failure, не market failure.** Stop-hunt dynamics at round psychology levels are especially aggressive — these levels attract algo sweeps.
**Operational heuristic:**
- **Before submitting entry**: check SL distance vs ATR(1H). If SL distance < 0.8×ATR, SL is inside noise. Widen.
- **Round-number SL placement**: always below round + 0.5×ATR buffer minimum. Never AT round.
- **Margin/notional rejection from executor = diagnostic.** If rubric wants risk-pct X but sizing rejects at current SL, proper response = widen SL (structural sanity check) OR reduce position notional, NOT reduce risk-pct to fit tight SL.
- **Peak protection override**: если day P&L ≥ target (0.5%), raise entry bar +1 factor ИЛИ defer к pullback entries с natural wider SL — не chase tight-SL trades.
**Tags:** `[sl-widen]`-inverse (tight-SL trap, не widening error; same category), `[tp-greed]` adjacent (chased 2.82R R:R via tight SL).

**Also: 1-cycle CVD recovery after absorption = not yet confirmed breakout.** At C472 saw CVD flip from −\$130k к +\$1.55M — took that as breakout confirm. Actual reversal −\$1.49M came next cycle = absorption was real distribution masked by a single-cycle squeeze. For breakout confirmation, require: **2-cycle CVD+ sustained AND price HOLDS above breakout level for 2+ cycles**.

### [2026-04-17] — News-bias flips: 1 cycle = noise, 2+ consecutive = regime shift

**Context:** 17:42 UTC news bias flipped risk-off across all 8 pairs → all dir=None. I called it "major shift" in journal. 3 min later at 17:45 it flipped back to neutral — was transient flash. Same pattern recurred at 18:51 BUT persisted at 18:54 + 18:57 (3 consecutive cycles identical). Both events: same scan code, same market.
**What I did:** At 17:42 over-dramatized the single-cycle flip; had to retract next cycle. At 18:51 properly waited for confirmation before calling it real.
**What I should have done:** Never treat single-cycle news flip as signal. Single flip = borderline keyword entering/leaving risk-off bucket during 15-min news refresh = statistical noise.
**Why it matters:** Over-reacting to news-flip noise produces thesis thrash. Under-reacting to real shift means being Long into a reversal. 2-cycle rule filters noise without losing meaningful signal.
**Operational heuristic:**
- Single-cycle news flip, confluence unchanged on neighbors → noise, ignore.
- 2+ consecutive cycles same direction AND confluence erosion parallel → real regime shift, update thesis, prepare for opposite-side setups.
**Tags:** `[news-react]` (operational).

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
**What I did:** Verified via `src/audit.ts` that the Telegram reports did not reflect Bybit reality. Flagged to operator. Kept real positions (BNB, XRP) untouched.
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
**What I should have done:** First action of EVERY cycle = run a Bybit positions check (via `src/audit.ts` + `npm run reconcile`), cross-reference against `vault/Trades/` open files. Zero tolerance for divergence. Reconcile before any other decision-making.
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

### [2026-04-17] — Proactive Exit on Confirmed Narrative Shift (validated)

**Context:** XRPUSDT LONG #2 (21:15-21:42). Entered on mechanical R:R 1.5 trigger, 5/8 Bull. Peaked +0.3R with confluence upgrade to 6/8. Then signal dropped 5/8→4/8 and "risk-off bias" returned. Applied own 2-cycle-rule — held one cycle to filter potential noise; at 21:42 risk-off confirmed 2 consecutive. Closed proactively at +$10 gross / -$2.59 net (fees). Cycle 21:45 validated: 3rd consecutive risk-off, no recovery.
**What I learned:** When the same narrative shift that would PREVENT a new entry has appeared AGAINST an open position and confirmed 2+ consecutive cycles, close for scratch beats hoping for TP. "Would I open this right now?" NO → close. Symmetry with entry discipline.
**Why:** If the entry rules wouldn't fire now, the trade is no longer justified by the model that opened it. Hope is not a position management strategy.
**How to apply:**
- Opposite direction 4/8+ is one exit trigger; "own direction lost threshold + persistent narrative against" is another.
- Use 2-cycle rule on news-bias flips (1 cycle = noise, 2+ = real). Don't close on 1st cycle of bad news; DO close on confirmation.
- Accept fees/scratch as cost of exit discipline. -$3 exit > -$125 SL hit when model has turned.
- Closing tool: `npx tsx src/close-now.ts SYMBOL Buy` (for long) or `Sell` (for short) — expects Bybit side convention, not Long/Short.
**Tags:** exit-rules, process-discipline, narrative-shift

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

## [2026-04-18] — Post-loss-streak filter: stop accepting same-direction fires after 3+ losses same session

**Context:** 4 consecutive alt-Bull 5/8-6/8 mechanical fires (XRP 07:03, DOGE 07:00, BNB 07:15 uncorrelated different sector, AVAX 08:36) = 4 closes, ~-$525 realized (~-1.05R combined). Market regime actively shifting bullish → bearish throughout London session. Scanner kept firing 5/8 Long signals as local structures re-formed but macro kept fading them. By AVAX fire I had information that should have blocked the entry: 3 prior losses same direction same session.

**What I did:** Accepted each fire as independent signal. Pause-rule blocks correlated re-entries after OPEN positions, but I was flat between losses — rule didn't cover "post-loss-streak same session." Scanner did its job; my filter had a gap.

**What I should have done:** After 3 losses in same direction same session → block next same-direction fire unless (a) score ≥6/8 (structural, not just standard), OR (b) macro confirmation BTC flips back aligned. Reset counter at session transition (07/13/17/22 UTC) or after 1 winning trade.

**Why it matters:** Market regime shifts happen intra-session. Scanner fires on 3-min klines — it sees local structures, not macro rotation. When you're bleeding on a direction repeatedly in one session, the scanner's edge on that direction has temporarily disappeared. Keep trading it = paying scanner's statistical drift in fees. My R:R floor + confluence floor + correlation filter + news filter all exist to block specific failure modes. This is a NEW failure mode not covered: **session-level direction drift detection**.

**How to apply:**
- Track realized closes per session by direction (long_losses_today, short_losses_today, long_wins_today, short_wins_today).
- If `same_direction_losses_this_session >= 3` → next same-direction fire requires +1 score above normal threshold (5/8 → 6/8) AND macro confirmation (BTC regime in direction), OR REJECT.
- Reset at session transition or 1 winning trade same direction.
- Today (2026-04-18 08:39): Long losses session = 3 (XRP, DOGE, AVAX). BNB scratch не count как loss. SOL LONG limit placed but NOT filled — cancelled manually to enforce the rule retrospectively. Also cancelled BNB SHORT limit (fresh start).

**Tags:** `post-loss-streak-filter` `macro-regime-shift` `scanner-edge-drift` `paid-525-for-this`

---

## [2026-04-18] — Pause between mechanical fires on correlated pairs

**Context:** 07:00 UTC London wake-up. DOGE 5/8 Bull fired mechanically. 3 minutes later at 07:03 XRP 6/8 Bull fired mechanically. I accepted the back-to-back fires without pausing. By 07:06 XRP signal had collapsed 6/8 → 4/8 — classic peak-score trap — TypeScript proactive-exit closed at -0.3R / -$376 (saved us from -1R SL hit, but loss was still avoidable).

**What I did:** Took both consecutive mechanical fires on correlated alt-Bull pairs without any cooldown. Reasoning: "scanner fired → mechanical layer is the edge → my job is not to override." This was reflexive obedience, not analysis.

**What I should have done:** When a correlated mechanical fire comes 1 cycle after an existing position, impose a 1-cycle pause before accepting the second fire. Re-confirm on the NEXT cycle. If the 6/8 holds through 2 consecutive cycles — it's real setup. If it collapses to 4/8 in 3 min (as XRP did) — scanner was seeing peak-score on a tired move, not fresh edge.

**Why it matters:** The scanner evaluates cross-sectionally. When N correlated alts show 5-6/8 simultaneously, that's usually ONE exhausted move seen from N angles, NOT N independent signals. Yesterday (17-Apr) I codified peak-score trap as a concept in DOGE thesis. Today I LIVED it without applying the rule. R:R floor saves us from far entries; nothing saves us from "right score, wrong moment" unless WE add a pause.

**Rule:** After opening any position via mechanical fire, the NEXT mechanical fire on a correlated pair requires an extra cycle of confirmation — do NOT accept it reflexively in the immediately next scan.

**Tags:** `peak-score-trap` `correlation` `pause-between-mechanical-fires` `paid-250+-for-this`

---

### 2026-04-18 — Scanner does not know about Claude-layer filters. Override on fire.

**Context:** 10:39 UTC. AVAX LONG cooldown (120m from 08:39 loss) expired. Scanner autonomously fired 5/8 LONG AVAX at market, filled instantly on both subs — the 5th alt-Bull LONG fire this session after 4 prior losses (XRP/DOGE/BNB/AVAX#1 all -0.15R to -0.30R). Post-loss-streak filter (written 08:40) demanded 6/8 OR macro confirm; neither satisfied. Claude closed within 28s via `src/close-now.ts`. Scratch (~$40-80 fees), no R damage — but trade should never have filled.

**What I did wrong:** Wrote a post-loss-streak filter into `lessons-learned.md` at 08:40 and treated it as "enforced" — assumed cooldowns + R:R + confluence thresholds in TypeScript would buy me time. They don't. The moment cooldown clears, scanner mechanically refires on threshold + R:R. Market order. Instant fill. My "filter" existed only in my head.

**What I should have done:** Treat every cooldown expiry during a loss streak as an active threat. Either (a) code the filter into TypeScript `src/scan.ts` as a Redis-backed per-direction freeze flag, or (b) pre-place a "DO NOT ACCEPT" note in `Watchlist/active.md` that I re-read each cycle. Until coded — close within 1 cycle of any auto-fire that matches the pattern.

**Why it matters:** This is the **enforcement gap** problem. TypeScript is authoritative for mechanical rules (threshold, cooldown, R:R, DD kill). Claude is authoritative for contextual rules (loss streak, macro regime shift, news event). These live in separate layers. A Claude-layer rule that says "don't take this trade" is NOT inherited by the TypeScript scanner. The scanner fires anyway. If I don't manually override within the same cycle — position exists, fees paid, process grade drops.

**Rule:** Filters that live in `lessons-learned.md` are Claude-enforced, not scanner-enforced. After writing any new filter, immediately ask: "Does this require me to override live fires?" If yes — I must be attentive to every cycle's auto-execs until (a) the condition resolves (e.g., session transition, 1 winning trade) or (b) I code the filter into TypeScript.

**Operational protocol during active Claude-layer filter:**
1. Every cycle, scan output for `✅ [SYMBOL] ... exec=true` lines on blocked pairs.
2. If match → immediately `npx tsx src/close-now.ts SYMBOL SIDE`.
3. Document the override as a trade file + postmortem (paper trail required since Bybit position existed).
4. Do not wait for TypeScript proactive-exit. Close at market.

**Tags:** `claude-override-required` `scanner-filter-gap` `post-loss-streak-enforcement` `paid-80-fees-for-this`

### [2026-04-19] — Canonical Phase 0/2 commands only; never invent compound heredoc chains

**Context:** London open, cycle 210 (07:11 UTC). Wrote a compound Bash command: `npm run reconcile 2>&1 | tail -15 && date ... && npx tsx src/scan-data.ts all > /tmp/x.json && python3 <<'EOF' ... EOF`. Harness fired a permission prompt — operator intervened: "Я не хочу заниматься таким подтверждением!!!! Я хочу чтобы бот работал автономно." The memory file `feedback_autonomous_no_heredoc.md` EXPLICITLY names `src/scan-summary.ts` as the canonical replacement, but I ignored it and re-invented the inline parser.
**What I did:** Generated a 30-line compound command mixing 4 tools (npm, date, npx tsx, python3 heredoc). Broke autonomy at London open.
**What I should have done:** `npm run reconcile && npx tsx src/scan-summary.ts all` — two atomic commands, both covered by existing allowlist (`Bash(npm run *)` + `Bash(npx tsx *)`), no heredoc, no inline JSON parsing.
**Why it matters:** The bot's entire purpose is autonomous execution on a 3-min cron. Every permission prompt = operator must physically approve = the autonomy thesis fails. Memory warnings alone don't suffice — the temptation to write ad-hoc "I'll just quickly parse this JSON inline" is strong. The canonical commands now live in `CLAUDE.md` § "Autonomous Execution — Command Discipline" as the single source of truth; no excuse to invent alternatives.
**How to apply:**
- Phase 0 reconcile → `npm run reconcile` (nothing else)
- Phase 2 scan → `npx tsx src/scan-summary.ts all` OR `npx tsx src/scan-summary.ts {SYMBOL}` (nothing else)
- Need inline JSON inspection? Save to `/tmp/`, then use Read/Grep tools — NOT `python3 -c` or `node -e`
- Need a new recurring diagnostic? Write a committed `src/<name>.ts` via the Write tool, THEN invoke via `npx tsx`
- Never use `python3 <<'EOF'`, `node -e '...'`, `cat > file <<'EOF'` in the Bash tool
**Tags:** `autonomy-break` `heredoc-banned` `permission-prompt` `ignored-own-memory`

---

## [2026-04-19] — Protect max R when peak nears +1.5R trail trigger but structure consolidates

**Context:** XRP LONG opened C282 @ 1.4249 (9/12). Peaked +1.24R at C303 (price 1.4310) but missed +1.5R trail trigger by 13 pts (1.4323). Next 10+ cycles oscillated in consolidation while BTC slope3 cooled. Peak unrealized $551 drained to $264 before defensive-close on news risk-off 2-cycle flip. Rule-obedient HOLD discipline cost ~$287 of captured gain.
**What I did:** Followed "no SL to BE until +1.5R" rigidly. Watched peak +1.24R drain to +0.58R as trade consolidated 35 min without progress.
**What I should have done:** Manual SL move to breakeven (entry 1.4249) at C304/C305 when peak held 3+ cycles without progress AND BTC MACD hist started declining (+30.82 → +29.27) AND BTC slope3 cooling (+21.21 → +19.9).
**Why it matters:** Rigid adherence to 1.5R trigger leaves money on the table when peak gets within 15-20 pts of trigger AND market shows deceleration. Both sub-accounts realized ~43% of max unrealized — a tighter trail protocol protects 75-90% of max R on similar "almost-there" trades.
**How to apply:**
- **Peak Proximity Trail Protocol:** If peak reaches ≥+1.0R AND structure shows at least 2 consecutive cycles of one or more: BTC slope3 declining, MACD hist peaking, 3m RSI dropping below prior peak — manually move SL to breakeven EVEN IF +1.5R rule not yet triggered.
- Rationale: bird-in-hand is better. At +1R you already have positive EV and locking breakeven eliminates downside risk.
- **Peak-miss rule:** if peak within 15 pts of +1.5R trigger and reverses → treat as de-facto 1.5R hit for SL-to-BE purposes.
- **Escape hatch:** this protocol does NOT override the "news risk-off 2-cycle = defensive exit" rule — news flip is absolute, peak protection is momentum-based.
**Tags:** `trail-stop` `peak-protection` `locked-vs-unlocked-gain` `exit-rules`

---

## [2026-04-19] — 2-cycle news rule VALIDATED (both directions: prevent panic + enable defensive exit)

**Context:** XRP LONG position at +0.54R. C314 (12:46 UTC) — scanner news bias flipped neutral → risk-off (new Hormuz closure trigger). WebSearch validated real event (Iran re-closed Strait after April 17 reopening, BTC dropped from $78K). Applied 2-cycle rule: held past C314 (1-cycle = noise). C315 confirmed sustained risk-off → closed defensively at +0.58R, locking $264 gross.
**What I did:** Correctly applied 2-cycle confirmation rule. Did NOT panic-exit at C314 on single-cycle flip. Did execute close at C315 on 2-cycle confirmation per trade file's own "risk-off 2-cycle = exit defensively" rule.
**What I should have done:** Exactly what I did. This is a process-rule validation, not a correction.
**Why it matters:** The 2-cycle rule balances two opposite failure modes: (a) panic-exit on stale/noise news triggers (which would have cost several R-events in prior weeks per memory); (b) sleep-walk through real geopolitical shifts that invalidate thesis foundation. Without the rule, EITHER direction (too-fast or too-slow) costs P&L.
**How to apply:**
- 1st cycle news-flip → write it in journal, send TG alert, HOLD (don't act).
- 2nd cycle sustained → if trade file has "risk-off 2-cycle = exit defensively" invalidation → execute close, cite the rule.
- 2nd cycle reverts to neutral → treat as noise, keep position.
- WebSearch any new/unfamiliar news trigger (like new Hormuz closure) — differentiates stale RSS cache from real event.
**Tags:** `news-rule` `validated` `2-cycle-confirmation` `risk-off` `defensive-exit` `websearch-trigger`

---

## [2026-04-19] — A-setup confirmed AFTER 400+ pt move = chase, not edge

**Context:** News-flip catalyst at C328: after 12+ cycles of news-blocked FLAT discipline, news cleared neutral. Market had rallied 400+ pts during the block (BTC 75548 → 76008). All 12 factors flashed green (10/12 A-setup): bullish BOS, MACD +68 peak, OBV just turned positive, momentum +DI>−DI fresh cross, all TFs >50, news neutral mult 1.0. Opened BTC LONG at 76008. Position NEVER went into profit — 36 min of consolidation with BOS oscillating bullish↔none (indecision). Scratch-closed -0.48R ($927). BTC dropped 200 pts more post-close validating exit.
**What I did:** Market-ordered entry at local 2H high immediately after news flipped, trusting the rubric fully. Had a bias toward "finally qualified = open now" after watching market move without me for 25+ min.
**What I should have done:** Recognized the rubric lags: when 12 factors align AFTER price has run 400+ pts, factors are describing what already happened — не что произойдёт next. Either: (a) wait for pullback to OB/EMA21 retest, (b) use `place-limit` at 75650, (c) size down to 0.25% for late entry, or (d) simply skip чтобы не chase.
**Why it matters:** The 12-factor rubric is а signal filter, не а timing tool. A qualifying signal after extended rally = buying the expression of the move, not positioning for it. Classic "buy the rumor, sell the news" trap — except with technicals instead of news.
**How to apply:**
- **Chase filter:** Before opening ANY rubric-qualified LONG, check: has instrument moved >0.7% in last 60 min? Has it already touched or surpassed 1h nearR? If yes → wait for pullback, do not market-enter.
- **"Would this look as good 200 pts lower?"** Mental test — if yes, wait for retrace entry. If price wasn't elevated, signal would still qualify at much better R:R.
- **Late-entry sizing rule:** If entering a signal that has already moved >50% of daily ATR within last hour, cap risk at 0.25% regardless of confluence score. Scratched early is much cheaper than SL hit.
- **Prefer place-limit at structural levels** (OB, EMA21, recent swing low) over market order at local high, especially on news-flip catalysts where volatility attracts FOMO.
**Tags:** `chase-signal` `lagging-rubric` `late-entry` `mean-reversion` `post-rally-entry` `news-flip-trap`

---

## [2026-04-19] — Lock 50% of peak R at +1R, even if +1.5R trail trigger never fires

**Context:** XRP LONG opened 11:10 UTC на multi-pair reversal 9/12. Peak unrealized **+1.24R at C303** (12:13 UTC) — price 1.4310, всего 13 pts от +1.5R trail trigger (1.4323). Trigger never fired. Position drifted в range consolidation 30+ min, closed defensively at **+0.57R** когда news flipped risk-off 2-cycle at C315. **Gave back 54% of peak ($287) между пиком и закрытием.**
**What I did:** Left SL at original 1.4200 (-0.25R) throughout, waiting for +1.5R trigger. When news flipped, exited at market (+0.57R). All peak gains beyond +0.57R surrendered to market noise.
**What I should have done:** After +1R milestone (C299), immediately move SL to breakeven (protect 0R floor). At peak +1.24R (C303), tighten SL further to lock +0.5R minimum. Even if +1.5R never reached, +0.5R floor baked in.
**Why it matters:** Fixed +1.5R trail trigger works on clean trending moves, fails on range-reversal environments. This is the Van Tharp critique of discrete trail-rules: they work on 60% of setups, fail exactly when needed on the other 40%. Dynamic "protect 50% of current peak unrealized R" is simpler, faster, survives both regimes. Related to `[tp-greed]` inverse — not greed for more TP, but failure to actively protect what's already banked.
**How to apply:**
- **+1R milestone:** SL → breakeven immediately.
- **+1.2R:** SL → entry + 0.4R (protect 40%).
- **+1.5R:** existing trail activates (SL → BE + 1.0R, trail 1× ATR(1H)).
- **Every subsequent +0.3R:** tighten SL to ≥50% of current peak R.
- Cascade must appear in `vault/Trades/*.md` "Invalidation" section, not only in head.
- Update `vault/Playbook/exit-rules.md` with this cascade for canonical reference.
**Tags:** `peak-give-back` `trailing-stop-failure` `range-reversal-trap` `50pct-protection-rule`

---

## [2026-04-19] — Daily P&L is Bybit equity diff, NEVER trade-math

**Context:** Throughout the day I reported P&L as (exit-entry)×qty summed across trades. Day-end: "-$662.71 net" по my trade records. Operator at 19:XX UTC corrected: "Убыток у тебя не тот, который ты указал... Для точного P&L лучше делай запрос на биржу за балансом." Queried actual Bybit equity: 50k sub $49,376.41, 200k sub $197,553.71 = **combined -$3,069.88 vs $250k initial (-1.23%)**. Trade-math systematically underreports by ignoring: fees (~$15-30/round-trip × 2 subs × 2 trades = $60-120/day), funding rate clips, market-order slippage, borrow costs.
**What I did:** Used (exit-entry)×qty for Telegram reports, journal day-summaries, postmortem "realized_pnl_usd" frontmatter all day. Understated real cost of trading by $100-200 per active day.
**What I should have done:** Query Bybit `getWalletBalance` totalEquity at 00:00 UTC as daily baseline, diff against live equity for current day P&L. Single source of truth. Implemented: `src/pnl-day.ts` with `--snapshot` mode for baseline + diff mode for live.
**Why it matters:** Trade-math is systematically optimistic — ignores every friction cost. Over a year: fees alone on 2 trades/day × 250 days × ~$50 = ~$12,500 tracking error. More critically: **HyroTrader DD limits are checked against REAL equity**. My trade-math provides ZERO protection — I could think I'm at -1% daily DD while Bybit shows -1.3% approaching kill switch. Sizing decisions read from false numbers → wrong position size → real DD worse than internal math suggests.
**How to apply:**
- Every daily summary (journal, Telegram, session end) pulls from `npx tsx src/pnl-day.ts` — never from trade files.
- Per-trade `realized_pnl_usd` frontmatter stays for R-attribution per setup, but aggregate day number ALWAYS from Bybit diff.
- Start-of-day snapshot: `npx tsx src/pnl-day.ts --snapshot` at 00:00 UTC (schedule via /loop).
- When trade-math and Bybit diff conflict, trust Bybit unconditionally. No investigation. Just use Bybit.
- Canonical TG pattern: **"Портфель: FLAT. Дневной P&L: -$XXX.XX (-X.XX%) по балансу биржи."** — always qualified "по балансу биржи" so operator knows source.
- Fix the 40% rule (eval phase): "40% of total accumulated profit" refers to BYBIT-tracked profit, not trade-math profit. Apply same discipline to all HyroTrader rule checks.
**Tags:** `accounting-discipline` `bybit-is-truth` `fees-matter` `systematic-underreporting` `dd-compliance`

---

## [2026-04-19] — Systematic LONG bias: 4 SHORT 9/12 setups overridden, all would have paid +2-3R

**Context:** Morning 07:00-10:00 UTC BTC dumped 75731 → 74894 (-837 pts, -1.1%), all 8 pairs bos1h=bearish, ADX 28-46 with -DI dominant — textbook sustained bear move. Scanner generated SHORT 9/12 signals at C225 (75196), C229 (75045), C237-C242 (75150-75230), C243 (75126). I overrode ALL of them. In C245 (09:19 UTC) I myself wrote: *"C225 (RSI 30.83 @ 75196): rejected, но тот trade был бы +2-3R (calculation error в моём override)"*. BTC reached 74894 low — C225 SHORT with SL 75400, TP 74500 was +3.5R on 0.5% risk = ~$2,000-2,500 paid opportunity, missed. Operator flagged at 19:XX UTC: "Очень часто лонги, хотя как по мне и шорты могли бы быть сегодня."
**What I did:** Overrode every SHORT 9/12 signal with soft reasons: "RSI oversold", "watchlist не триггернут", "LiqCl 0 + Funding 0 = no edge", "R:R 1.05 too tight to nearS 74965". Both trades I actually took were LONG (XRP +0.58R, BTC -0.48R). Day P&L: net negative; counterfactual day with SHORT entries: likely +$1,500-2,500 net positive.
**What I should have done:** Taken at least one SHORT. The structure was textbook sustained bear move — all 8 pairs aligned, ADX strong, -DI dominant. C225 specifically: 9/12 meets B+ threshold, scoring was symmetric, no counter-trend penalty (I scored Regime=1 because structure was bearish despite scanner-labeled "Bull"). Should have entered 0.5% risk with SL above 75400 swing high, TP 74500 structural support, bracket trade managed per exit rules.
**Why it matters:** I have **structural LONG bias** baked into multiple layers:
1. **RSI oversold reflex** — auto-reject SHORT at RSI<30. Valid in mean-reversion, WRONG in strong-trend (ADX 33+ with -DI dominant can hold RSI<30 for hours). Textbook rule misapplied.
2. **Regime filter asymmetry** — CLAUDE.md: "SHORT в Bull regime = CT → 10/12". Scanner regime classifier uses 4H RSI >50 = Bull; but 1H/15M structure can be violently bearish (today's case). Formal regime overrides actual structure. LONG has no equivalent barrier in Bear regime per current rules.
3. **R:R calc error** — using nearS (closest support) as TP benchmark in strong-ADX moves systematically underscores SHORT R:R. Realistic TP in trending move is deeper structural level.
4. **Watchlist as gate not hypothesis** — I treated "BTC bounces to 75500-76200" as required trigger. Watchlist = scenarios to prepare; fresh structure outside watchlist is STILL valid if signals align. Gate thinking kills opportunistic edges.
5. **"No-data" read as "no-edge"** — LiqCl/Funding factors are 0 when scanner lacks data. I score this as signal-against-trade. For LONG, I don't penalize the same 0/0 — symmetric only on paper, asymmetric in practice.
**How to apply:**
- **Remove RSI<30 as SHORT-reject filter.** Replace with ADX-contextual: "In ADX>25 with -DI dominant, RSI<30 is CONTINUATION signal, not mean-reversion. Do NOT reject SHORT on oversold RSI." Same for LONG: ADX>25 with +DI dominant + RSI>70 = continuation, not auto-reject.
- **Override regime filter when 1H/15M structure contradicts 4H scanner regime.** If 7/8 pairs show bos1h=bearish AND ADX>30 AND -DI>>+DI, treat as **effective Bear** regardless of scanner label. 9/12 SHORT is VALID, not counter-trend 10/12.
- **R:R benchmark uses deeper structural target in strong-ADX moves.** ADX>25 → TP benchmark is next MAJOR structural level (1H OB, 4H pivot), not micro-nearS. This raises SHORT R:R to match true structure.
- **Watchlist is hypothesis, not gate.** Fresh structural setups outside watchlist are takeable when signals align. Watchlist trigger = easier confidence, but absence ≠ rejection reason.
- **Scoring factors with null data = score 0 symmetrically.** Don't count 0/0 as "bearish" or "bullish" — count it as missing data, let other 10 factors dictate.
- **Daily bias audit:** end-of-day, count (#LONG entries + #SHORT entries). If ratio >3:1 in either direction without strong regime thesis supporting it, flag it. Today's 2:0 LONG/SHORT against obvious bear session = failure.
**Tags:** `directional-bias` `long-preference` `missed-short` `override-as-rationalization` `regime-filter-asymmetry` `paid-2R-for-this`

---

## 2026-04-20 — Pre-defined trade invalidation criteria override rubric opposite scoring

**Context:** BNBUSDT LONG opened 07:31 UTC at 626 (10/12 A-setup), closed 08:30 at 623.8 via market execution on BTC eff_regime flipping к bear. R = -0.69, PnL -$435.50 combined.

**Trade-specific invalidation criteria** written в trade file at open:
1. BNB 15M close < 621 (EMA21 break)
2. Not filled by 07:45 UTC (funding blackout approach)
3. **BTC eff_regime flips back к bear**  ← this one fired
4. News bias flips risk-off с HIGH impact

At C580 (08:30 UTC), BTC `chg_5_15m` crossed -0.5% threshold (-0.54% actual) → eff_regime flipped к bear. My generic rubric SHORT opposite score на BNB was only 5/12 (below 8 exit threshold). Pure rubric would have said HOLD.

Followed trade-specific rule → closed immediately at market.

**Outcome**: Saved ~$190 vs full SL hit at 622. SL hit would have been -1R = -$625; actual -0.69R = -$435.50. Market did continue к BNB ~623 area briefly после close — SL would have fired within 1-2 cycles.

**Lesson:**
- **Pre-defined trade invalidation criteria > generic 12-factor rubric opposite scoring for close decisions.** When opening a trade, I write trade-specific invalidation rules WHEN я have full context. These rules are stricter, more informed, and setup-specific.
- **Generic rubric (SHORT opposite ≥ 8) is for positions WITHOUT pre-defined invalidation criteria.** Для trades with written criteria, honor them exact.
- **Do not rationalize away trade-specific rules using rubric score.** "SHORT only 5/12, rubric says HOLD" is the wrong frame если trade file says "close on BTC bear regime".
- **Write specific invalidation criteria for EVERY trade**, not just template risk-based ones. E.g., for SHORT на altcoin, write "close if BTC eff_regime flips к bull" + "close if pair's bos_15m flips bullish" etc.

**Why this matters:** This lesson came from a trade where discipline was tested on BOTH ends:
- HOLD side: -0.71R adverse excursion при SHORT opposite 4/12 → held per rubric, position recovered к -0.25R
- CLOSE side: regime flip triggered trade file rule → closed immediately even though rubric SHORT only 5/12

Both directions followed rules. Saved potentially -1R loss via trade-specific close.

**Tags:** `invalidation-criteria` `rule-discipline` `pre-defined-rules-win` `saved-0.3R`

---

## 2026-04-20 — Time-horizon discipline: 3m noise ≠ invalidation of 1H thesis

**Context:** LINKUSDT SHORT limit placed 11:03 UTC at 9.22 (9/12 B+), cancelled 11:10 UTC — 7 minutes later. Cancel triggered by pre-committed rule "BTC reclaims 75100 → cancel limit". BTC moved 74974 → 75138 (+165 pts, 0.22%). No position opened, no dollar loss — but operator flagged it as flip-flopping: "минуту назад анализ одно показал, через минуту другое".

**Diagnosis:** The invalidation rule was structurally correct (pre-committed, specific, executable) but the **threshold was thinner than 15m bar noise**. ATR(15m) on BTC at the time was ~280 pts. A +165 pt move is routine bar-to-bar oscillation, not structural regime shift. Firing cancel on it was horizon mismatch: a 3m trigger invalidating a 1H-structure thesis.

**Wider pattern — I was re-scoring the pending limit every 3m cycle**. 7 min × (one cycle per 3 min) = 2-3 chances to second-guess. With 8 pairs × dozens of factors, random indicator flips create noise-driven cancels.

**Lesson:**

- **Invalidation thresholds must exceed ATR(15m) OR pair with structural confirm.** Single-number price thresholds <0.5% from current are noise at 3m cadence. Required form: `"BTC 15m close > X AND (MACD1H flip | bos_15m flip | chg_5_15m > +0.5%)"`. Paired gate filters bar noise.

- **Pending limits get 15-min grace period.** From place-limit to first 15m candle close: **do not cancel** except catastrophic (BTC ±1%, high-impact news, broken support/resistance level). Between 15m closes, factor oscillation is noise — watch, don't act.

- **Re-score limits on 15m close, not 3m fire.** In a `/loop 3m` world, I still make decisions every 3 min — but for **pending limits**, the decision cadence drops to 15m. Between closes I only monitor catastrophic events.

- **Standard 45-min maxAge still applies.** If the limit hasn't filled by then, thesis has moved on regardless — expire.

**Counterfactual:** had grace period been in place, the LINK limit would have lived 12 more minutes (to 15m close at 11:15). Whether it would have filled or expired isn't the point — the point is **the decision to cancel would have been based on a closed 15m candle, not a mid-bar wiggle**.

**Rule applies to pending limits AND open positions with small R.** Opposite-score 8+ check already has 9-min grace post-fill. Extend same logic to limits: no invalidation check before 15m close.

**Operator language (per telegram-templates.md):** "дальновидность" — the 10-second test. If a rule fires on noise an experienced trader would shrug off, the rule is too thin.

**Tags:** `time-horizon` `noise-vs-signal` `grace-period` `invalidation-threshold` `whipsaw-prevention`

---

## Meta: How I Use This File

- **Start of every /loop cycle:** skim headings — re-anchor on anti-patterns.
- **After a loss:** read the full file slowly. Ask: did I violate any rule here?
- **Before an exception:** write my planned exception into a scratch note. If the exception resembles any rule in this file, I do not take it.
- **Monthly:** consolidate similar lessons. Remove duplicates. Tighten language.

---

## [2026-04-20] — Pre-committed rules exist FOR stress moments. Override at max stress = rule defeated itself.

**Context:** ETH LONG at -0.67R. BTC touched 74968 intra-cycle (below psychological 75000). Pre-committed rule #6: "ETH 15m close <2305 within 30 min → market close". 4 min before close-trigger, sent stress-TG к operator: "не закрываю сейчас, правила важнее интуиции, жду 14:00 close". 4 min later applied Claude override and market-closed at 2302.5. Within 6 min BTC bounced к 75229 (+261 pts), ETH к 2312.89, eff_regime flipped back к bull (slope3 -1.19 → +3.70). If had held per stated plan: 15m close at 14:00 was >2305, rule #6 would NOT fire, position would be -$50 vs actual -$482. **Cost of override: ~$430.**

**What I did:** misread normal pattern (third test of 75000 support that had bounced twice before) as "structural break" and overrode the exact rule designed to protect me from reading intra-cycle bars as confirmation. Wrote "документированное обоснование" под это, но rationale was post-hoc rationalization of a stress-driven exit. Broke public TG commitment к waiting 14:00.

**What I should have done:** honored the pre-committed rule. Rule #6 specifies "15m **close**" not "any price touch" specifically because single-candle dips are noise. The rule had enough edge to wait 8 more minutes; I didn't. When the stated plan and action diverge on a judgment call made at -0.67R, the plan should win — that's the whole point of pre-commitment.

**Why it matters:** this is the deepest failure mode of Claude override authority. The CLAUDE.md grants override power, but override is supposed to be rare and for genuinely new information, not for panic-reread of existing data. "BTC broke 75000" was the same data point I had been watching for 30 min; adding -0.67R unrealized P&L does not make a reread new information. **A rule that can be overridden at peak stress provides no protection at peak stress.** The EV math I cited ("save $200 vs SL") was wrong because it ignored the recovery scenario that had played out TWICE already today (C675 and C677) — confirmation bias at peak loss.

**Operational fix**:
1. Pre-committed timed gates (rule #6-type) are INVIOLABLE until the gate fires. No Claude override within the gate's scope. If I want more authority к react earlier, set a tighter rule at entry time — not at -0.67R.
2. Public TG commitment compounds this: once stated, the gate is doubly locked.
3. "Override rare and for genuinely new information" means: new structural break with **CONFIRMED** close follow-through, not an intra-cycle touch of a level.

**Tags:** `[pre-commitment]` `[override-discipline]` `[stress-rationalization]` `[operator-trust]` `[confirmation-bias]`

---

## [2026-04-20] — Same-pair opposite-direction re-entry within 30 min requires 11/12, not 9/12

**Context:** Closed ETH LONG at 13:52 for -$482 (-0.77R). 23 min later at 14:15, fresh bos_15m bearish on ETH with broader bearish confluence — scored 9/12 SHORT on same pair, valid by rubric.

**What I would have done with pure rubric adherence:** Enter ETH SHORT 2297, SL above 2320, TP 2270. Objective 9/12.

**What I should have done (and did, this time):** Skipped. Rationale: same-asset opposite-direction entry within minutes of a loss looks indistinguishable from whipsaw/revenge trading to an external observer (operator, future-me reviewing) AND tends to produce worse outcomes because (a) psychological state is not clean, (b) BTC-correlation patterns haven't had time to differentiate the new signal from noise, (c) R:R is worse because price is already late in move (20+ pts from the prior range boundary).

**Why it matters:** There's a qualitative difference between "taking a new symmetric signal" (process-aligned) and "flipping direction on the same asset while the prior loss is fresh" (stress-reactive). The rubric is pair-agnostic; discipline is not. An 11/12 A-setup still justifies re-entry (clearer alpha, less doubt), but 9/12 minimum-threshold is insufficient к overcome the whipsaw appearance.

**Operational rule:** Within 30 min of closing a trade on pair X:
- Same pair, SAME direction: standard 9/12 threshold OK (just re-entering if setup reforms)
- Same pair, OPPOSITE direction: threshold raised к **11/12 (A-setup)**. Below that — wait ≥30 min OR take the signal on a different asset.
- Different pair: standard thresholds apply.

**Tags:** `[discipline]` `[same-pair-whipsaw]` `[post-loss]` `[operator-trust]`

---

## [2026-04-20] — 9/12 entry with MTF=0 is fragile to BTC structure breaks

**Context:** ETH LONG 2315 at 9/12 (SMC=1, Tech=1, Vol=1, BTC=1, Regime=1, News=1, Mom=1, Vol=1, Session=1, MTF=0, Liq=0, Fund=0). MTF=0 because 4H RSI 49.04 was just below 50. Entry was technically valid. BTC then broke 75000 structural support on third test, ETH tracked BTC down, trade closed at -0.77R net.

**What I did:** entered at 9/12 threshold using MTF=0 as one of three zeros. Held through multiple stress cycles as BTC tested 75000 twice (correctly, those tests held). On third test BTC broke, ETH had no independent strength to hold up — because 4H trend was not confirming up, ETH was purely BTC-correlated.

**What I should have done:** when 9/12 includes MTF=0 AND the trade is BTC-correlated alt, set a tighter structural invalidation tied to BTC's key level (here 75000) rather than ETH's own SL only. "If BTC breaks 75000 and closes below → market close ETH regardless of ETH price" would have saved ~0.3R vs the late-stage override exit. 4H RSI below 50 = no MTF cushion = BTC is the only structural prop.

**Why it matters:** 9/12 is the minimum threshold, and the specific factors that are zero determine fragility. MTF=0 on a BTC-correlated alt means the trade has no independent technical thesis — it rides entirely on BTC. When BTC structural level breaks, there's no reason to wait for the alt's own SL; it's already invalidated. Invalidation rules for such trades must include the correlated-asset structural level, not just the own-asset price.

**Tags:** `[entry-quality]` `[invalidation-rules]` `[correlation-risk]` `[9/12-fragility]`

---

## [2026-04-21] — Alt-cluster CVD health check before alt LONG entry

**Context:** AVAX LONG 9.42 at 9/12, independent structural breakout (all BOS bullish, close_vs_swing_15m above_prior_high, rsi_accel +1.558 strongest of day, OBV +645k accelerating). At placement: ETH CVD5m bleeding −$3M−$4M, SOL CVD −$400k, BNB stoch 0 extreme oversold, XRP bearish 15m BOS. AVAX thesis "independent of BTC chop" correctly identified alt leader structure но missed that alt cluster was coordinating lower. Fill 9.42, 12 min later SL 9.35 hit as ETH deepened к −$1.17M CVD5m. Clean −1R = −$625.

**What I did:** scored AVAX standalone at 9/12, entered with limit, correctly honored grace period, SL held firm. All process clean. But missed: alt cluster CVD health was already deeply negative at placement.

**What I should have done:** before any alt LONG entry, scan alt-cluster CVD: if ≥3 of {ETH, SOL, BNB, XRP, DOGE, AVAX, LINK} show CVD5m < −$500k, treat as "correlated alt bleed" regime. In that regime:
- Demand 10/12, not 9/12, для alt LONG entry
- OR wait для cluster stabilization (at least 2 alts CVD5m flip positive before committing)
- Per-pair structure cannot override cross-market cluster weakness

**Why it matters:** single-pair 9/12 standalone setup ignores correlated contagion risk. Crypto alt cluster moves в tandem during stress — one ETH dump drags entire cohort regardless of individual pair structure. AVAX had все the right SMC signals но was swimming against 5 simultaneous alt dumps. Structural thesis was right; correlation context was ignored.

**Operational rule:** at Phase 4 (scoring), compute alt-cluster CVD health metric:
- `alt_cluster_red_count = count of alts with CVD5m < −$500k (excluding target pair)`
- If `alt_cluster_red_count ≥ 3` → add к journal explicitly, raise alt LONG threshold к 10/12
- If `alt_cluster_red_count ≥ 5` → alt LONG blocked entirely, wait для recovery signal

**Tags:** `[correlation-risk]` `[alt-cluster]` `[CVD-leading-signal]` `[pre-entry-check]` `[9/12-fragility]`

---

## [2026-04-21] — CVD1m = CVD5m spike = single aggression event, NOT trend reversal

**Context:** 16 min after AVAX LONG #1 −1R SL hit, scanner showed ETH CVD1m = CVD5m = +\$1.50M (exact same value in both fields, 1000 trades). At the same moment, OBI −0.97 extreme ask-heavy. AVAX bos_1h flipped bullish. Scored 11/12 LONG, entered market at 9.438. Within 3 min, ETH CVD flipped к −\$550k, tape didn't hold, all alts broke below prior lows. AVAX SL 9.37 hit 8 min later. Total AVAX day: 2× −1R = −\$1250. Operator flagged "те же грабли" mid-position — correct warning.

**What I did:** interpreted ETH CVD +\$1.5M as "market-wide reversal confirmation" justifying F5 (BTC Correlation) and portfolio-level context. Built 11/12 on это. Ignored that OBI −0.97 said buyers were HITTING ask wall (not accumulating), ignored that only AVAX (not other alts) had flipped structure. Post-loss FOMO + "reformed setup" rule abuse.

**What I should have done:** recognized signature of single algorithmic short-covering buy event:
- `CVD1m == CVD5m` (same exact value) = ALL that volume was в последнюю минуту
- Real reversal = positive CVD on 3-5+ consecutive 1-min bars
- If CVD up with OBI extremely ask-heavy → buyers hitting wall, seller has supply → expect fade
- If isolated pair flipped structure while cluster still bearish → no confirmation

**Operational rule**:
1. **CVD spike filter**: Before using CVD5m as F1 or F3 confirmation, check `CVD1m vs CVD5m`. If equal (or near-equal), that's a 1-min event. Require multi-bar persistence (3+ positive 1-min bars at different timestamps, observable через 3-5 scan cycles) before counting as durable signal.
2. **OBI-CVD sanity check**: If CVD is strongly positive AND OBI deep negative (ask-heavy) → iceberg resistance/absorption, NOT accumulation. Treat as anti-LONG signal for short term.
3. **Cluster confirmation requirement для alt LONG**: ≥3 alts showing new bullish BOS on same cycle. Single-alt structural flip while cluster bearish = high-probability trap (as C182 и C195 both demonstrated).

**Post-loss stricter cooldown**: Previous rule "same direction OK within 30min if setup reforms" — REVISED. Reformation now requires: (a) 2× 15m closes confirming new structure, (b) cluster-wide alignment, (c) multi-bar flow persistence. Bare rubric count ≥ 9/12 insufficient during post-loss window.

**Why it matters:** In bot-saturated crypto futures markets, algorithmic actors regularly trigger buy cascades to farm liquidity (running stops, then dumping). 1-minute CVD spikes are the signature of these events. Treating them as reversals = feeding the algo. The operator's "те же грабли" warning on 2026-04-21 was specifically about this pattern — I ignored it by focusing on rubric count rather than signal durability.

**Tags:** `[CVD-interpretation]` `[transient-signal]` `[post-loss-discipline]` `[cluster-confirmation]` `[algorithmic-manipulation]` `[operator-signal]`

---

## [2026-04-21] — Cancel-limit race condition: check audit BEFORE cancel

**Context:** Placed BTC LONG limit @ 75960 at 13:25 (price 76066, 76pt above). 2 min later market signals flipped (CVD от +\$848k к −\$254k, OBI from balanced к extreme spoof). Issued `cancel-limit --reason invalidated`. What I didn't know: price had briefly touched 75960 in between — **limit already filled**. Cancel removed SL/TP group-linked orders, leaving bare position. Reconcile caught divergence 2 min later; emergency move-sl restored SL 75830. Position went к SL hit 7 min after accidental open = −1R −\$625.

**What I did:** assumed limit was still pending (no fill notification seen), cancelled with structural invalidation reason. Didn't check `audit.ts` before cancel.

**What I should have done:** ran `audit.ts` FIRST to verify position state. If position exists (limit filled) → should have used `move-sl` (adjust existing protection) or `close` (exit immediately), not `cancel-limit` (which acts on orders, not positions).

**Operational rule:**

Before ANY cancel-limit command:
1. Run `npx tsx src/audit.ts` — check if position exists для this pair
2. If position exists → assume limit filled, use position-management commands (close, move-sl) instead
3. Only cancel-limit when audit confirms empty position AND pending limit age > a few seconds

**Race condition mechanism:**

Bybit orderGroup links limit + SL + TP як atomic set. When cancel-limit fires on an already-filled order (position opened from that order), the cancel no-ops on the limit но still processes pending SL/TP orders in the group → removes them. Net result: unprotected position.

**Why it matters:** unprotected positions are the primary account-loss risk. HyroTrader compliance requires server-side SL within 5 min of open. A race condition that removes SL silently = compliance risk + bare exposure risk. Both exist regardless of trader intent. The 5-min rule means emergency detection+fix must happen fast.

**Wider pattern recognition:**

This error compounded with "5th reclaim attempt"-pattern blindness. After 4 identical failures at same level, skepticism should grow. The "this one is different" cognitive signal needs к meet higher burden of proof. Rule candidate:

*After N consecutive failed setups at same structural level (>= 3), raise entry threshold +1 factor (so standard 9/12 becomes 10/12). Applies for 1 hour after last failure.*

**Tags:** `[race-condition]` `[cancel-limit]` `[compliance-risk]` `[distribution-pattern]` `[audit-first]` `[post-loss-threshold]`
