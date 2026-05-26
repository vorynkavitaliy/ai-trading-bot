---
task: TASK-004
author: architect
created: 2026-05-24T13:32:20Z
iteration: 0
---

## Summary

Wave 2 DRY/KISS batch: extract a single `Position.riskUnits()` method covering 4 (not 5) live R-from-PnL callsites + 1 diagnostic, extract a `QtyNormalizer` (pure functions, not a class) covering 3 callsites, replace two bespoke retry wrappers (`withRetry` in `bybit.ts`, `withCgRetry` in `coinglass.ts`) with a generic `withRetry<T>(fn, policy)` + two `RetryPolicy` implementations, and delete 14 of the 17 listed diagnostic files (3 are referenced by `package.json` scripts and `CLAUDE.md` — keep them). No behaviour change at runtime; the change is shape-only.

## Map of territory

### #3 Position.riskUnits — callsite map

The task brief lists 5 callsites. Verification:

| # | File:line | Current code | Domain | Status |
|---|---|---|---|---|
| 1 | `src/runtime/reconcile.ts:157-158` | `const riskedUsd = Position.fromOpenTrade(t).riskedUsd(); const pnlR = riskedUsd > 0 ? totalPnl / riskedUsd : 0;` | realized-R from full Trade row | already uses `Position`, two lines collapsible to one |
| 2 | `src/runtime/position-watcher.ts:370` | `pnlR: realizedPnl / Math.max(Math.abs(pos.entryPrice - pos.dbInitialSL) * pos.dbInitialQty, 1)` | realized-R from `BybitPos` (no `OpenTrade`) | **inline formula** — primary target |
| 3 | `src/runtime/scan-decide.ts:410-411` | `rrTp1: stopDist > 0 ? tp1Dist / stopDist : 0, rrTp2: stopDist > 0 ? tp2Dist / stopDist : 0` | **planning RR ratio** (TP-distance / stop-distance), not realized-R | **AUDIT MISCLASSIFIED — DIFFERENT DOMAIN, exclude from refactor** |
| 4 | `src/tools/admin/close-trade.ts:58-60` | `const pnl = isLong ? qty * (exitPrice - entry) : qty * (entry - exitPrice); const stopDist = isLong ? entry - slV : slV - entry; const realizedR = stopDist === 0 ? 0 : (isLong ? exitPrice - entry : entry - exitPrice) / stopDist;` | realized-R from CLI args (entry/sl/exit/qty) | **inline formula** — primary target |
| 5 | `src/tools/admin/backfill-realized-r.ts:46-51` | `const stopDist = Math.abs(entry - sl); const initialQty = parseFloat(r.initial_qty); ... const riskedUsd = stopDist * initialQty; const newR = pnlUsd / riskedUsd;` | realized-R from DB row strings | **inline formula** — primary target |

**Extra callsite the audit missed:** `src/tools/diagnostics/trade-detail.ts:56-63` uses the exact same inline pattern (`stopDist * qty0` then `pnl_usd / riskUsd`). Include in refactor for completeness.

**Net: 4 live + 1 diagnostic inline-formula callsites to unify** (not 5). Scan-decide.ts:410-411 is `rrTp1/rrTp2` — that's the planned R-multiple of TP placement (distance ratio), which has a different denominator semantics (no qty, no PnL) and a different consumer (UI summary, not trade accounting). Mixing it into `Position.riskUnits` would conflate two ideas; the audit's "5 callsites" count is wrong.

**Why two API entry points are needed:** the 4 live callsites split cleanly into two shapes.

- `reconcile.ts:157` already has an `OpenTrade` row → can call `Position.fromOpenTrade(t).riskUnits(pnl)` (instance method).
- `position-watcher.ts:370`, `close-trade.ts:58-60`, `backfill-realized-r.ts:46-51`, `trade-detail.ts:56-63` have either a `BybitPos` (no `Trade`) or raw numbers (CLI args, DB row text) — they can't cheaply construct a `Position`. They need a static helper that takes `(entry, sl, qty, pnl)`.

### #4 QtyNormalizer — callsite map

