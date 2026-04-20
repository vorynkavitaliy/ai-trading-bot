---
date: 2026-04-20
symbol: BNBUSDT
direction: Long
opened: 2026-04-20T07:31:00Z
closed: 2026-04-20T08:30:00Z
hold_min: 59
entry: 626
exit: 623.8
sl: 622
tp: 634
r_multiple: -0.69
pnl_usd: -435.50
process_grade: A-
outcome_grade: C
---

# Postmortem — BNBUSDT LONG 2026-04-20

## Thesis at entry (C556-C559, 07:22-07:31 UTC)

Bull breakout at London open. Cluster explosion 8/8 bos_15m bullish + 3/8 bos_1h bullish (BTC/ETH/BNB). Momentum PDI>MDI universal cross. BNB specifically: EMA55 retest @ 625.3 after sweep high 624, OBV slope improving, ADX 25.7 trending, A-setup 10/12.

Entry: limit 626 (0.30% pullback от 627.9 per limit-distance rule). SL 622 (0.12 pt buffer above EMA21 621.88). TP 634 (structural swing). R:R 2.0. Risk 0.25% effective (0.5% base × news mult 0.5).

## Life of trade

Position went immediately underwater:
- Fill 07:31 → dropped к -0.71R by 07:54 (worst adverse excursion)
- Key moment C567-C568: broader market flipped (BTC bos_1h lost, cross_pair 7/8 → 4/8) while BNB bos_1h stayed bullish
- Applied rubric discipline: SHORT opposite never reached 8/12 threshold (stayed at 4/12)
- Bounce C570 post-funding: market reclaimed bos_1h bull on BTC+ETH+BNB (3/3), BNB recovered к -0.25R
- Chop 08:00-08:30 в range 624-625
- C579: BNB 3m BOS flipped bearish (first BNB-specific bearish signal) + alt rotation emerging
- C580: **BTC eff_regime flipped к bear** (chg5_15m -0.54% crossed -0.5% threshold)
- Immediate close @ market per pre-defined invalidation

## Close details

**Exit**: Market close, order 80ba6dfa, price ~623.8 both subs.
**Slippage**: minimal — 0.06 pts от mark 623.74.
**PnL from Bybit**: -$85.72 (50k) / -$349.78 (200k) = -$435.50 total (-0.18% combined).
**R multiple**: -0.69R.
**DD impact**: 0.18% daily / 1.31% total — well within 5%/10% limits.

## Process grade: A-

**What I did right**:
1. **Followed pre-defined invalidation criteria exactly**. When BTC eff_regime flipped к bear (criterion #3 from trade file), closed immediately. No rationalization, no hoping.
2. **Discipline через -0.71R adverse excursion** (C567). SHORT opposite scored 4/12 via rubric, pre-defined invalidation criteria не hit. Held. Position recovered к -0.25R two cycles later.
3. **No SL removal / widening**. SL 622 stayed fixed throughout.
4. **Correct sizing**. 0.25% risk × news mult 0.5 = modest exposure, -0.69R loss = well-defined impact.
5. **Position survived** 45-min adverse excursion because я trusted structure (bos_1h bull, EMA21 support) over anxiety.

**What I could have done better**:
1. **Entry timing marginal**. Took 10/12 A-setup at ADX 24.6 (barely above 20 threshold). In hindsight, could have waited for stronger ADX (≥28) confirmation. Would have missed entry but avoided marginal bull continuation setup.
2. **BTC regime watch**: could have watched `chg_5_15m` more proactively. Regime flipped к bear at 08:30 UTC when chg5_15m crossed -0.5%. Was I could have seen the deterioration trend for 2-3 cycles before flip (-0.07% C568 → -0.12% C571/572 → -0.54% C580). Early close at 624 vs 623.8 wouldn't save much but cleaner process.

## Outcome grade: C

-0.69R net on 10/12 A-setup. Pre-market expectation was +2R hit on TP 634 (~$1,250 combined). Actual -$435.50. Standard losing trade on decent setup — sample size дёшево in prob sense.

No missed big moves (BTC/ETH never reached TP-related levels during the trade life).

Pre-defined invalidation saved $190 vs full SL (hypothetical worst-case -1R ≈ -$625 combined).

## Lessons for Playbook

**Will add к lessons-learned.md**:

> **Pre-defined trade-specific invalidation criteria > generic rubric opposite scoring for close decisions.** When I open a trade, I write 3-5 specific invalidation rules в the trade file. These are set WHEN I have full context of the setup. Honor them strictly — they're stricter AND more informed than scoring SHORT opposite via 12-factor rubric. 2026-04-20: BNB LONG closed when BTC eff_regime flipped к bear per trade file rule, even though rubric SHORT was only 5/12 (below 8 exit threshold). Saved -0.31R vs SL hit.

## Decision quality matrix

| Decision | Grade | Why |
|---|---|---|
| Entry @ 626 limit pullback | A | Correct application of limit-distance rule, tighter entry than initial 625.5 |
| HOLD at -0.71R (C567-C568) | A | Rubric discipline, SHORT 4/12 unambiguously below threshold |
| Close on BTC regime bear (C580) | A | Pre-defined invalidation trigger, exact rule-following |
| SL placement at 622 | B+ | Structurally correct (below EMA21 + 0.12 buffer), but wide enough that -0.71R excursion happened. Tighter 623 would have stopped out на first attack but would have prevented re-test. Trade-off. |
| TP at 634 | A | Structural swing area, 2.0 R:R, realistic target given cluster thesis |

## Next trade considerations

- Market regime now BEAR (BTC eff_regime flipped). Next few cycles likely SHORT bias valid if confluence materializes.
- BNB specifically: failed bullish continuation → possible bearish retest of EMA21 (621.88) → EMA55 (625). Watch for sweep of low + reclaim pattern (mirror of this trade's setup).
- Don't revenge trade. Scored 0.18% DD hit, have 4.82% more к kill switch. Stay disciplined, normal confluence threshold (9/12 standard, 10/12 counter-trend).
