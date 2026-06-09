---
id: TASK-011
title: "Backtest engine faithfulness: kill look-ahead + mirror live caps; honest config is +6.93%/yr not +88%"
epic: ""
sprint: ""
status: review
assignee: "claude"
reviewer: ""
severity_threshold: important
blocked_by: []
created: 2026-06-02
updated: 2026-06-02T13:00:00Z
iteration: 1
artifacts:
  - "audit wf_07d5d92f-44a (8 agents); review wf_04f0ddba-055 (3 agents)"
live_sensitive: false
acceptance:
  - "DONE: intra-bar SL/TP look-ahead removed (worst-case SL-first); full path sweep confirms NO look-ahead (3 reviewers)"
  - "DONE: backtest models live risk caps — configurable maxParallelPositions + rolling maxEntriesPerWindow/12h; live-cron-true-mirror set to cap-2+2/12h; sizingMode default 'dca_boost'"
  - "TODO: MTM-faithful kill-switch (attempt reverted — see notes). Backtest MaxDD currently UNDERSTATED (kill fed realized-only equity at entry attempts)"
  - "TODO: re-validate train/test vs gate (PF≥1.4, MaxDD≤4%) after MTM-kill + universe prune"
---

## Context

Operator suspected engine/backtest bugs + look-ahead. A workflow audit (wf_07d5d92f-44a) + a faithful re-run found the old +45–88%/yr figures were a fantasy of (a) intra-bar look-ahead, (b) no entry throttle, (c) cap-6 vs the temporary live cap-2, (d) per-pair-isolated sizing. The HONEST number, on a look-ahead-free engine mirroring the real target config (cap-6, NO manual entry cap, cron-realistic):

**cap-6 honest: +6.93%/yr, PF 1.07, WR 47.7%, MaxDD 10.04%, 308 trades** (exactly matches the historical "honest cron-realistic +6.93%" memory). MaxDD 10.04% BREACHES HyroTrader −10% total DD — and is UNDERSTATED (kill inert). 3 pairs bleed: ETHUSDT −8.69R (PF 0.67), HYPEUSDT −8.78R (PF 0.46), LTCUSDT −8.67R (PF 0.67).

(The operator's live cap-2 + 2/12h is a TEMPORARY manual-supervision throttle; faithfully modeled it gives −3.37% — it blocks ~95% of signals. Not the target config; just confirms the throttle is very tight.)

## Inputs

- `src/backtest/engine.ts`, `engine-portfolio.ts`, `cli/live-cron-true-mirror.ts` (env: CAP, ENTRYCAP, DROP), `cli/portfolio-live.ts`.
- Live parity sources: `src/runtime/risk-guard.ts` (RISK caps), `execute.ts` (riskBaseUsd), `strategies/cg-fade.ts` (useBtcTrend, trendFiltersAllow).

## Approach (DONE this session)

1. Look-ahead: `engine.ts` resolvePosition `tpFirst=false` — always worst-case SL-first on straddle bars (removed the close-vs-open end-of-minute heuristic). Verified look-ahead-free across decision/CG/D-W/fill/funding by 3 reviewers.
2. Caps: `BacktestRiskState` + `makeBacktestRiskState(start, ts, opts)` now carry maxParallelPositions / maxEntriesPerWindow / entryCapWindowMs / entryTsLog; `checkBacktestRisk` enforces both; `recordBacktestEntry` at all 4 open sites; engine-portfolio threads settings; live-cron-true-mirror sets cap-2 + 2/12h (env-overridable). sizingMode default → 'dca_boost'.

## Out of scope / TODO (NOT done)

- **MTM-faithful kill-switch — ATTEMPTED AND REVERTED.** First attempt (`markBacktestMtm` feeding per-boundary MTM into the daily peak/trough + a kill latch) had a BUG: it shared `dailyPeakEquity` with `checkBacktestRisk`'s own kill and reset the peak on MTM upticks → silently disabled the working kill → absurd +64.74% (a kill can't INCREASE return). Reverted fully; control re-run confirmed +6.93% restored. Redesign needed: a SEPARATE MTM peak/trough (not shared with checkBacktestRisk), per-1m sampling in engine-portfolio, latch blocks entries (not flatten). Until then backtest MaxDD understates live.
- Universe prune (drop ETH/HYPE/LTC) + train/test re-validation — next experiment.

## Notes

- claude 2026-06-02T13:00Z — Engine is now look-ahead-free + caps-faithful (verified). VERDICT for the operator's question "can I remove the manual limits?": NOT yet — honest target config is marginal (+6.93%, PF 1.07) and MaxDD ≥10% breaches Hyro (understated). Path: fix MTM-kill (true MaxDD) → prune bleeder pairs → re-validate vs gate.