| # | File:line | Current code | Notes |
|---|---|---|---|
| 1 | `src/runtime/execute.ts:150-155` | `const qtyStr = roundQtyToStep(clampedQty, info); const qtyNum = parseFloat(qtyStr); if (qtyNum <= 0) throw …; if (qtyNum < info.minOrderQty) throw …` | single qty normalization + invariant checks |
| 2 | `src/runtime/tp-planner.ts:58-65` | `const halfRaw = args.qtyNum / 2; const halfStr = roundQtyToStep(halfRaw, args.instrumentInfo); const halfNum = parseFloat(halfStr); const remNum = args.qtyNum - halfNum; const remStr = roundQtyToStep(remNum, args.instrumentInfo); if (halfNum >= … && parseFloat(remStr) >= info.minOrderQty) …` | 50/50 split with both-halves-≥minQty guard |
| 3 | `src/runtime/naked-tp-recovery.ts:74-81` | `const halfRaw = pos.size / 2; const halfStr = roundQtyToStep(halfRaw, info); const halfNum = parseFloat(halfStr); const remNum = pos.size - halfNum; const remStr = roundQtyToStep(remNum, info); if (halfNum < info.minOrderQty \|\| parseFloat(remStr) < info.minOrderQty) …` | identical to #2 logic (copy-paste) |

`roundQtyToStep` already lives at `src/core/bybit.ts:96-100` and returns `string`. The repeated boilerplate is `(rawQty) → roundQtyToStep → parseFloat → min-qty guard`, plus the 50/50 split duplication in two of three sites.

### #5 RetryPolicy — current state

`src/core/bybit.ts:23-51 withRetry`:

```
tries  = opts.tries  ?? 3
delay  = opts.delayMs ?? 500
retryable: retCode ∈ {10006, 10016} || code ∈ {ECONNRESET, ETIMEDOUT}
backoff: linear  delay * (i + 1)
log:    'bybit call retry' { label, attempt, retCode, delayMs }
```

`src/core/coinglass.ts:46-62 withCgRetry`:

```
tries  = 3 (positional)
delay  = 1500 (positional)
retryable: /rate|limit|429|busy/i.test(err.message)
backoff: linear  delay * (i + 1)
log:    'coinglass retry' { label, attempt, msg }
```

**Differences that survive abstraction:**

- Retry predicate: structured retCode check vs message regex. Must live behind a policy.
- Default delay: 500 ms vs 1500 ms. Per-policy constant.
- Default tries: same (3). Per-policy constant.
- Backoff shape: same (linear * (i+1)). Can stay shared.
- Log label string: 'bybit call retry' vs 'coinglass retry'. Derived from policy.

### #6 Diagnostics — file-by-file verdict

All 17 files exist. First-30-lines + reference scan results:

| File | LOC | Purpose (first lines) | Referenced by | Verdict |
|---|---|---|---|---|
| `cg-large-orders-raw.ts` | 21 | "Dump raw response of Large Orderbook endpoint — find actual field names" | — | **DELETE** (one-shot probe) |
| `cg-ob-depth-params.ts` | 31 | "Probe ask-bids-history with different range/depth params" | — | **DELETE** (one-shot probe) |
| `cg-ob-interval-check.ts` | 23 | "Check granularity options for ask-bids-history" | — | **DELETE** (one-shot probe) |
| `cg-ls-shape.ts` | 14 | inline raw shape dump of 3 L/S endpoints | — | **DELETE** (one-shot probe) |
| `cg-ls-deep-probe.ts` | 31 | "Probe L/S endpoint for deeper history" | — | **DELETE** (one-shot probe) |
| `cg-new-endpoints-probe.ts` | 49 | "Probe new endpoints we haven't explored yet" (ETF, premium, fear-greed) | — | **DELETE** (one-shot probe) |
| `cg-cb-premium-coverage.ts` | 32 | "Check coverage depth of Coinbase Premium and ETF Flow endpoints" | — | **DELETE** (one-shot probe) |
| `cg-orderbook-history.ts` | 18 | "Probe orderbook ask-bids history" | — | **DELETE** (one-shot probe) |
| `backfill-major-deep.ts` | 40 | "Backfill 1h+4h candles for major pairs back to 2020-03" | — | **DELETE** (one-shot, completed) |
| `backfill-1w-1m.ts` | 46 | "Backfill 1W and 1m for major pairs back to listing date" | — | **DELETE** (one-shot, completed) |
| `backfill-1m-resume.ts` | 92 | "Resume 1m backfill with longer delay (Bybit rate-limited last attempt)" | — | **DELETE** (one-shot, completed) |
| `coinglass-test.ts` | 82 | "Minimal auth probe + endpoint shapes" | `package.json: cg:test` | **KEEP — false positive, referenced by `npm run cg:test`** (also drop the script from package.json if delete is preferred — operator decision) |
| `check-instrument.ts` | 51 | "Dump instrument info + per-account equity to understand qty math" | — | **DELETE** if not used; **REVIEW** — this is an operator-grade tool, may be called manually for live debugging. Recommend keeping; if deletion is final, no incoming references found in repo. |
| `closed-pnl.ts` | 54 | "Query Bybit closed PnL for a symbol across all configured accounts" | grep hit in `reconcile.ts` and `position-watcher.ts` is the field name `closedPnl`, **not** a script reference | **DELETE** — operator-grade ad-hoc tool, no script entrypoint; grep matches are false positives |
| `risk-status.ts` | 14 | "Print current risk state" | `package.json: risk` | **KEEP — false positive, referenced by `npm run risk`** (live ops use this) |
| `check-symbol-data.ts` | 37 | "Check what historical candle data we have for a symbol" | — | **DELETE** — one-shot DB probe; `data:incremental` covers the live need |
| `tg-test.ts` | 22 | "Send a test message to the Telegram chat" | `package.json: tg:test`, `CLAUDE.md:122`, `.claude/commands/trade-scan.md:239` | **KEEP — actively required as canonical replacement for forbidden `curl -X POST api.telegram.org` (CLAUDE.md § Forbidden shell patterns)** |

