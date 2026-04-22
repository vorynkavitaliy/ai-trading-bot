---
symbol: BTCUSDT
direction: long
date: 2026-04-21
entry: 76084
fill: 76177
sl: 75820
tp: 76500
closed_reason: tp
r_multiple: 0.92
pnl_usd_total: 1145.10
process_grade: A
---

# Postmortem — BTCUSDT LONG — 2026-04-21

## Trade Fact Sheet

| Metric | Value |
|---|---|
| Entry planned | 76084 |
| Entry filled | 76177 (+93pt slippage) |
| SL | 75820 |
| TP | 76500 |
| R:R planned | 1.58 |
| Exit | 76500 (TP hit) |
| R-multiple | +0.92 |
| Hold time | 82 min |
| Drawdown max | −0.51R (at 07:33) |
| Peak unrealized | +$1091 (at 08:42) |
| P&L total | +$1145.10 (+0.46%) |
| Daily DD peak | 0.45% (safe, <1%) |
| Confluence | 9/12 Standard |
| Setup type | breakout (range resolution) |

## What Went Right

1. **Rubric discipline held at 9/12 threshold**. Waited 77 cycles (3:45h) before setup materialized cleanly. Asian chop session = 0 trades, correct.

2. **Flow confluence was institutional-grade**. CVD1m/5m $5.15M at entry moment = $4M buyers in 3 min. OBV accelerated к +5077 peak over session. Such size is not retail.

3. **Held through grace period drawdown**. Position went к −0.51R at 07:33 retest of 76000. Per rules: grace period enforces hold, opposite SHORT score only 5/12 = no proactive exit. Discipline preserved trade.

4. **Structure-based SL, not random**. 75820 was below prior swing low 75850 + buffer. Would have been hit cleanly if thesis invalid. Survived 5 bid-wall absorption sequences.

5. **TP hit structurally**. 76500 was htf_pivot resistance + prior_day_hl — major level for profit-taking. Price overshot к 76704 but that's market beyond planned target.

6. **XRP override earlier proven correct**. Applied Claude override at 07:00 on XRP 9/12 due к 7 ugly signals. XRP peaked near 1.4406 then faded — would have been losing trade. BTC setup was cleaner.

## What Could Improve

1. **Entry slippage $93**. Market order at moment of $5M CVD spike caught top tick of impulse (76177 vs intended 76084). Cost ~5% of planned R. 
   - **Lesson**: In vertical pump with stoch extreme, use limit entry below swing OR wait for pullback к structural level. Preserves R:R.

2. **TP placement too conservative vs final move**. Price went к 76704 (+204pt beyond TP). Potential additional capture lost к market continuation.
   - **Lesson**: For strong bos_1h+15m+3m triple confluence with CVD $5M+, consider TP at next level +1 (76700 instead of 76500) OR trail past TP with 1× ATR for momentum capture.
   - **Counter-lesson**: 76500 was valid structural target. Taking known R > waiting for unknown reward. Правильно was do the planned exit.

3. **Phantom PEND handling**. First execute.ts rejected due к stale Long 76000 limit from hours ago. Cache showed phantom, audit showed empty, reconcile showed aligned — but executor saw real limit.
   - **Lesson**: "Phantom PEND" is NOT always phantom. Always try cancel-limit first before concluding cache bug. Fix: add phantom detection via cancel-limit --check in future.

4. **Within-trade volatility was high**. 0.45% daily DD reached during retest, then recovered. Could cause panic for less disciplined operator.
   - **Lesson**: Position sizing at 0.5% was правильно — absorbed the volatility without account stress. Had sizing been higher (0.75% or 1%), pressure would have been significant.

## Process Grade: A

- Entry was rigorous 9/12 rubric-passed
- Override correctly NOT applied (counter-example: XRP was override)
- Grace period hold discipline maintained
- SL never widened (trade could have been cut only at SL 75820)
- TP hit cleanly per plan
- Vault writes completed (trade file + postmortem + journal + TG notifications)

## Key Learnings

- **Flow confluence matters more than bos alone**. Single-bar bos_15m without CVD support = 6/12 setup. bos_15m + CVD $5M = 9/12 setup. Institutional size signal is the differentiator.
- **Range regime breakouts CAN work**. HMM range 97% doesn't mean no trend — it means BTC trading within broader range. London catalyst broke the micro-range 75600-76000 into new micro-range 76000-76700.
- **Grace period saved a good trade**. Without mandatory 9-min hold, emotional exit at −$871 drawdown would have locked loss. Structure recovered, TP hit.

## Replication Checklist

For similar setup in future:
1. ✅ 9/12+ rubric confluence
2. ✅ Institutional CVD size (≥ $3M in 5m window)
3. ✅ Multi-TF structural alignment (bos_1h + bos_15m + OBV accelerating)
4. ✅ HMM regime stable (not transitioning)
5. ✅ News neutral/risk-on (not risk-off)
6. ✅ Session London+ quality (quality ≥ 1.0)
7. ⚠️ Avoid market entry at vertical pump tick — use limit below swing or wait pullback
8. ✅ SL structural (below swing + ATR buffer)
9. ✅ TP at MAJOR level (htf_pivot, not micro resistance)
10. ✅ Risk 0.5% at Standard 9/12 (correctly sized)
