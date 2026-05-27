---
task: TASK-006
author: architect
created: 2026-05-26T10:10:00Z
iteration: 0
---

## Summary

Replace the 5-minute `position-watcher` cron tick with a long-running `position-monitor` daemon, supervised by systemd, that holds **one Bybit V5 private WebSocket connection per `AccountKey`** (3 connections total) subscribed to `position`, `execution`, `order`. WS events drive the existing detectors (TP1 partial, naked-SL safety-net, naked-TP recovery, dust). A bounded 30-second REST poll runs in parallel as a fallback and a post-reconnect resync. Existing detectors are **extracted as pure functions** so both the daemon and the legacy cron path (during overlap) call the same code. Reconcile remains as the 5-minute catch-net. `scripts/cycle.sh` drops the `position-watcher` invocation once the daemon is verified.

Target reaction time:

- **WS path**: ≤ 1 s from Bybit `execution` push to DB UPDATE + Telegram send (well under operator's ≤ 10 s target).
- **REST fallback path**: ≤ 30 s (the configured poll period).
- **Naked-SL detection → emergency close**: same WS-driven path → ≤ 2 s, vs ≤ 5 min today.

## Bybit V5 WebSocket — facts (from `bybit-api@4.6.1` types + V5 docs)

- **Single private WS endpoint** per account; authenticated once on connect using the same `apiKey`/`apiSecret` pair as REST (the SDK signs internally — `node_modules/bybit-api/lib/websocket-client.d.ts:124-128 getWsAuthRequestEvent / getWsAuthSignature`). Multiple private channels share one connection.
- Topic names (V5 USDT-perp) — confirmed in `node_modules/bybit-api/lib/types/websockets/ws-general.d.ts:12-13`: `'position'`, `'execution'`, `'order'`, `'stop_order'`, `'wallet'`. There is **no `position.linear` / `execution.linear`** suffix in V5; the category (`'linear'`) is passed as a second argument to `subscribeV5(topics, category)` — see `websocket-client.d.ts:34`.
- Payload shapes — typed in `ws-events.d.ts`:
  - `WSPositionEventV5` → `topic:'position', data:WSPositionV5[]` with `symbol, side, size, entryPrice, stopLoss, takeProfit, unrealisedPnl, positionStatus, markPrice, updatedTime, seq` (lines 161-204).
  - `WSExecutionEventV5` → `topic:'execution', data:WSExecutionV5[]` with `symbol, side, execId, orderId, orderLinkId, execQty, execPrice, execType ('Trade'|'Funding'|'AdlTrade'|'BustTrade'|...), execTime, closedSize, execPnl, seq` (lines 257-292). **`execId` is the unique fill identifier — primary dedup key.**
  - `WSAccountOrderEventV5` → `topic:'order', data:WSAccountOrderV5[]` with `orderId, orderLinkId, symbol, orderStatus, side, qty, cumExecQty, reduceOnly, stopOrderType ('TakeProfit'|'StopLoss'|...), createdTime, updatedTime, closedPnl` (lines 205-256).
- **Auth + reconnect are managed by the SDK** (`BaseWebsocketClient` in `node_modules/bybit-api/lib/util/`). The SDK already does ping/pong, exponential backoff, and re-subscribes tracked topics on reconnect (per `subscribeV5` docstring at `websocket-client.d.ts:33-34`). Our wrapper does **not** need to re-implement reconnect logic — only listen for the SDK's `'open'`/`'close'`/`'reconnected'`/`'response'`/`'update'` events, and on `'reconnected'` trigger a one-shot REST resync.
- WS event ordering inside an account is reliable per channel (Bybit guarantees `seq` monotonic for `position`, `execution`, `order`). Across channels there is no ordering guarantee, e.g. `execution` may arrive before the corresponding `position` push — our dedup design handles this (see below).
- Rate limits: ≤ 500 active private subscriptions per connection (we use 3). No per-second message cap on push direction. **One connection per account** is well under any limit.

## Existing code — reuse / refactor / extract

**Reuse as-is (called from new daemon event handlers):**

- `closeAndVerify(account, symbol, { reason, cancelOrders })` — `src/core/close-verifier.ts:84-204`. Used by naked safety-net fallback and by dust handler.
- `nakedTpRecovery.check(pos, restClient)` — `src/runtime/naked-tp-recovery.ts:49-122`. Used by the position-event handler when a `position` push arrives and stopLoss exists but TP legs may be missing.
- `divergenceDetector.classify(pos, match)` — `src/runtime/divergence-detector.ts:39-55`. Used to decide if a Bybit-vs-DB size delta is `tp1_partial` / `dust` / `mismatch` on REST resync.
- `tradeRepo.openTrades()` — used to load the active DB rows once on daemon start and refresh on REST poll.
- `getRest(account)`, `getInstrumentInfo`, `withRetry`, `roundQtyToStep`, `roundPriceToTick` — `src/core/bybit.ts`.
- DB helpers: `query` from `src/core/db.ts`, `notifyClose`, `notifyAlert`, `notifyDcaFill` from `src/core/tg-templates.ts`.

**Refactor — extract pure functions from `src/runtime/position-watcher.ts`:**

| Existing site | New home in `src/runtime/position-events.ts` | Signature |
|---|---|---|
| `detectTp1Filled(pos)` (`position-watcher.ts:172-182`) — currently mixes Bybit size with DB initial_qty + Position state machine | `isTp1PartialFromPosition(prev, next, dbInitialQty, dbCurrentQty, tp1Already): boolean` | pure |
| TP1 PnL+qty inference at `position-watcher.ts:427-456` (closedPnL fetch with analytical fallback) | `inferTp1Fill(account, symbol, prevSize, newSize, dbTP1, dbEntry, dbSide, openedTs): Promise<{filledQty, realizedPnl, exitPrice}>` | side-effecting (calls REST `getClosedPnL`) but isolated |
| TP1 fill DB update + Telegram aggregation (`position-watcher.ts:457-491` + `509-528`) | `handleTp1Fill(pos, account, fill, groupAggregator)` + flushTp1Groups | DB+Telegram |
| Safety-net naked-SL block (`position-watcher.ts:278-337`) | `handleNakedSl(pos, account, dbInitialSL): Promise<RecoveryAction>` | side-effecting |
| DCA-fill detection (`position-watcher.ts:346-415`) | `handleDcaFill(pos, account): Promise<RecoveryAction>` | side-effecting |
| Drawdown alerts (`position-watcher.ts:530-591`) | move into `src/runtime/drawdown-alerts.ts` (own module — fires from periodic REST poll only, NOT on every WS event) | side-effecting |
| `closePosition` (`position-watcher.ts:153-168`) | already a thin wrapper over `closeAndVerify`; **keep**; called only from disabled regime-flip path |

**Retire:**

- `position-watcher.ts` as a cron entry stays in the repo until daemon is stable, then is removed from `scripts/cycle.sh`. The file becomes a thin shim importing from `position-events.ts` so existing tests/CLIs still work, **OR** we delete it once cron is migrated. Recommendation: keep `position-watcher.ts main()` for two weeks as a manual `npm run watcher:once` fallback diagnostic, then delete.

## Design

### `src/core/bybit-ws.ts` (new — ~250 LOC)

**Responsibility:** wrap `WebsocketClient` from `bybit-api` for one `AccountKey`. Translate SDK events into typed, fan-out-friendly emitter events.

```ts
import { EventEmitter } from 'node:events';
import { WebsocketClient } from 'bybit-api';
import type {
  WSPositionV5, WSExecutionV5, WSAccountOrderV5,
} from 'bybit-api/lib/types/websockets/ws-events';
import { AccountKey } from './accounts';

export interface PositionUpdate { account: AccountKey; data: WSPositionV5; receivedAt: number; }
export interface ExecutionUpdate { account: AccountKey; data: WSExecutionV5; receivedAt: number; }
export interface OrderUpdate { account: AccountKey; data: WSAccountOrderV5; receivedAt: number; }

export interface BybitWsEvents {
  position: (e: PositionUpdate) => void;
  execution: (e: ExecutionUpdate) => void;
  order: (e: OrderUpdate) => void;
  connected: () => void;
  reconnected: () => void;
  disconnected: (reason: string) => void;
  error: (err: Error) => void;
}

export declare interface BybitWs {
  on<K extends keyof BybitWsEvents>(event: K, listener: BybitWsEvents[K]): this;
  emit<K extends keyof BybitWsEvents>(event: K, ...args: Parameters<BybitWsEvents[K]>): boolean;
}

export class BybitWs extends EventEmitter {
  constructor(account: AccountKey);
  start(): Promise<void>;             // connect, subscribe position/execution/order, await first auth ack
  stop(): Promise<void>;              // unsubscribe all + close gracefully
  isConnected(): boolean;
  get account(): AccountKey;
  get lastEventTs(): number;          // for heartbeat staleness check
}
```

**Implementation notes:**

- Construct `WebsocketClient({ key, secret, market: 'v5', testnet, demoTrading, pingInterval: 20_000, pongTimeout: 7_500 })`. The SDK manages ping (`sendPingEvent`, `websocket-client.d.ts:127`) and reconnection. `demoTrading: true` routes to `stream-demo.bybit.com` per Bybit V5 (same URL switch as REST).
- After construction, attach listeners on the underlying client for `'open'`, `'close'`, `'reconnected'`, `'update'`, `'response'`, `'error'`. The `'update'` event payload is the topic push — switch on `evt.topic === 'position' | 'execution' | 'order'`.
- On `start()`: `await client.subscribeV5(['position', 'execution', 'order'], 'linear')`. The SDK auths automatically (`authPrivateConnectionsOnConnect`, `websocket-client.d.ts:131`). Wait until first `'response'` event with `op:'auth'` returns `success:true`.
- `lastEventTs` updates on **every** SDK message (including ping/pong) so heartbeat staleness reflects connection liveness, not trading activity.
- No reconnect logic of our own. We trust the SDK's exponential backoff. On `'reconnected'`, re-emit our `'reconnected'` event so `AccountMonitor` can trigger a REST resync.

**Why a class:** holds connection state, owns `WebsocketClient` lifecycle, encapsulates SDK-event-to-domain-event translation. Single responsibility: WS connection per account.

### `src/runtime/position-monitor.ts` (new — daemon entry, ~250 LOC)

**Responsibility:** lifecycle + orchestration. Owns one `AccountMonitor` per account, signal handling, heartbeat writer.

```ts
async function main(): Promise<void> {
  await runMigrations();   // idempotent, same as cycle.sh step 0
  const accounts = loadAccounts();
  const monitors = accounts.map((a) => new AccountMonitor(a));

  const shutdown = async (sig: string) => {
    log.info('position-monitor: shutdown', { sig });
    writeHeartbeat({ status: 'stopping' });
    await Promise.allSettled(monitors.map((m) => m.stop()));
    await closePg();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await Promise.all(monitors.map((m) => m.start()));

  setInterval(() => writeHeartbeat(snapshotHeartbeat(monitors)), 30_000).unref();

  // Daemon stays alive forever via SDK keep-alive + interval timers.
}
```

`AccountMonitor` (private class in same file or a sibling — recommend sibling `src/runtime/account-monitor.ts`):

```ts
class AccountMonitor {
  constructor(private readonly account: AccountKey) { /* this.ws = new BybitWs(account) */ }
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): {
    account: string;
    wsConnected: boolean;
    lastWsEventAt: number;
    lastRestPollAt: number;
    openSymbols: string[];
  };
  /* internal */
  private onPosition(e: PositionUpdate): Promise<void>;
  private onExecution(e: ExecutionUpdate): Promise<void>;
  private onOrder(e: OrderUpdate): Promise<void>;
  private onReconnected(): Promise<void>;
  private restPollLoop(): Promise<void>;     // setInterval-driven, configurable
  private restResync(reason: 'startup' | 'reconnect' | 'poll'): Promise<void>;
}
```

**Why a class:** owns state (`Map<string, PositionState>` keyed by symbol), holds intervals, single point for shutdown. SRP: orchestrate one account's WS+REST.

### `src/runtime/position-events.ts` (new — pure detectors + side-effect handlers)

Two layers:

**Pure detectors (no IO, fully unit-testable):**

```ts
export interface PositionState {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  stopLoss: number;
  takeProfit: number | null;
  markPrice: number;
  updatedTs: number;
  initialSize: number;          // from DB initial_qty
  dbCurrentQty: number;         // DB qty col (post-TP1 sync)
  dbInitialSL: number;
  dbTP1: number | null;
  dbTP2: number | null;
  dbTradeId: number;
  tp1AlreadyFilled: boolean;
  lastTp1FillTs: number;        // 0 if never; updated by handler after DB write
  lastFullCloseTs: number;
  lastExecIds: Set<string>;     // dedup ring (max 256 entries; evict oldest)
}

export function detectFullClose(next: WSPositionV5): boolean;          // size==0
export function detectNakedSl(next: WSPositionV5): boolean;            // size>0 && stopLoss=='0' or ''
export function detectDust(next: WSPositionV5, initialSize: number): boolean;
                                                                       // |size| > 0 && size < initialSize * 0.01
export function detectTp1Partial(
  prev: PositionState | null,
  next: WSPositionV5,
  state: PositionState,
): boolean;                                                            // size went from ~initial to 40-60% AND tp1 not yet flagged
export function detectDcaFill(state: PositionState, next: WSPositionV5): boolean;
                                                                       // newSize > initialSize * 1.01 && !tp1Already
export function isFundingExecution(ex: WSExecutionV5): boolean;        // execType==='Funding' → ignore for fill detection
```

**Side-effect handlers (call REST + DB + Telegram — wrap existing watcher logic):**

```ts
export async function handleNakedSl(
  account: AccountKey,
  pos: PositionState,
): Promise<RecoveryAction>;     // amend SL → on fail, closeAndVerify (TASK-005 helper)

export async function handleTp1Fill(
  account: AccountKey,
  pos: PositionState,
  filledQty: number,
  realizedPnl: number,
  exitPrice: number,
): Promise<RecoveryAction>;     // DB UPDATE qty + tp1_filled_at + tp1_realized_pnl_usd

export async function handleFullClose(
  account: AccountKey,
  pos: PositionState,
): Promise<RecoveryAction>;     // DB UPDATE status='closed' (via existing autoCloseTrade pathway) + Telegram

export async function handleDust(
  account: AccountKey,
  pos: PositionState,
): Promise<RecoveryAction>;     // closeAndVerify with reason='daemon-dust'

export async function handleDcaFill(
  account: AccountKey,
  pos: PositionState,
  next: WSPositionV5,
): Promise<RecoveryAction>;     // existing logic from position-watcher.ts:346-415
```

The full-close handler must reuse `reconcile.ts:autoCloseTrade` logic. Two options:

- **Option A (recommended)**: extract `autoCloseTrade` + `notifyConsolidatedCloses` from `reconcile.ts` into `src/runtime/trade-closer.ts`. Both reconcile and daemon import. Diff: ~80 LOC moved, 0 logic change.
- **Option B**: daemon shells out to `runReconcile()` after a full-close event. Rejected — runs the full divergence scan unnecessarily, hides daemon's path behind reconcile's, defeats the latency goal.

### `src/runtime/account-monitor.ts` — state + dedup rules

**Per-account state:**

```ts
interface AccountMonitorState {
  positions: Map<string, PositionState>;   // key = symbol (one-way mode, one position per symbol)
  pendingExecutions: Map<string, ExecutionUpdate[]>;
                                            // execution may arrive before position seq; buffer ≤ 2s
  recentExecIds: Set<string>;               // global dedup ring across REST+WS, size cap 1024 with LRU eviction
  lastWsEventAt: number;
  lastRestPollAt: number;
}
```

**Dedup rules (resolving the WS+REST race the task acceptance #9 calls out):**

1. **execId dedup** (preferred for `execution` events) — every `WSExecutionV5.execId` is recorded in `recentExecIds` on first sight. REST resync's `getClosedPnL` records carry the same `execId` field (Bybit V5 API). If already in set, skip.
2. **Position-state delta dedup** — every WS `position` push compares to the cached `PositionState` for that symbol. If `size === cached.size && stopLoss === cached.stopLoss && takeProfit === cached.takeProfit`, skip handler chain entirely (no observable change).
3. **TP1 fill dedup** — once `handleTp1Fill` succeeds, set `state.lastTp1FillTs = now`. Subsequent calls within 60 s on the same trade_id with the same delta direction are no-ops. The DB `trades.tp1_filled_at IS NOT NULL` is the source of truth; handler re-reads before writing.
4. **Full-close dedup** — once `handleFullClose` UPDATEs `status='closed'`, the row is removed from `positions` Map. A late REST poll that sees `size=0` finds no in-memory state and does nothing.
5. **Naked-SL throttle** — emergency close attempt limited to 1 per (account, symbol) per 90 s. After 3 consecutive failures, mark symbol as `naked_unrecoverable` and only send Telegram on subsequent events (no more close attempts) until a manual reset.

### WS+REST coordination

| Event source | Trigger | Action |
|---|---|---|
| WS `execution` (execType=`Trade`, reduceOnly=true, closedSize>0) | partial fill | Buffer + correlate with next `position` push (within 2 s window) → compute TP1 fill if pre-TP1 OR full close if size→0 |
| WS `position` (size unchanged but SL changed) | server-side SL/TP amend ack | Update state; no detector fires |
| WS `position` (size=0) | full close | `handleFullClose` immediately |
| WS `position` (stopLoss empty, size>0) | naked-SL | `handleNakedSl` immediately (race with `execute.ts` SL attach is handled by 3 s grace if `now - state.createdMs < 300_000` and we are within first WS push — see Risk #2 below) |
| WS `position` (size > prevSize * 1.01) | DCA fill | `handleDcaFill` (TP re-place + DB qty bump + TG) |
| REST poll (every `POSITION_MONITOR_POLL_SEC`, default 30) | fallback | For each Bybit position, look up state from Map: if state differs → run detectors as if a WS position event arrived. Also catches positions that WS missed (e.g. mid-reconnect). |
| WS `reconnected` | post-disconnect | Run REST resync immediately (resyncOnReconnect=true), regardless of poll interval |
| Daemon startup | initial state load | DB `tradeRepo.openTrades()` + REST `getPositionInfo(settleCoin=USDT)` per account → seed `positions` Map. Only after seed → subscribe WS. |

**WS-pushes-first invariant:** WS handler always updates `lastKnownState` Map **before** spawning side-effect work. The REST poll reads the same Map and skips work where state matches. This ensures REST never re-processes a fill that WS already handled.

### `infra/position-monitor.service` (new)

```ini
[Unit]
Description=AI Trading Bot — sub-10s position event daemon
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/root/Projects/ai-trading-bot
EnvironmentFile=/root/Projects/ai-trading-bot/.env
Environment=NODE_ENV=production
Environment=POSITION_MONITOR_POLL_SEC=30
ExecStart=/usr/bin/env npx tsx src/runtime/position-monitor.ts
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=position-monitor
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

Notes:

- `Requires=docker.service` ensures Postgres (running in docker per `npm run infra:up`) is up. If Postgres ever moves out of docker, drop this.
- `User=root` matches current cron ownership (`crontab -e` was set up by root). Switching to a dedicated `trader` user is a separate task — it requires `chown` of `/root/Projects/ai-trading-bot` and verifying `npx tsx` is on the user's PATH.
- `Restart=on-failure` + `StartLimitBurst=5` per `StartLimitIntervalSec=300` — after 5 crashes in 5 minutes systemd backs off; this prevents an infinite crash loop hammering Bybit.
- Daemon writes heartbeat to `/tmp/position-monitor-heartbeat.json`; the existing `src/tools/ops/heartbeat.ts` cron job reads it and posts a Telegram alert if `now - last_ws_event_ts > 90_000` for any account.

### Cron migration — `scripts/cycle.sh` diff

```diff
-# 2) position-watcher: TP1->BE move + (intentionally minimal) other rules.
-#    Always runs — partial-fill detection needs to be quick.
-if ! npx tsx src/runtime/position-watcher.ts > /tmp/cycle-watcher.out 2>&1; then
-  log "position-watcher failed (see /tmp/cycle-watcher.out)"
-fi
+# 2) position-watcher removed 2026-MM-DD — TP1/naked/dust/DCA detection now live
+#    in src/runtime/position-monitor.ts (sub-10s WS daemon, systemd-supervised).
+#    Reconcile (step 1) remains as a 5-min catch-net audit. Drawdown alerts
+#    moved to src/runtime/drawdown-alerts.ts and are fired by the daemon's
+#    30s REST poll (own throttle survives via /tmp/drawdown-alerts.json).
```

The migration is one block deletion; nothing else moves.

### `src/tools/ops/heartbeat.ts` extension

Add a `daemonStatus` block to the heartbeat payload, sourced from `/tmp/position-monitor-heartbeat.json`:

```ts
// pseudo
const daemonHb = readJsonIfFresh('/tmp/position-monitor-heartbeat.json', 90_000);
const daemonStatus = daemonHb == null
  ? { status: 'STALE', reason: 'no heartbeat file or > 90s old' }
  : daemonHb;

// add to stalenessReasons
if (daemonStatus.status === 'STALE') {
  stalenessReasons.push('position-monitor heartbeat отсутствует/устарел > 90s — daemon мёртв?');
}
if (daemonHb && daemonHb.accounts.some((a: any) => !a.wsConnected)) {
  stalenessReasons.push('position-monitor: WS отключён на одном из аккаунтов');
}
```

This piggy-backs on the existing hourly heartbeat — no new cron entry.

### `src/tools/diagnostics/monitor-health.ts` (new)

```ts
// CLI: npx tsx src/tools/diagnostics/monitor-health.ts
// Exits 0 if daemon healthy, non-zero otherwise. For systemd timer or operator checks.
async function main() {
  const hb = readJson('/tmp/position-monitor-heartbeat.json');
  const ageMs = Date.now() - hb.writtenAt;
  if (ageMs > 90_000) exit(1, 'heartbeat stale');
  for (const acc of hb.accounts) {
    if (!acc.wsConnected) exit(2, `account ${acc.label} WS disconnected`);
    if (Date.now() - acc.lastWsEventAt > 600_000) exit(3, `account ${acc.label} no WS event for 10 min`);
  }
  console.log('OK');
}
```

### npm scripts — `package.json` diff

```diff
   "trader:cycle": "scripts/cycle.sh",
   "trader:cron:install": "scripts/cron-install.sh",
+  "monitor:install": "sudo cp infra/position-monitor.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable position-monitor",
+  "monitor:start": "sudo systemctl start position-monitor",
+  "monitor:stop": "sudo systemctl stop position-monitor",
+  "monitor:restart": "sudo systemctl restart position-monitor",
+  "monitor:status": "systemctl status position-monitor",
+  "monitor:logs": "journalctl -u position-monitor -f",
+  "monitor:health": "tsx src/tools/diagnostics/monitor-health.ts",
+  "monitor:dev": "tsx src/runtime/position-monitor.ts",
```

`monitor:dev` is for foreground testing on dev machines without systemd.

## Migration plan — 12 steps

| # | Step | Owner | Verifiable signal |
|---|---|---|---|
| 1 | Implement `bybit-ws.ts` + unit-test against testnet credentials | dev | `monitor:dev` connects + receives a ping reply in ≤ 2 s |
| 2 | Implement `position-events.ts` (pure detectors + side-effect handlers) with extracted logic from `position-watcher.ts` | dev | `npx tsc --noEmit` clean; pure detectors covered by Vitest (if dev decides to add) |
| 3 | Implement `position-monitor.ts` + `account-monitor.ts` (daemon entry + per-account orchestration) | dev | `monitor:dev` runs > 5 min without crash on dev keys |
| 4 | Add `infra/position-monitor.service` + run `npm run monitor:install` on dev box | dev | `systemctl status position-monitor` shows `loaded; enabled` |
| 5 | Add `monitor-health.ts` + npm scripts + heartbeat integration | dev | `npm run monitor:health` exits 0 |
| 6 | Refactor `reconcile.ts:autoCloseTrade` + `notifyConsolidatedCloses` into `src/runtime/trade-closer.ts` (used by daemon AND reconcile) | dev | reconcile cron output unchanged (compare 2 consecutive runs pre/post) |
| 7 | Update `heartbeat.ts` to read daemon hb file and surface staleness in Telegram | dev | Stop daemon manually → next heartbeat Telegram mentions `STALE` |
| 8 | **Deploy daemon side-by-side with cron `position-watcher`** (do NOT delete the cron line yet) | operator | `systemctl start position-monitor`; cron still ticks |
| 9 | Overlap period: 24-48 h. Compare daemon DB writes vs cron writes on `trades.tp1_filled_at`, `status='closed'`, `tp1_realized_pnl_usd`. Daemon should win every race; cron should land 0 new writes after daemon is healthy. | operator | `journalctl -u position-monitor` shows TP1 + close events; `/tmp/cycle-watcher.out` shows `inspected: N, actions: []` |
| 10 | Edit `scripts/cycle.sh` to remove `position-watcher` invocation (per the diff above) | dev | next cron tick logs no `position-watcher` step |
| 11 | Update `CLAUDE.md` `## Architecture: cron-driven` section — note that position events now arrive sub-second via daemon; cron retains reconcile + scan-decide only | dev | doc shows new flow diagram |
| 12 | Delete `position-watcher.ts main()` after 2 weeks of stable daemon operation. Keep extracted helpers in `position-events.ts`. | operator | `git rm` after sign-off |

The overlap window (steps 8-10) is the de-risking mechanism. If the daemon misbehaves, the cron path is still active and absorbs missed events.

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| WS disconnects during a high-vol fill event — daemon misses TP1/SL push | medium | 30s REST poll fallback + on-reconnect REST resync (`account-monitor.ts:onReconnected`). Worst-case latency = 30s vs current 5min. |
| Race: WS `execution` event + REST poll see the same fill twice | high if no dedup | execId dedup (set + LRU eviction at 1024 entries) + per-symbol state Map state-compare. Handler is idempotent: DB UPDATE uses `WHERE tp1_filled_at IS NULL` so a second TP1 fill write is a no-op. |
| Daemon crashes mid-event — partial DB state (qty updated, tp1_filled_at unset) | low | Each handler wraps DB writes in a single `query` call (no implicit transactions, but each UPDATE is atomic). On crash + systemd restart, REST resync re-reads Bybit state and reconcile catch-net runs in 5 min. |
| `execute.ts` opens a new position; WS `position` push arrives BEFORE `execute.ts` finishes attaching SL → naked-SL detector falsely fires | medium | Add 60s grace: if `now - position.createdMs < 60_000`, skip `handleNakedSl` and re-evaluate on next event (`position-events.ts:detectNakedSl` adds an `ageMs` argument). |
| WS event for an account whose `accounts.json` was just removed | very low | `loadAccounts()` called once on startup; daemon restart picks up the new list. Operator must `monitor:restart` after editing `accounts.json` — document in README. |
| Memory leak in long-running daemon | medium | (a) `recentExecIds` is LRU-capped at 1024. (b) `pendingExecutions` is age-evicted at 5s. (c) `positions` Map mirrors Bybit — natural cap = number of pairs traded (≤ 7 Tier-1 + ≤ 4 Tier-2). (d) Add `systemctl restart position-monitor` weekly via systemd timer if observed RSS > 250 MB. |
| Bybit WS auth signature mismatch on demo (`demoTrading: true`) | low | SDK handles WS URL switch automatically when `demoTrading: true` is passed to `WebsocketClient` constructor. Verify on testnet first (step 1). |
| systemd unit permission issues: `npx`/`tsx` not on root PATH | medium | Service uses `/usr/bin/env npx tsx` — relies on `PATH` from `EnvironmentFile=.env`. Verify `which npx` on the box; if absent, use absolute path `/usr/bin/npx` or wrap with `bash -lc 'npx tsx ...'`. |
| Operator overlap mistake: deletes `position-watcher` cron line before daemon is verified | high if undisciplined | Migration plan step 9 mandates 24-48h overlap. Step 10 only after operator confirms daemon caught real events. Add a check in `cycle.sh` step 2 wrapper that's commented out, not deleted — easier to revert. |
| Daemon and cron both process the SAME TP1 fill during overlap (double Telegram) | high | TP1 handler reads `tp1_filled_at IS NULL` before UPDATE. Whichever path is faster wins; the slower one finds the flag set and bails before sending Telegram. Confirm `position-watcher.ts:459-463` already gates on `tp1_filled_at IS NULL` (currently it uses `tp1AlreadyFilled` flag fetched at start of cycle — there's a small race; acceptable during 24h overlap, but daemon's path should re-SELECT just before UPDATE). |
| WS `seq` regression (out-of-order push) makes state Map go backwards | low | Per Bybit V5, `seq` is monotonic within topic. Add a guard: `if (next.seq <= state.lastSeq) return;` |
| Cross-account broadcast: when `closeAndVerify` is called from daemon naked-SL handler, only this account is touched — the other accounts (same symbol) still hold positions | by design | Daemon handles per-account events. The previous cron behaviour was the same (`position-watcher` iterates all accounts). Cross-account broadcast remains in `execute.ts`/`auto-execute.ts` (entry side) only. |

## Live-trading impact

**Inviolables touched (from `CLAUDE.md`):**

1. **"Server-side SL within 5 minutes of every position open"** — strengthened. Daemon detects naked-SL via WS push within ~1 s of `execute.ts` finishing, and either re-attaches SL or force-closes. Previous 5-min window was the worst case; daemon makes it ~2 s.
2. **"Edit-never-cancel SL"** — preserved. Naked-SL handler calls `setTradingStop` (amend), only falling back to `closeAndVerify` when amend itself fails — identical to current `position-watcher.ts:284-335` behaviour.
3. **"Reconcile before every cycle"** — preserved. Reconcile is the catch-net for anything WS+REST misses (e.g. daemon was down for an hour due to crash loop).
4. **"No live entry until backtest gate passes"** — untouched. Daemon is exit-side only.

**Walk-forward backtest re-run NOT required.** Execution layer + safety net only. Strategy code (`src/strategies/cg-fade.ts`) and entry logic (`src/runtime/execute.ts`, `risk-guard.ts`, `auto-execute.ts`) are untouched.

**Worst-case failure mode:**

- Daemon process dies AND systemd fails to restart (e.g. host OOM). Within 5 min, reconcile cron detects divergence (positions closed on Bybit but DB still open) and runs `autoCloseTrade`. Same as today. Telegram alert via heartbeat (next top-of-hour) flags daemon staleness.
- Bybit WS infrastructure outage (account-wide). 30 s REST poll continues unaffected. Reaction degrades from ~1 s to ~30 s.
- Both WS AND REST unreachable: daemon error log + no DB updates. Reconcile cron picks up state when Bybit recovers. No data loss because Bybit-side state is authoritative.

## Test strategy

**Unit tests** (suggested, dev decides — no test infra commitment in this task):

- `position-events.ts` pure detectors — `detectTp1Partial`, `detectFullClose`, `detectNakedSl`, `detectDust`, `detectDcaFill`, `isFundingExecution`. Each takes plain objects; no IO.
- Dedup helpers — `LruExecIdSet`, state-comparator.

**Integration tests** (testnet):

- `npx tsx src/tools/diagnostics/ws-smoke.ts <account>` — connects, subscribes, prints first 5 events. Manual.
- Live testnet trade: open a small position via `execute.ts`, watch journalctl for `position` push within 2 s. Trigger TP1 via testnet matching engine. Measure `executionTime → DB UPDATE` delta from logs.

**Stress / failure-injection** (manual on dev):

- `sudo iptables -A OUTPUT -d stream.bybit.com -j DROP` for 30 s, then unblock. Daemon should log `disconnected`, then `reconnected`, then issue REST resync. Verify no missed positions.
- `kill -9 $(pidof tsx)` then check `systemctl status` shows auto-restart within 10 s.

**Smoke** (continuous):

- `npm run monitor:health` — exit 0 if daemon healthy. Optional cron entry `*/5 * * * * npm run monitor:health || alert`.

## Out of scope

- Replacing reconcile (`src/runtime/reconcile.ts` remains as the 5-min catch-net).
- Changing entry-side logic (`auto-execute.ts`, `execute.ts`, `risk-guard.ts`).
- Backtest engine or strategy code (`src/strategies/cg-fade.ts`, `src/backtest/**`).
- Building a webhook receiver (Bybit V5 does not push via HTTP webhooks).
- Building a UI / dashboard (journalctl + Telegram are sufficient).
- Switching daemon user from `root` to a dedicated `trader` user (separate hardening task).
- Adding `Vitest` or any test framework (the repo currently has none; tester decides on integration-only approach for now).
- Multi-account WS multiplexing in one connection (V5 does not support cross-account auth; one connection per account is required).

## Acceptance criteria (refined)

The task file's `acceptance:` list is correct as-is. Two refinements for clarity:

1. **Acceptance #2 ("Reaction time ≤ 1 секунда")** — measurement protocol: log `evt.execTime` (Bybit-stamped ms) inside the WS handler and log `now` after the DB UPDATE returns; verify `now - execTime` < 1000 in 95% of fills on testnet. Network jitter to Bybit edge nodes makes 100% strict guarantee impossible; 95p ≤ 1 s is the testable bar.
2. **Acceptance #4 ("Daemon перезапускается systemd unit на crash")** — verifiable by `kill -SIGKILL $(systemctl show position-monitor -p MainPID --value)` followed by `systemctl status` showing `active (running)` again within ≤ 15 s (matches `RestartSec=10` + startup ~3 s).
3. **Acceptance #5 ("WS reconnect logic")** — the SDK handles reconnect; our wrapper only re-emits the event. Acceptance test: `iptables -A OUTPUT -d stream.bybit.com -j DROP` for 5 s → daemon emits `disconnected` → `reconnected` → `restResync('reconnect')` logged.

## Dev brief — file-by-file order of work

A single dev can do this sequentially. **~700-900 LOC new, ~200 LOC moved.**

1. **`src/core/bybit-ws.ts`** (new, ~200 LOC) — wrap `WebsocketClient`. Export `BybitWs` class + typed event interface. Reference types from `bybit-api/lib/types/websockets/ws-events`. No business logic.
2. **`src/runtime/trade-closer.ts`** (new, ~150 LOC) — extract `autoCloseTrade` + `notifyConsolidatedCloses` + `fetchRecentClosedPnL` + `inferExitReason` + `cancelScaledInOrphans` from `reconcile.ts:38-263`. Both reconcile and daemon import from here. Reconcile is updated to import (zero behaviour change).
3. **`src/runtime/position-events.ts`** (new, ~300 LOC) — pure detectors (top half) + side-effect handlers (bottom half). Side-effect handlers reuse `closeAndVerify`, `nakedTpRecovery`, `getInstrumentInfo`, `moveStopLoss` (extract `moveStopLoss` from `position-watcher.ts:134-151` to here OR to `trade-closer.ts`).
4. **`src/runtime/drawdown-alerts.ts`** (new, ~80 LOC) — extract `sendDrawdownAlerts` from `position-watcher.ts:542-591`. Module-level singleton with its own throttle file (`/tmp/drawdown-alerts.json`, unchanged path).
5. **`src/runtime/account-monitor.ts`** (new, ~250 LOC) — `AccountMonitor` class: ws + REST poll + state Map + dedup + handler dispatch. Calls into `position-events.ts` handlers.
6. **`src/runtime/position-monitor.ts`** (new, ~120 LOC) — `main()`, signal handlers, heartbeat interval, `AccountMonitor` orchestration. Default export `null` (CLI entrypoint). Reads `POSITION_MONITOR_POLL_SEC` from env, default 30.
7. **`src/tools/diagnostics/monitor-health.ts`** (new, ~50 LOC) — reads `/tmp/position-monitor-heartbeat.json`, exits 0/1/2/3.
8. **`src/tools/ops/heartbeat.ts`** (modify) — read daemon hb file; surface `daemonStatus` + WS-disconnected reasons into `staleness.reasons`. Re-use existing `notifyHeartbeat` template; if template needs a new field, also touch `src/core/tg-templates.ts`.
9. **`infra/position-monitor.service`** (new) — systemd unit per the spec above.
10. **`package.json`** (modify) — add `monitor:*` scripts per the diff above. Do NOT alphabetise other scripts (keep diff minimal).
11. **`src/runtime/position-watcher.ts`** (modify — interim) — turn most of `runPositionWatcher` into delegating calls into `position-events.ts` to avoid double-maintenance during overlap. After overlap window (migration step 12), delete or reduce to a `--once` diagnostic CLI.
12. **`scripts/cycle.sh`** (modify — final step, NOT in this dev's submission) — operator runs the diff after migration step 9 confirms daemon healthy. Dev should leave this unchanged and document in the PR description.

**Before submitting:**

- `npx tsc --noEmit` clean. No new `any` (use `WSPositionV5`, `WSExecutionV5`, `WSAccountOrderV5` everywhere a payload appears). No `as` casts except narrowing SDK's broad `WsTopic` union.
- `grep -rn "from '../runtime/position-watcher'" src/` — should be empty after extraction.
- `npm run monitor:dev` on dev box: process stays alive ≥ 3 min, WS connects on all accounts, heartbeat file is fresh.
- `npm run monitor:health` exits 0.
- Code quality per `.claude/TEAM.md` §4: classes only where state exists (`BybitWs`, `AccountMonitor`). Pure detectors stay as functions. Comments WHY-only (especially: WHY 60s naked-SL grace, WHY 1024-entry execId LRU, WHY one WS per account).
- Live-sensitive: PR description must call out which inviolables are touched (Server-side SL ≤ 5 min) and confirm the overlap-window migration plan.

## Open questions

- **[NEEDS CLARIFICATION: user for systemd unit]** — current cron runs as `root`. Recommend keeping `User=root` for this task; switching to a dedicated `trader` user is a separate hardening task (file ownership audit, PATH validation, npm cache location). Confirm with operator that `root` is acceptable for systemd unit.
- **[NEEDS CLARIFICATION: testnet keys]** — task acceptance #2 says "verified через manual testnet trade ИЛИ через лог-timestamp delta". If no separate testnet `accounts.json` exists, the demo accounts (`demoTrading: true`) can be used — they have a separate WS URL and matching engine. Confirm whether to add a `accounts.testnet.json` template or run against the 50000/Ivan demo key on overlap.
- **[NEEDS CLARIFICATION: weekly daemon restart]** — operator preference: enable a `systemd --user` timer for weekly daemon restart (memory hygiene) or leave the daemon to run indefinitely? Default plan: leave indefinite, monitor RSS, add timer only if leak observed.