**Final delete list (14 files):**

```
cg-large-orders-raw.ts
cg-ob-depth-params.ts
cg-ob-interval-check.ts
cg-ls-shape.ts
cg-ls-deep-probe.ts
cg-new-endpoints-probe.ts
cg-cb-premium-coverage.ts
cg-orderbook-history.ts
backfill-major-deep.ts
backfill-1w-1m.ts
backfill-1m-resume.ts
check-instrument.ts
closed-pnl.ts
check-symbol-data.ts
```

**Keep (3 files, audit false positives):**

- `tg-test.ts` — documented in `CLAUDE.md` as the canonical Telegram-test entry point.
- `risk-status.ts` — `npm run risk` is used in live ops.
- `coinglass-test.ts` — `npm run cg:test` script; smoke check for CG key. Operator may choose to drop the script too — but absent that decision, leave both file and script in place.

## Design

### Position.riskUnits API

Place on `src/core/position.ts`. Two complementary surfaces — one for the case that already has an `OpenTrade` (reconcile path), one for the case that has raw numbers (watcher, CLI tools, diagnostic).

```ts
// Instance method — uses the Position's own initialQty + entry + sl.
// Returns 0 if either price leg is null or the stop distance is degenerate.
riskUnits(pnlUsd: number): number {
  const risked = this.riskedUsd();
  return risked > 0 ? pnlUsd / risked : 0;
}

// Static helper — for callers that don't have an OpenTrade row.
// Same semantics; null on either price is treated as "no risk math possible" → 0.
static riskUnitsFromRaw(args: {
  entryPrice: number;
  sl: number;
  initialQty: number;
  pnlUsd: number;
}): number {
  const { entryPrice, sl, initialQty, pnlUsd } = args;
  const risked = Math.abs(entryPrice - sl) * initialQty;
  return risked > 0 ? pnlUsd / risked : 0;
}
```

**Why the named-args static signature** (not positional `(entry, sl, qty, pnl)`): one of the audit lessons that produced TASK-002 was "positional R-args invite swapping `qty` and `initialQty`." Forcing a name-tag at the boundary is one more line of defence; the cost is one object literal at the callsite.

**Corner cases:**

- `entryPrice` or `sl` null → returns 0 (matches current behaviour in reconcile, and the `Math.max(..., 1)` defensive divisor in position-watcher).
- `pnlUsd` could be a number or `parseFloat`'d string at the callsite — type-side already number when reaching the helper, so no string handling inside.
- The `position-watcher.ts:370` callsite currently uses `Math.max(denom, 1)` as the divisor floor. The new helper returns 0 in the degenerate case instead of dividing by 1, which is a behaviour change but in the correct direction (a "0 R" reading on degenerate input is more honest than "≈ pnl R" which `Math.max(..., 1)` produces). The dev brief flags this so the reviewer can confirm.

### Callsite rewrite mapping

