---
trade_file: "[[Trades/YYYY-MM-DD_SYMBOL_DIRECTION]]"
symbol: XXXUSDT
direction: long
outcome: win             # win | loss | breakeven
r_multiple: 0.0
duration_hours: 0
closed_reason: ""        # sl | tp | trail | proactive-exit | time-stop | strategic-close
process_grade: ""        # A | B | C | D | F — how well I followed my rules, regardless of outcome
lesson_tag: []           # from lessons-learned.md vocabulary, if applicable
generalizable: false     # true if this trade produced a lesson that belongs in lessons-learned.md
written: YYYY-MM-DDTHH:MM:SSZ
---

# Postmortem — {SYMBOL} {DIRECTION} — {DATE}

> Written after every closed trade. Win or loss. The purpose is not to celebrate or mourn — it is to extract learning.
>
> **Process grade is independent of outcome.** A perfectly executed trade that lost 1R because of an unforecastable narrative shift is A-grade process. A sloppy trade that won 3R by luck is D-grade process.

---

## What I Expected

*Copy the thesis_snapshot and confluence from the trade file. What was I betting on?*

## What Actually Happened

*Narrative of the trade. Key moments. When did it go right / wrong?*

- [HH:MM] — [event]
- [HH:MM] — [event]

## The Delta

*What was different from my expectation? Name the gap.*

- **Market did:** [what]
- **I expected:** [what]
- **The gap was caused by:** [structural shift? news? volume? execution? my misread?]

## Process Review

Check each question honestly:

- [ ] **Did I follow the Entry Rules?** (all 6 steps of the decision tree)
- [ ] **Was my SL structurally placed, within 2%/3% caps, and set within 5 min?**
- [ ] **Did I size according to risk_r, not emotion?**
- [ ] **Did I update Trades/ file as the position evolved?**
- [ ] **Did I resist adding to the loser / moving SL / tightening TP?**
- [ ] **Did I close for the right reason (not panic, not greed)?**
- [ ] **Did I write this postmortem within 1 hour of close?**

**Process grade: [A / B / C / D / F]**

*Justification: [one sentence]*

## Lesson

*If this trade produced a generalizable lesson, write it here. Otherwise, say "no new lesson — existing rules sufficient."*

**Lesson statement:** [single sentence, imperative form]

**Why it generalizes:** [why this applies beyond this one trade]

**Tag(s):** from the vocabulary in `Playbook/lessons-learned.md`

**Action:** 
- [ ] Add to `Playbook/lessons-learned.md` (if `generalizable: true`)
- [ ] Update Thesis/{SYMBOL}.md to reflect new view
- [ ] Update Watchlist (remove invalidated setups, add new ones)

## Outcome Attribution

*What share of the outcome was process (me) vs. luck (market)?*

- **Process contribution:** [%] — [what I controlled]
- **Luck contribution:** [%] — [what I didn't]

*A perfectly-executed process should produce wins and losses both. If I only win when process is clean and only lose when process is sloppy, luck played no role. If outcomes diverge from process grades, luck is significant.*

## What I'd Do Differently

*If I saw the same setup tomorrow, given the same pre-trade information, would I take it the same way?*

- [ ] Yes, exactly the same
- [ ] Yes, same entry, different management
- [ ] No, different entry
- [ ] No, wouldn't take it at all

*Justification:*
