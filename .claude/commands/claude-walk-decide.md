---
description: "Stage 3.5 Claude Walk: process N pending snapshots from vault/Backtest/queue.json. Read each as if live, decide enter/skip, write decision file."
argument-hint: "<batch_size> (default 5)"
---

# Claude Walk — Decide on Historical Snapshots

You are the **trader** evaluating historical setups. You DO NOT see future bars beyond the snapshot's `meta.ts`. Your job is to decide as if you were live at that moment.

## Inputs

- `vault/Backtest/queue.json` — list of all candidate moments. Process the first `${1:-5}` entries with `status: pending`.
- For each entry, load `vault/Backtest/snapshots/{id}.json` — that's all the data you have.

## Snapshot fields (v3, Coinglass-enriched)

```yaml
meta:
  id: BTCUSDT_2026-01-12T14-00
  symbol: BTCUSDT
  ts: <unix ms>
  iso: 2026-01-12T14:00:00.000Z
  price: 77580.0
  reasons:
    - { kind: bb_touch_lower, detail: "..." }
    - { kind: rsi_extreme_low, detail: "..." }

# Recent OHLCV windows
bars1h:  [...50 bars...]      # 1H, oldest→newest, ending at meta.ts
bars15m: [...100 bars...]     # 15m, last 25 hours
bars5m:  [...100 bars...]     # 5m,  last ~8 hours

# Indicator snapshots at meta.ts (computed only on data ≤ meta.ts)
features:
  h1:  { bb_upper, bb_middle, bb_lower, rsi, atr, atr_pct, ema8, ema21, ema55, ema200,
         ema_stack_aligned, adx, pdi, mdi, macd, macd_signal, macd_hist,
         volume, volume_sma20, volume_spike, obv }
  m15: { ... same ... }
  m5:  { ... same ... }

fundingRate: <Bybit own funding rate at moment>

# Cross-exchange aggregates (Coinglass, 4h granularity, value at-or-before meta.ts)
coinglass:
  oi_close: <USD, total OI across major exchanges>
  oi_delta_24h: <USD, close − close 24h before>
  oi_pct_chg_24h: <%, signed>
  funding_oi_weighted: <fraction, e.g. 0.0001 = 0.01%>
  funding_vol_weighted: <fraction>
  ls_global_account: <Binance global retail L/S; >1 = more longs>
  ls_top_account: <Binance top trader by account count>
  ls_top_position: <Binance top trader by capital — "smart money">
  liq_long_24h_usd: <Binance long liqs sum, last 24h>
  liq_short_24h_usd: <Binance short liqs sum, last 24h>
  taker_buy_24h_usd: <Binance taker buy volume, 24h>
  taker_sell_24h_usd: <Binance taker sell volume, 24h>
  taker_delta_24h_usd: <buy − sell; positive = aggressive buying>

hint: { bb_upper_1h, bb_middle_1h, bb_lower_1h, ema55_1h, atr_1h, adx_1h }
```

## Decision template

For each snapshot, write `vault/Backtest/decisions/{id}.md`:

```yaml
---
id: {id}
symbol: {symbol}
ts: {ts}
decidedAt: {now ISO}
decision: enter_long | enter_short | skip
# if enter:
entryPrice: {number}
sl: {number}
tp1: {number}
tp2: {number}              # optional
sizePct: 0.6               # default risk; bump only with strong rationale
rationale: "1-2 sentences citing what you saw in the snapshot"
# if skip:
reason: "1 short sentence why"
---
```

After writing, update `vault/Backtest/queue.json` to set the entry's `status` to `decided`.

## Heuristics for reading the new Coinglass fields

These are **inputs to judgment**, not mechanical rules. Combine with TA, never use alone.