| # | Before | After |
|---|---|---|
| 1 | `src/runtime/reconcile.ts:157-158` two lines | `const pnlR = Position.fromOpenTrade(t).riskUnits(totalPnl);` (one line; drop the `riskedUsd` local) |
| 2 | `src/runtime/position-watcher.ts:370` inline `Math.max(...)` divisor | `pnlR: Position.riskUnitsFromRaw({ entryPrice: pos.entryPrice, sl: pos.dbInitialSL, initialQty: pos.dbInitialQty, pnlUsd: realizedPnl })` |
| 3 | `src/tools/admin/close-trade.ts:58-60` ternary | `const pnl = isLong ? qty * (exitPrice - entry) : qty * (entry - exitPrice); const realizedR = Position.riskUnitsFromRaw({ entryPrice: entry, sl: slV, initialQty: qty, pnlUsd: pnl });` |
| 4 | `src/tools/admin/backfill-realized-r.ts:46-51` | `const newR = Position.riskUnitsFromRaw({ entryPrice: entry, sl, initialQty, pnlUsd });` (the `stopDist <= 0 || initialQty <= 0` guard becomes implicit in `riskedUsd() > 0`) |
| 5 (bonus) | `src/tools/diagnostics/trade-detail.ts:57,59,62-63` | Same `Position.riskUnitsFromRaw({...})` calls. Three callsites in this file. |

### QtyNormalizer API

Per TEAM.md § 4 ("OOP where state exists. Pure transformations stay as functions"), this is **pure functions, not a class** — there's no per-instance state, no lifecycle. Place at `src/core/qty-normalizer.ts`.

```ts
import { InstrumentInfo, roundQtyToStep } from './bybit';

export interface NormalizedQty {
  qtyStr: string;
  qtyNum: number;
  /** True when the rounded qty respects both the qty step and the min-order floor. */
  valid: boolean;
}

/**
 * Round qty to exchange step and re-parse. valid=false when the rounded value
 * falls below `info.minOrderQty` — callers decide whether to throw or skip.
 * Never throws.
 */
export function normalizeQty(rawQty: number, info: InstrumentInfo): NormalizedQty {
  const qtyStr = roundQtyToStep(rawQty, info);
  const qtyNum = parseFloat(qtyStr);
  const valid = qtyNum > 0 && qtyNum >= info.minOrderQty;
  return { qtyStr, qtyNum, valid };
}

/**
 * Split `total` into two halves rounded to step. The first leg is `floor(total/2)`
 * snapped to step; the remainder is whatever's left. Both legs must individually
 * pass minOrderQty for the split to be considered valid.
 */
export interface SplitQty {
  first: NormalizedQty;
  rest: NormalizedQty;
  /** True only when BOTH legs are individually valid. */
  valid: boolean;
}

export function splitQtyHalves(total: number, info: InstrumentInfo): SplitQty {
  const halfRaw = total / 2;
  const first = normalizeQty(halfRaw, info);
  const rest = normalizeQty(total - first.qtyNum, info);
  return { first, rest, valid: first.valid && rest.valid };
}
```

**Why not a class:** `QtyNormalizer` would have no fields and no methods that depend on each other — it's a namespace of two pure functions. A class here would force callers to instantiate or import a singleton for no benefit. TEAM.md § 4 explicitly prefers pure functions in this shape.

**Why min-qty check inside `valid` rather than throwing:** the three callsites diverge on what to do when invalid — `execute.ts` throws (refuse entry), `tp-planner.ts` falls through to SingleLimit, `naked-tp-recovery.ts` logs and returns null. The boundary stays where the policy lives, not in the normalizer.

### Callsite rewrite mapping

| # | Before | After |
|---|---|---|
| 1 | `execute.ts:150-155` | `const { qtyStr, qtyNum, valid } = normalizeQty(clampedQty, info); if (!valid) throw new Error(\`qty ${qtyNum} invalid for ${args.symbol} (step ${info.qtyStep}, min ${info.minOrderQty})\`);` |
| 2 | `tp-planner.ts:58-65` | `const split = splitQtyHalves(args.qtyNum, args.instrumentInfo); if (split.valid) { const tp1Ok = await this.placeLimitLeg(args, split.first.qtyStr, tp1, args.tp1LinkId, 'tp1'); const tp2Ok = await this.placeLimitLeg(args, split.rest.qtyStr, tp2, args.tp2LinkId, 'tp2'); … } // else fall through to SingleLimit as today` |
| 3 | `naked-tp-recovery.ts:74-81` | `const split = splitQtyHalves(pos.size, info); if (!split.valid) { log.warn('naked-TP re-place skipped: qty too small to split', …); return null; }` then `split.first.qtyStr` / `split.rest.qtyStr` in the submitOrder calls. |

### RetryPolicy API

