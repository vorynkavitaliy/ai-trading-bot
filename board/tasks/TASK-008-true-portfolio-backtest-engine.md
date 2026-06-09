---
id: TASK-008
title: "TRUE multi-symbol portfolio backtest engine (unified 1m timeline + shared risk state)"
epic: ""
sprint: ""
status: pending
assignee: ""
reviewer: ""
severity_threshold: important
blocked_by: []
created: 2026-05-28
updated: 2026-05-28
iteration: 0
artifacts: []
live_sensitive: false
acceptance:
  - "New file src/backtest/engine-portfolio.ts exports runPortfolioBacktest(symbolStrategies, settings) → { trades: ClosedTrade[], equityCurve?: ... }."
  - "All 8 enabled Tier-1 pairs (10 with --include-paused) share ONE BacktestRiskState: heat-cap 3.75%, trailing-peak DDD (peak−trough, matches engine.ts:78-110), per-pair cooldowns 12h SL / 4h any-close / max 2 SL/day, daily soft/hard kill, total kill."
  - "Decision cadence per symbol: every 4H close (00/04/08/12/16/20 UTC) → build StrategyContext (features1h, features4h, coinglass if needed, btc 4h bars if needsBtcContext) → strategy.decide(ctx) → shared risk-guard."
  - "Entry collision when cap full and >1 symbol passes risk-guard on same boundary: priority = order in TIER1_PORTFOLIO array. Higher-ranked pair wins the slot."
  - "Inside 1m loop: SL/TP fills, scaled-in DCA fills, funding application, MFE/MAE — reuses resolvePosition + helpers from engine.ts (export them if needed; additive only, no behavior change)."
  - "Funding window ±10min around 00/08/16 UTC blocks new entries (matches risk-guard + engine.ts honest mode)."
  - "engine.ts and pair-strategies.ts NOT modified beyond additive helper exports. Live runtime untouched."
  - "New CLI src/backtest/cli/portfolio-true.ts: argv `<days> [riskPct] [cap] [--include-paused]`. Prints AGGREGATE (FULL/TRAIN/TEST 50/50), per-pair sumR, monthly breakdown, headline (return / MaxDD close-only / Hyro-faithful intra-day DDD)."
  - "DD helpers (close-only + Hyro-faithful) shared with portfolio-live.ts via extracted module (preferred) or duplicated with rationale."
  - "Typecheck clean: `npx tsc --noEmit`."
  - "Validation run `npx tsx src/backtest/cli/portfolio-true.ts 365 0.5 6` captured to /tmp; comparison vs portfolio-live.ts 365 0.5 6 baseline (+58.49%, MaxDD 3.81%, TEST Hyro 6.37%) reported."
  - "Sanity: TRUE result similar-or-lower return than per-pair (shared heat-cap + DDD-kill blocks entries). Wildly higher (>15pp) ⇒ bug."
  - "Additional run with --include-paused (10 pairs incl ETH+XRP) captured for operator decision input."
---

## Context

Operator (2026-05-28): pushing portfolio toward +70%/year. Considering raising risk 0.5%→1.0% full-deploy and/or re-enabling ETH+XRP. ALL of these decisions currently sit on per-pair backtests + post-hoc portfolio kills (`portfolio-live.ts` calls `runBacktest` per pair with fresh state, concatenates trades, then applies `applyPortfolioKills()` which only handles cap+daily kills — NOT heat-cap, NOT cross-pair trailing DDD). Honest sim must simulate the cross-pair risk blocks DURING simulation so entries that would have been blocked never get taken in the first place. Without this, sizing changes are gambling.

## Inputs

- /root/Projects/ai-trading-bot/CLAUDE.md — strategy v4 spec, risk budget v4, funding window, cooldowns.
- /root/Projects/ai-trading-bot/src/backtest/engine.ts (932 lines) — single-symbol engine. Key bits:
  - `loadData()` patterns for 1m/1h/4h/1D/1W bars + warmup windows.
  - `BacktestRiskState` already supports trailing-peak DDD (peak−trough, lines 78-110).
  - `resolvePosition` — intra-bar TP/SL race resolution, DCA fills, funding, MFE/MAE.
  - `applySlippage`, `calcQty`, `aggregateHourlyTo`.
- /root/Projects/ai-trading-bot/src/backtest/cli/portfolio-live.ts (302 lines) — current per-pair approach + `applyPortfolioKills()` + DD helpers.
- /root/Projects/ai-trading-bot/src/backtest/cli/portfolio-trailing-peak-dd.ts (268 lines, untracked) — recent peak-trough DDD work, candidate source of shared DD helpers.
- /root/Projects/ai-trading-bot/src/runtime/pair-strategies.ts (118 lines) — TIER1_PORTFOLIO array (ETH+XRP `enabled:false`, paused 2026-05-27).
- /root/Projects/ai-trading-bot/src/runtime/risk-guard.ts — live risk-guard for parity check.
- /root/Projects/ai-trading-bot/src/backtest/types.ts — `ClosedTrade`, `BacktestSettings`, `StrategyContext`.

## Approach

To be filled by architect → tech-lead. Key design questions for architect:

1. **Timeline iteration shape.** Per-ts loop over union of all symbols' 1m ts? Or per-symbol indices advanced together? Memory cost of holding 10 symbols × 365d × 1440 min ≈ 5.3M bars in RAM. Should be fine but confirm.
2. **Decision boundary detection.** 4H closes are deterministic UTC ticks. Iterate ts; on each `ts % (4*3600*1000) == 0` boundary call decide() for each symbol. Strategy returns `'hold'` between boundaries anyway — but live runtime polls every hour at HH:00-04. Recommendation: only call decide() at 4H ticks to save CPU + match live cadence exactly.
3. **Shared state fields.** Extend or wrap `BacktestRiskState` to carry per-pair maps (last-SL-ts, last-close-ts, slCountByDay, daily P&L peak/trough). Keep open-position list cross-pair for heat sum + cap.
4. **Collision resolution.** When N candidates pass risk-guard on the same 4H tick but only K slots open: sort by TIER1_PORTFOLIO index ascending, fill K, reject rest. Document this; live runtime does NOT have this exact mechanism (runs sequentially) but it's the closest faithful approximation.
5. **DD helper extraction.** Move `computeCloseOnlyMaxDD` and `computeHyroFaithfulDDD` (and the rolling-1d helper if present) into `src/backtest/dd-utils.ts`. Both `portfolio-live.ts` and `portfolio-true.ts` import from there. Zero behavior change.
6. **Engine.ts additive exports.** What needs to escape: `loadData` (or split into per-tf loaders), `applySlippage`, `calcQty`, `resolvePosition`, `aggregateHourlyTo`, `buildStrategyContext` (if it exists as a function — else recreate the shape in engine-portfolio). Architect: enumerate exact list; we want minimal surface area.

## Out of scope

- Live runtime changes (`src/runtime/*`).
- Modifying `engine.ts` behavior (additive exports only).
- Permanent change to `pair-strategies.ts` enabled flags (use `--include-paused` override).
- Other CLIs in `src/backtest/cli/` and `src/backtest/archive/` — must keep working bit-identical.
- Walk-forward, robustness, monte carlo on top of new engine — separate follow-ups once engine itself is validated.
- Live-trial deployment decisions (sizing, ETH+XRP re-enable) — operator owns those once numbers land.

## Notes

orchestrator 2026-05-28T<T>: dispatching architect first (deep design — unified timeline + shared-state shape + helper extraction surface). Tech-lead follows to convert analysis to dev brief. Then dev → reviewer → tester.