| Signal | Reading |
|---|---|
| `oi_pct_chg_24h > +5%` AND price up | New longs entering — bullish continuation likely. Don't fade. |
| `oi_pct_chg_24h > +5%` AND price down | New shorts entering — bearish continuation likely. Don't fade. |
| `oi_pct_chg_24h < −5%` AND price up | Shorts covering (squeeze fuel exhausting) — pause may follow. |
| `oi_pct_chg_24h < −5%` AND price down | Longs liquidating — capitulation possible at extremes. |
| `funding_oi_weighted < −0.03%` (extreme negative) | Shorts paying premium → squeeze setup if structural support holds. |
| `funding_oi_weighted > +0.03%` (extreme positive) | Longs paying premium → flush setup if structural resistance holds. |
| `ls_top_position` diverges from `ls_global_account` | Smart money positioning against retail — usually faded by retail. |
| `liq_short_24h_usd >> liq_long_24h_usd` (5×+) | Big short squeeze just happened — top of move often near. |
| `liq_long_24h_usd >> liq_short_24h_usd` (5×+) | Big long flush just happened — bottom of move often near. |
| `taker_delta_24h_usd > 0` strongly | Aggressive buying past 24h — momentum bias up. |
| `taker_delta_24h_usd < 0` strongly | Aggressive selling past 24h — momentum bias down. |

## Decision rules (informal — strategy.md is empty until Stage 4)

While v3 strategy is being calibrated, decide based on intrinsic merit:

- **Range fade (BB-touch + RSI extreme + ADX low) — favourable when:**
  ATR_pct ≥ 0.4 (avoid squeezes), no strong directional Coinglass divergence
  (funding extreme + L/S extreme in same direction = avoid fade), volume spike present.
- **Trend pullback (EMA55-touch + ADX ≥ 25 + EMA stack aligned) — favourable when:**
  Pullback is confirmed (close back across EMA55 or stalls at it), DI agrees with stack
  direction, OI growing in stack direction, no exhaustion divergence on RSI.
- **Counter-trend BB-touch in strong trend:** SKIP. Fading a trending market is dangerous.
- **Squeeze (ATR_pct < 0.4) + BB-touch:** SKIP. Squeezes break out, not mean-revert.
- **No clear setup:** SKIP. Skipping is a valid answer; it doesn't cost R.

## Process

For each pending snapshot in batch:

1. Read snapshot JSON. Focus on `features.h1`, `bars1h` (last ~30 to see recent structure),
   `coinglass` aggregates, `bars15m` for entry timing.
2. Look at the price action structurally — range / breakout / trend / chop?
3. Cross-check Coinglass: does the cross-exchange picture confirm or contradict the local 1H signal?
4. Decide: enter or skip. If enter — set realistic SL (tight enough to be meaningful, wide
   enough to survive ATR noise) and TP (target visible structural level).
5. Write `vault/Backtest/decisions/{id}.md` with frontmatter above + 1-paragraph note below `---`
   if you saw something noteworthy.
6. Update `queue.json` to mark entry as `decided`.

## Discipline

- DO NOT look at future bars. Snapshot is your information universe.
- Conservative bias: if in doubt, skip. Many small skips beat one bad entry.
- Rationale must be falsifiable: "BB-touch + RSI 28 + low ADX 17, funding −0.04%, taker delta
  +$2M — coiled spring up; target middle BB at $X" beats "feels like a bottom."
- Save decisions in batches; resolve.ts and report.ts run AFTER the queue is fully decided.

## After batch — short report

Tell the operator:
- How many decided this run (enter / skip).
- How many remain pending in queue.
- Notable patterns observed (e.g., "Saw 4 BB-touches but 3 had ADX>25 → skipped — the
  candidate filter is too loose for trend conditions").

## Final phase (when pending == 0)

- Run `npm run walk:resolve` (simulates outcomes).
- Run `npm run walk:report` (aggregates).
- Read `vault/Backtest/report.txt`, write 5–10 bullet calibration summary to `vault/Playbook/lessons-learned.md`.
- Identify candidate rules with statistical edge → propose them for `vault/Playbook/strategy.md` v3.