New file: `src/core/retry-policy.ts`. Two policy classes (state-free but using classes for the type discipline — `RetryPolicy` is an OOP-style behaviour bundle, justified by polymorphism).

```ts
import { log } from './logger';

export interface RetryPolicy {
  readonly label: string;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  isRetryable(err: unknown): boolean;
  /** Linear backoff by default — override if a policy wants exponential. */
  delayMs(attempt: number): number;
}

export class BybitRetryPolicy implements RetryPolicy {
  readonly label = 'bybit';
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  constructor(opts: { maxAttempts?: number; baseDelayMs?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
  }
  isRetryable(err: unknown): boolean {
    const e = err as any;
    const retCode = e?.retCode ?? e?.code;
    return retCode === 10006 || retCode === 10016
        || e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT';
  }
  delayMs(attempt: number): number {
    return this.baseDelayMs * (attempt + 1);
  }
}

export class CoinglassRetryPolicy implements RetryPolicy {
  readonly label = 'coinglass';
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  constructor(opts: { maxAttempts?: number; baseDelayMs?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1500;
  }
  isRetryable(err: unknown): boolean {
    const msg = (err as any)?.message ?? String(err);
    return /rate|limit|429|busy/i.test(msg);
  }
  delayMs(attempt: number): number {
    return this.baseDelayMs * (attempt + 1);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  opts: { callLabel?: string } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < policy.maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!policy.isRetryable(err) || i === policy.maxAttempts - 1) break;
      log.warn(`${policy.label} call retry`, {
        label: opts.callLabel ?? 'unknown',
        attempt: i + 1,
        delayMs: policy.delayMs(i),
      });
      await new Promise((r) => setTimeout(r, policy.delayMs(i)));
    }
  }
  throw lastErr;
}
```

**Migration of `src/core/bybit.ts:23-51`:** delete the local `withRetry` definition. Add `import { withRetry as withRetryGeneric, BybitRetryPolicy } from './retry-policy';` (rename-on-import to avoid shadowing). Export a project-local shim:

```ts
const bybitPolicy = new BybitRetryPolicy();
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const policy = (opts.tries !== undefined || opts.delayMs !== undefined)
    ? new BybitRetryPolicy({ maxAttempts: opts.tries, baseDelayMs: opts.delayMs })
    : bybitPolicy;
  return withRetryGeneric(fn, policy, { callLabel: opts.label });
}
```

This preserves the existing call-shape (`withRetry(fn, { tries, delayMs, label })`) across all consumers in `bybit.ts`, `execute.ts`, `position-watcher.ts`, `reconcile.ts`, `risk-guard.ts`, `naked-tp-recovery.ts`, `tp-planner.ts`. Zero changes outside `core/bybit.ts` and the new file — important because the consumer count is large (grep shows 40+).

**Migration of `src/core/coinglass.ts:46-62`:** same shim approach. Delete the local `withCgRetry`, add:

```ts
import { withRetry as withRetryGeneric, CoinglassRetryPolicy } from './retry-policy';
const cgPolicy = new CoinglassRetryPolicy();
export async function withCgRetry<T>(fn: () => Promise<T>, label: string, tries = 3, delayMs = 1500): Promise<T> {
  const policy = (tries !== 3 || delayMs !== 1500)
    ? new CoinglassRetryPolicy({ maxAttempts: tries, baseDelayMs: delayMs })
    : cgPolicy;
  return withRetryGeneric(fn, policy, { callLabel: label });
}
```

(`withCgRetry`'s signature is positional, so we keep it; consumers in `coinglass-features.ts` etc. don't change.)

The acceptance criterion says "withRetry in bybit.ts and withCgRetry in coinglass.ts заменены на единый generic withRetry<T>(fn, policy, label)". The shims keep the external API to minimise blast radius; the **generic** lives in `retry-policy.ts`. Callers that want to migrate to the direct generic can do so incrementally. This is the smaller-blast-radius interpretation of the acceptance criterion and the dev brief calls it out.

### Diagnostics deletion list (after grep verification)

Same as the table above. 14 files via `git rm`. None of the 14 has any incoming reference from `package.json`, `scripts/`, `.claude/`, `CLAUDE.md`, or `src/`.

