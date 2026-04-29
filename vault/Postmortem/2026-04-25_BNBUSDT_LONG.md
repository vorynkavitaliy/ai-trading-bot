---
date: 2026-04-25
symbol: BNBUSDT
direction: long
entry: 630.40
exit: 628.50
sl_actual: 624.00
sl_strategy: 630.30
tp: 635.80
realized_r: -0.34
pnl_usd: -274
fees_usd: ~95
hold_min: 294
playbook: A
regime_at_entry: range
regime_at_exit: transition (forming bear trend)
exit_reason: playbook-A-abort-ADX-28.9-pre-TP1
operator_override: true
process_grade: B
---

# Postmortem — BNBUSDT LONG (2026-04-25)

## Outcome

- **Entry:** 630.40 @ 15:34 UTC (200k account, after 50k SL hit operator manually re-opened)
- **Exit:** ~628.50 @ 20:28 UTC (close-now market)
- **Hold:** ~4h 54m
- **Realized:** −0.34R / −$274 / −$95 fees est
- **Daily DD impact:** 200k 0.14% → 0.27%, 50k 0.48% (combined day ~−$560)

## Process Grade — B

**Why B (not A):**
1. **/clear discontinuity created split decision.** Previous Claude (20:07 UTC, C2360) flagged ADX 28.9 abort signal but explicitly deferred to operator until 21:00 UTC bar close — operator-override respect. Fresh Claude after /clear (20:25 UTC) didn't read journal tail (read offset=1 limit=200, capturing only Asian session) and applied §A abort strictly. Outcome OK financially (−$274 vs likely −$907 SL hit), but two sessions made conflicting decisions.
2. **Outcome correct per strategy.** §A Abort rule explicit: ADX(14, 1H) ≥ 28 до TP1 → close market. ADX 28.9 sustained 4 cycles (C2360-C2363, ~18 min). MDI 30.6 vs PDI 8.9 — extreme bearish separation. EMA stack flipping. Holding LONG against forming bear-trend = fighting tape.
3. **EV math validated close.** Hold scenario: 80% prob SL hit @624 (−$907) + 20% TP @635.80 (+$590) = EV −$608. Close certain −$274. Saved ~$334 expected.

**Why not C/D:**
- Position closed before SL widened the loss further
- All process steps logged (journal, trade file, telegram x2, vault thesis update, lesson)
- Telegram alert sent immediately on close + follow-up explaining context split

**Why not A:**
- Process miss: failed to read journal tail before acting on existing position. Fixable with explicit rule «with open position, read journal end-to-end».

## What Worked

- **Strategy abort rule fired correctly.** ADX threshold caught regime break before SL hit. Saved meaningful capital (~$334 EV).
- **Reconcile + audit verification chain.** Pre-execute audit → close → post-execute audit → equity check from pnl-day. Clean state confirmed.
- **Telegram discipline.** Two messages: immediate alert + context follow-up. Operator informed with full reasoning.
- **Vault state convergence.** Trade file frontmatter, journal entry, BNB thesis, lesson — all updated in same cycle.

## What Failed

1. **/clear discontinuity in active-position management.** Fresh Claude session lost previous Claude's deferral plan. Strategy purity vs operator-respect conflict not codified anywhere → impromptu interpretation per session.
2. **Operator manual override без формальной маркировки.** Trade file note прозой: «Operator placed new position on 200k account». Нет structured field в frontmatter (`operator_override: true`, `defer_until`). Fresh sessions не парсят prose notes.
3. **Phase 1 journal truncation.** Read offset=1 limit=200 — caught Asian session, missed late-day cycles where active position is being managed. With open position, mandatory read full journal.
4. **Original 50k SL distance was too tight (0.113% от entry).** SL hit on noise — bounced from 629.40 low, position re-opened wider on 200k. Strategy says min 0.3×ATR, but actual was 0.13% / ATR 0.314% = 0.41×ATR — barely passed gate. Edge case worth flagging.

## Lessons Extracted

1. **`[clear-discontinuity]`** — Fresh session с open position MUST read full journal before any decision. Не truncate. Saved as lesson.
2. **`[operator-override]`** — Strategy.md needs explicit rule for operator-override handling: codify defer-window OR honor strategy strictly. Currently implicit → conflict.
3. **`[bb-tight-sl]`** — Original 50k 0.113% SL hit on intraday noise. Strategy min 0.3×ATR is the floor; positions <0.4×ATR are statistically vulnerable to micro-sweeps. Consider raising min gate to 0.5×ATR for A?

## Action Items

- [ ] Add to trade file template: `operator_override: bool`, `operator_defer_until: HH:MM UTC` fields.
- [ ] Update `/trade-scan.md` Phase 1 step: «If open position exists, read full Journal/{TODAY}.md (no offset/limit truncation)».
- [ ] Re-check backtest: SL distance distribution 0.3-0.5×ATR vs win rate. If 0.3-0.4 underperforms 0.5+, raise min gate.

## Numbers (final)

| Metric | Value |
|---|---|
| Entry | 630.40 |
| Exit | ~628.50 |
| SL (Bybit/operator) | 624.00 |
| TP | 635.80 |
| Hold | 4h 54m |
| R-multiple | −0.34R |
| PnL gross | −$241 (mark diff) |
| PnL net (incl fees ~$95) | ≈−$274 |
| 200k daily DD added | +0.14pp (to 0.27% total day) |
| Combined day P&L (50k+200k) | ≈−$560 |
