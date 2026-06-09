---
id: TASK-010
title: "BTC candles froze 8 days → useBtcTrend macro filter ran on stale data (8/10 pairs)"
epic: ""
sprint: ""
status: review
assignee: "claude"
reviewer: ""
severity_threshold: important
blocked_by: []
created: 2026-06-02
updated: 2026-06-02T11:35:00Z
iteration: 1
artifacts:
  - "workflow audit wf_bc0fdd3f-717 (8 agents)"
live_sensitive: true
acceptance:
  - "BTCUSDT 240m/60m candles stay fresh every cycle (backfill ingests BTC despite it not being traded)"
  - "scan-decide btcBars4h freshness guard forces useBtcTrend pairs to HOLD + logs ERROR if BTC bars >12h stale (no silent gating on stale BTC)"
  - "heartbeat reports real BTC price + regime over the 10 traded pairs (no frozen $77,358, no dead TON/DOGE/APT, includes HYPE)"
  - "FOLLOW-UP: confirm the 8 useBtcTrend pairs resume normal long/short balance now that BTC trend is live (8 days were short-biased)"
---

## Context

Operator noticed heartbeat showed BTC frozen at $77,358 (real ~$71k) for days + "7 из 13 пар" regime. A workflow audit (wf_bc0fdd3f-717, 8 agents) + direct verification found:

- **BTCUSDT candle ingestion died 2026-05-25 05:00 UTC (~8 days).** Root cause: `backfill.ts:6 SYMBOLS = tier1Pairs()` coupled the candle-ingestion universe to the trading universe. BTC was removed from `tier1Pairs` on 2026-05-24 ("0R") → silently dropped from ingestion. All other pairs stayed fresh.
- **NOT cosmetic — live trading impact.** `scan-decide.ts:508` loads `btcBars4h` from the frozen `candles` table → `ctx.btcBars4hRecent` → `cg-fade.ts:309-317 trendFiltersAllow` for `useBtcTrend:true` strategies. Factory defaults: `fundingFade`(S3) + `fundingTaConfluence`(S4) default `useBtcTrend:true`; INJ/LTC explicit true → **8/10 live pairs** (all except ETH, TAO) gated on a frozen BTC EMA20(76672)<EMA50(77221) → trendUp=false → blocked longs / permitted shorts for 8 days. No freshness gate covered btcBars4h (scan-decide.ts:96-99 only checks each pair's own 1h bars).
- Cosmetic side: `scan-summary.ts` hardcoded 13-symbol list (incl frozen BTC/TON/DOGE/APT, omitting live HYPE) → heartbeat "X из 13" + frozen BTC price.
- The "WS отключён" line in the same report is SEPARATE — the 90s WS flap (TASK-009).

## Inputs

- `src/data/backfill.ts`, `src/runtime/scan-decide.ts:508`, `src/strategies/cg-fade.ts:301-318`, `src/runtime/pair-strategies.ts:56-103`, `src/reporting/scan-summary.ts`, `src/tools/ops/heartbeat.ts`.
- Diagnostics: `src/tools/diagnostics/candle-freshness.ts` (new).

## Approach

Applied 2026-06-02 (verified live):
1. `backfill.ts:6` — `SYMBOLS = [...new Set([...tier1Pairs(), 'BTCUSDT'])]` — decouple ingestion from trading universe; BTC stays fresh as macro ref.
2. `scan-decide.ts` — freshness guard on btcBars4h (>12h stale → null + ERROR → useBtcTrend pairs HOLD).
3. `scan-summary.ts` — SYMBOLS = tier1Pairs()+BTC; `heartbeat.ts` regime excludes BTC.

Verified: typecheck clean; BTC candles fresh again (60m ~0.6h); scan-summary shows real BTC $69.4k, 10 traded pairs + BTC, HYPE present, dead pairs gone.

## Out of scope

- WS flap (TASK-009).
- Re-backtesting the strategies (separate — but see acceptance follow-up: confirm long/short balance normalizes).

## Notes

- claude 2026-06-02T11:35Z — Fix applied + live-verified, status:review for a second pair of eyes on the freshness-guard threshold (12h) and to confirm no other consumer relied on the frozen behavior. NEEDS a tester pass on acceptance #4 (long/short balance) once a few cycles run with live BTC.