```
git rm src/tools/diagnostics/cg-large-orders-raw.ts
git rm src/tools/diagnostics/cg-ob-depth-params.ts
git rm src/tools/diagnostics/cg-ob-interval-check.ts
git rm src/tools/diagnostics/cg-ls-shape.ts
git rm src/tools/diagnostics/cg-ls-deep-probe.ts
git rm src/tools/diagnostics/cg-new-endpoints-probe.ts
git rm src/tools/diagnostics/cg-cb-premium-coverage.ts
git rm src/tools/diagnostics/cg-orderbook-history.ts
git rm src/tools/diagnostics/backfill-major-deep.ts
git rm src/tools/diagnostics/backfill-1w-1m.ts
git rm src/tools/diagnostics/backfill-1m-resume.ts
git rm src/tools/diagnostics/check-instrument.ts
git rm src/tools/diagnostics/closed-pnl.ts
git rm src/tools/diagnostics/check-symbol-data.ts
```

**Do NOT delete** (untracked, parallel operator work, per task brief): `btc-*.ts`, `grid-engine.ts`, `cg-coverage.ts`, `cg-schema-dump.ts`, `dw-scrub-task003.ts`, `grid-math.ts`. None are in the audit list anyway.

## Alternatives considered and rejected

### Option B for #3: extend `Position` to absorb watcher's `BybitPos` shape

Would let position-watcher.ts say `Position.fromBybitPos(pos).riskUnits(pnl)`. Rejected because `BybitPos` carries exchange-runtime fields (`bybitPos.size`, `curSL`, `unrealisedPnl`) that have nothing to do with the static R-math, and forcing every callsite to instantiate a `Position` to call one math helper inverts the abstraction (the math is simpler than the object). A static `riskUnitsFromRaw` keeps the math at the level it lives.

### Option B for #4: a `QtyNormalizer` class with `info` injected in the constructor

`const norm = new QtyNormalizer(info); norm.normalize(qty); norm.splitHalves(qty);`. Rejected — adds a construction step per call (info already lives at the callsite, no reuse benefit) and is the exact "OOP for transformations" anti-pattern TEAM.md § 4 warns against. Pure functions taking `info` as the second arg is shorter and as readable.

### Option B for #5: drop the bybit/coinglass shims and update every consumer

`withRetry(fn, new BybitRetryPolicy(), { callLabel })` everywhere. Rejected as scope creep — 40+ callsites touched, all in live-trading-sensitive paths, for zero behaviour change. The shim preserves call-site shape; the generic is available for new code. TEAM.md § 4 KISS: "Three similar lines beat a premature abstraction" applies to migration scope too.

### Option B for #6: also delete the three "kept" diagnostics + their package.json scripts

`tg-test`, `risk-status`, `coinglass-test`. Rejected because:

- `tg-test.ts` is cited in `CLAUDE.md § Forbidden shell patterns` as the **mandated** replacement for `curl -X POST api.telegram.org`. Deleting it would create a forbidden-pattern trap (no allowed alternative).
- `risk-status.ts` is live ops (`npm run risk` is daily operator use).
- `coinglass-test.ts` is a key-validity smoke (`npm run cg:test`), used when CG outages confuse the cron pipeline.

If the operator wants those gone, they should be on a separate cleanup task, not this one.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `withRetry` shim subtly changes behaviour on edge attempt counts | low | Identical loop shape; the only semantic change is *which class object* holds the state. Unit-equivalent. Tester runs smoke-pipeline and confirms one bybit call + one cg call observe a retry log. |
| `Position.riskUnitsFromRaw` returns 0 where watcher previously got `pnl/1` | low | The only consumers of that field are Telegram `pnlR` strings and downstream logging. A "0R" reading on degenerate stop-distance is more honest than the current "≈ pnlR" artifact. Flag for reviewer. |
| Splitting halves: rounding mode mismatch | low | `splitQtyHalves` uses identical math (`roundQtyToStep` then subtract from total) to the inline copies — proved by reading the three callsites side-by-side. |
| `git rm` deletes a file someone still imports | low | The grep scan covered `*.ts`, `*.json`, `*.md`, `*.sh` across the repo (excluding `vault/`, `node_modules`, `.git`); no incoming references for the 14 deletions. Typecheck and smoke catch anything missed. |
| `bybit.ts` shim hides the new policy from new callers | low | The new `withRetry<T>(fn, policy, opts)` is exported from `retry-policy.ts` and importable directly. The shim is for `bybit.ts`'s own re-export. Documented in dev brief. |

## Live-trading impact

`live_sensitive: true` per the task frontmatter. Inviolables touched:

