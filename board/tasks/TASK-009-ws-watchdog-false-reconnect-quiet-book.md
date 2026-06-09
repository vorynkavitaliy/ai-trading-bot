---
id: TASK-009
title: "Fix WS watchdog false reconnect on quiet/empty book (bybit-ws 90s flap)"
epic: ""
sprint: ""
status: review
assignee: "claude"
reviewer: ""
severity_threshold: important
blocked_by: []
created: 2026-05-30
updated: 2026-06-02T11:48:00Z
iteration: 1
artifacts: []
live_sensitive: true
acceptance:
  - "No false 'forcing reconnect' on a healthy-but-quiet private WS stream (verified: 0 forcing-reconnects in 4 min after restart, was ~90s cadence)"
  - "Genuine half-open socket still detected (watchdog preserved — a dead socket receives no frames so _lastEventTs still goes stale)"
---

## Resolution (2026-06-02)

Root cause confirmed: `_lastEventTs` was only refreshed by business events (position/execution/order); the bybit-api lib consumes server pongs internally and does not emit them, so a quiet private stream (no trades >60s) looked dead → watchdog force-reconnected every ~90s. Raising the threshold would NOT fix it (timer still goes stale on a quiet stream).

Fix (`src/core/bybit-ws.ts`): `attachLivenessHook()` adds a raw `ws.on('message', …)` listener (via getWsStore, same surface as forceReconnect) on each underlying socket → ANY inbound frame (server ping, pong-to-our-ping ~every 20s, business data) refreshes `_lastEventTs`. Idempotent (WeakSet); attached on open/reconnected/every watchdog tick so post-reconnect sockets are always covered. Half-open protection preserved: a dead socket receives no frames → timer goes stale → watchdog fires.

Verified live: daemon restarted 2026-06-02 ~11:43 UTC; 4-min window → forcing-reconnect=0, stale-detections=0, reconnected=0, WS 3/3 connected. (Was 124 reconnects in ~7 min during the bad period.)

status:review for a second pair of eyes on the getWsStore() internals dependency (fragile if the lib changes shape — already used by forceReconnect, no-ops on shape change).

## Context

<!-- WHY this task exists. Link to the epic/incident/observation. -->

Observed live 2026-05-30 ~15:06–15:41 UTC on the position-monitor daemon: the
private WS flaps every ~90s on ALL 4 accounts, continuously, while the book is
empty. 92 reconnects in ~35 min. Log signature:

```
warn  bybit-ws stale — forcing reconnect  sinceLastEventMs: 88520
warn  bybit-ws reconnect attempt
info  bybit-ws reconnected
info  bybit-ws authenticated
(then ~88s silence → repeat)
```

Root cause (verified by reading `src/core/bybit-ws.ts`):
- Watchdog: `WATCHDOG_INTERVAL_MS=30_000`, `STALE_THRESHOLD_MS=60_000`. `watchdogTick`
  force-reconnects if `Date.now() - _lastEventTs > 60s`.
- `_lastEventTs` is refreshed ONLY on `open`, `reconnected`, `authenticated`,
  `response`, `update` (business data). On an empty book NO `update` arrives, and
  the Bybit pong empirically does NOT refresh the timer (it reaches 88s) → the
  watchdog treats a legitimately-quiet private stream as a dead socket.
- The library's own pong-timeout (7.5s) never fires (our 60s watchdog trips
  first), which implies the socket IS alive at the lib level (pongs received) —
  i.e. this is a FALSE positive, not a real half-open.

Regression introduced by commit ed9cfc9 ("fix(bybit-ws): watchdog reconnect on
TCP half-open silent sockets", 2026-05-29). That commit correctly defends against
a genuine TCP half-open where `isConnected()` stays true for >100min; the bug is
it cannot distinguish that from a healthy-but-quiet stream.

Impact: currently HARMLESS (book empty; 30s REST poll fallback is healthy —
`lastRestPollAt` fresh, `openSymbols` correct; server-side SL lives on Bybit).
But: (1) it spams false "WS отключён" hourly heartbeat alerts (the 15:15 report
that prompted this), (2) log spam + wasted reconnects, (3) when a position is open
but quiet >60s the WS will still flap, degrading sub-second TP1/SL detection to
the 30s REST path during each reconnect window (on-reconnect REST resync mitigates
but does not eliminate the gap).

The fix must NOT weaken the genuine half-open detection ed9cfc9 added.

## Inputs

<!-- Files to read, data to fetch, prior tasks to study. -->

- `src/core/bybit-ws.ts` — watchdog (`watchdogTick`, `STALE_THRESHOLD_MS`,
  `_lastEventTs`), `wireListeners` (lines ~211–274), constructor ping config
  (`pingInterval: 20_000`, `pongTimeout: 7_500`).
- Commit ed9cfc9 (the watchdog that introduced this) — read its rationale.
- bybit-api lib: `node_modules/bybit-api/lib/websocket-client.js` —
  `resolveEmittableEvents` (~line 460): server pong (`op:'pong'` / `ret_msg:'pong'`)
  detection (~443–455) and whether it is emitted to consumers (EVENTS_RESPONSES
  lists 'ping'/'pong' but pong may be intercepted internally and never emitted —
  CONFIRM during analysis, this is the crux).
- `src/runtime/account-monitor.ts` — REST poll fallback + on-reconnect resync
  (the existing safety net).
- `src/reporting/heartbeat.ts` — consumes `wsConnected`; emits the false alert.

## Approach

<!-- High-level plan filled by architect/tech-lead. -->

## Out of scope

<!-- Explicit list of things NOT to do in this task. Prevents scope creep. -->

## Notes

<!-- Agent-to-agent discussion thread. Each entry prefixed with agent name + ISO timestamp. -->

- claude 2026-05-30T15:51:16Z — Filed from a live diagnosis session. Candidate fix
  directions (for architect to evaluate, NOT prescriptive): (a) wire the lib's
  pong/heartbeat into `_lastEventTs`; (b) on a stale tick, actively probe liveness
  (cheap REST or a tracked outbound-ping ack) before force-reconnecting, and only
  reconnect after N consecutive failed probes; (c) raise threshold is NOT viable
  alone — a quiet private stream can be silent for hours. Whatever is chosen must
  preserve ed9cfc9's real half-open detection.