- **Server-side SL within 5 minutes** — `execute.ts:150-155` change uses `normalizeQty` whose math is identical to the inline version; the qty going to Bybit's `submitOrder` is bit-identical. SL parameter unchanged.
- **Edit-never-cancel SL** — not touched.
- **Pre-trade risk-check** — `riskedUsd` semantics unchanged (Position.riskedUsd is the source of truth, riskUnits just adds pnl divisor).
- **Reconcile** — `reconcile.ts:157-158` collapses to one expression with the same denominator; no DB write semantics change.

**Walk-forward re-run NOT required.** No strategy logic, no backtest engine touched. The acceptance criterion "backtest CG-fade portfolio 365d метрики остаются ≈+94% / PF ≈1.55" should produce the bit-identical numbers — there is no code path where the rewrite changes a calculation. Treat the backtest acceptance as a sanity check, not a re-validation.

**Worst-case failure mode:**

- A typo in the `withRetry` shim could mis-pass `tries`/`delayMs` → policy with wrong attempts. Smoke pipeline catches this by exercising at least one retry path. **Mitigation:** dev runs `npx tsc --noEmit` plus `npm run cg:test` and `npx tsx src/tools/diagnostics/smoke-pipeline.ts` before pushing.
- A `Position.riskUnitsFromRaw` regression on the `entryPrice/sl/initialQty` order would silently produce wrong R numbers in `realized_r`. The named-args object literal makes this impossible at the type level; positional args was specifically rejected for this reason.

## Out of scope

- Untracked operator work: `src/strategies/cg-fade.ts` modifications, `src/backtest/cli/btc-*.ts`, `src/tools/diagnostics/btc-*.ts`, `grid-engine.ts`, `cg-coverage.ts`, `cg-schema-dump.ts`, `dw-scrub-task003.ts`, `grid-math.ts`. **Do not touch.**
- Wave 3 SRP/DIP refactors (#7-#11 audit findings): Reconciler/OrderExecutor/PositionWatcher classes, ExchangeGateway interface, ConfluenceRule[], CommandRegistry.
- Backtest engine.
- DB schema.
- Migration of all `withRetry` callsites to the direct generic. Shims stay; only `bybit.ts` and `coinglass.ts` internals change.
- The `scan-decide.ts:410-411 rrTp1/rrTp2` planning RR — different domain, different denominator, not part of Position.riskUnits.

## Acceptance criteria (refined)

Acceptance criterion #1 should read **"4 live + 1 diagnostic callsites"** (not 5) to reflect the scan-decide.ts mis-classification. Suggested text:

> "Position.riskUnits(pnl): number единый метод используется во ВСЕХ 4 live R-callsites (reconcile.ts, position-watcher.ts, tools/admin/close-trade.ts, tools/admin/backfill-realized-r.ts) и в диагностике trade-detail.ts — нет inline формул вне Position класса. scan-decide.ts:410-411 (rrTp1/rrTp2) — другой домен (планируемое RR, не realized-R), не трогаем."

Acceptance criterion #4 (cleanup) should read **"14 файлов удалены"** (not 17), with the 3 false positives (`tg-test`, `risk-status`, `coinglass-test`) listed explicitly as kept-with-rationale:

> "Cleanup tools/diagnostics: удалены 14 устаревших one-off скриптов (полный список в analysis). Из исходных 17 не удалены 3 (false positives): tg-test (mandated by CLAUDE.md § Forbidden shell patterns), risk-status (npm run risk — live ops), coinglass-test (npm run cg:test — CG key smoke)."

Other acceptance criteria (typecheck clean, smoke pass, no backtest regression) stand as-is.

## Implementation order

The dev should land changes in this order to keep each commit independently sane:

1. **#5 RetryPolicy first.** Create `src/core/retry-policy.ts`. Replace `withRetry` body in `bybit.ts` with shim. Replace `withCgRetry` body in `coinglass.ts` with shim. `npx tsc --noEmit` must pass. Smoke pipeline must still light up. (Smallest functional change, broadest safety net.)
2. **#4 QtyNormalizer.** Create `src/core/qty-normalizer.ts`. Migrate `execute.ts:150-155`, `tp-planner.ts:58-65`, `naked-tp-recovery.ts:74-81`. Typecheck.
3. **#3 Position.riskUnits.** Add the two methods to `position.ts`. Migrate `reconcile.ts:157-158`, `position-watcher.ts:370`, `close-trade.ts:58-60`, `backfill-realized-r.ts:46-51`, `trade-detail.ts:56-63`. Typecheck.
4. **#6 Diagnostics cleanup.** `git rm` the 14 files. Typecheck (should still pass — they were one-shots with no imports).
5. Final: typecheck clean + `npx tsx src/tools/diagnostics/smoke-pipeline.ts` green + backtest portfolio (`tsx src/backtest/cli/portfolio.ts 365 0.375 10`) returns within 0.5% of baseline (sanity, not validation).

Each step is a separate commit. If any step's typecheck fails, the earlier commits stay; only that step rewinds.

## Open questions

None blocking. Two flagged for orchestrator/operator:

- Should `coinglass-test` and its `cg:test` script be dropped too? (Audit said delete; CLAUDE.md doesn't mandate keeping.) — Recommend keeping; if operator confirms drop, that's a one-line addendum.
- Should `check-instrument.ts` be kept? It's an operator-grade live-debug tool with no incoming reference. The audit lists it for deletion; recommend deletion (the diagnostic value is duplicated by `npm run bybit:test` + reading the InstrumentInfo cache) but won't object if kept.

## Dev brief

Wave 2 is pure shape work — no behaviour change, no backtest revalidation. Land in this order, one commit per step:

1. **Create `src/core/retry-policy.ts`** with `RetryPolicy` interface, `BybitRetryPolicy`, `CoinglassRetryPolicy`, generic `withRetry<T>(fn, policy, opts?)`. Replace the bodies of `src/core/bybit.ts:23-51 withRetry` and `src/core/coinglass.ts:46-62 withCgRetry` with shims that preserve the existing call signatures. No consumers outside those two core files change. Run `npx tsc --noEmit` + `npm run cg:test` (one live HTTP call exercising one retry policy).

2. **Create `src/core/qty-normalizer.ts`** with pure `normalizeQty(rawQty, info): NormalizedQty` and `splitQtyHalves(total, info): SplitQty`. Rewrite three callsites (`execute.ts:150-155`, `tp-planner.ts:58-65`, `naked-tp-recovery.ts:74-81`) to call them. Preserve each callsite's existing policy on invalidity (execute throws, tp-planner falls through to SingleLimit, naked-tp-recovery logs+returns null). `npx tsc --noEmit`.

3. **Add `Position.riskUnits(pnl)` instance method + `Position.riskUnitsFromRaw({entryPrice, sl, initialQty, pnlUsd})` static helper** to `src/core/position.ts`. Both return 0 when stop distance × initial qty is zero. Rewrite five callsites:
   - `reconcile.ts:157-158` — collapse to one line using instance method on `Position.fromOpenTrade(t)`.
   - `position-watcher.ts:370` — switch from `Math.max(..., 1)` divisor to `Position.riskUnitsFromRaw({...})`. Note: this is a small behaviour change (0R instead of "≈pnlR" on degenerate input). Flag in PR description.
   - `close-trade.ts:58-60` — call static helper; keep the `pnl` calc inline.
   - `backfill-realized-r.ts:46-51` — call static helper; the existing `stopDist <= 0 || initialQty <= 0` guard becomes implicit, drop it after verifying the helper returns 0 in those cases.
   - `trade-detail.ts:56-63` — call static helper three times (full pnl R, tp1 partial R, tail R) instead of three inline `/riskUsd` expressions.
   
   `npx tsc --noEmit`.

4. **Cleanup:** `git rm` the 14 files listed in the deletion list above. **Do not** touch the 3 false positives (`tg-test.ts`, `risk-status.ts`, `coinglass-test.ts`). **Do not** touch any untracked operator file in `src/tools/diagnostics/` (`btc-*.ts`, `grid-engine.ts`, `cg-coverage.ts`, `cg-schema-dump.ts`, `dw-scrub-task003.ts`, `grid-math.ts`). `npx tsc --noEmit` (should pass since the deleted files had no imports).

5. **Verification before submit:**
   - `npx tsc --noEmit` clean.
   - `npx tsx src/tools/diagnostics/smoke-pipeline.ts` passes.
   - `npx tsx src/backtest/cli/portfolio.ts 365 0.375 10` produces the same year-return / PF / MaxDD as the post-TASK-003 baseline within rounding (no algorithmic change). If it drifts > 1% absolute return, stop — something semantic changed.
   - Stage all changes, commit with a single message referencing TASK-004.

The chief trap is touching the untracked WIP files in `src/strategies/cg-fade.ts` or `src/tools/diagnostics/btc-*.ts` — they belong to a parallel operator workflow and **must remain untouched**. Use `git status -s` before staging and confirm only the files in this brief are touched.
