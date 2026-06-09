#!/usr/bin/env bash
# Cron-driven hot path. Run every 5 min; ALL light tasks always; HEAVY decision
# task only on the first 5-min window of each UTC hour (HH:00-04).
#
# Why: backtest engine decides at 1H bar close (one decision per hour per pair).
# To keep live and backtest using the SAME effective algorithm, scan-decide must
# also fire only at hour-close. Reconcile/watcher/heartbeat run every 5min anyway
# since they're catching events (position closed, SL hit, etc.) which can happen
# any minute.
#
# Install via crontab -e:
#   */5 * * * * /root/Projects/ai-trading-bot/scripts/cycle.sh >> /tmp/cycle.log 2>&1

# NOTE: we intentionally DON'T use `set -e` — we want to catch each subprocess's
# exit code and log it specifically. With `set -e` a non-zero from npx tsx would
# abort the whole cycle, skipping reconcile→watcher→heartbeat chain.
set -uo pipefail
cd /root/Projects/ai-trading-bot

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

# Persist a subprocess .out snapshot to a dated history log (append mode).
# Called only on non-zero exits so successful runs don't bloat history files.
# Args: history-file out-file exit-code label
persist_out() {
  local histfile=$1 outfile=$2 rc=$3 label=$4
  {
    printf '\n=== %s | %s | exit=%d ===\n' "$(ts)" "$label" "$rc"
    cat "$outfile" 2>/dev/null
  } >> "$histfile"
}

log "cycle start"

MINUTE=$(date -u +%-M)
TOP_OF_HOUR=0
if [ "$MINUTE" -lt 5 ] 2>/dev/null; then
  TOP_OF_HOUR=1
fi

# 0) Apply pending DB migrations (idempotent — runMigrations checks `migrations` table
#    and skips already-applied files; cheap ~10-50ms when nothing to apply). Catches
#    the case where a new migrations/NNN_*.sql lands on disk without anyone remembering
#    to run `npm run db:migrate`. We do NOT bail the cycle on failure here — the rest
#    of the pipeline depends on PG anyway and will surface its own errors loudly.
npx tsx src/tools/db/db-migrate.ts > /tmp/cycle-migrate.out 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  log "db-migrate failed (exit=$RC) — see /tmp/cycle-migrate.out"
  persist_out /tmp/cycle-history-errors.log /tmp/cycle-migrate.out "$RC" "db-migrate"
fi

# 1) reconcile: auto-close db_without_bybit divergences + Telegram exits.
#    Always runs — exits can happen any minute, we want fast notification.
#    Exit codes: 0 = aligned; 4 = divergence detected (normal during trade open/close
#    races — gets auto-resolved next cycle, NOT a bug); 1+ = unexpected crash.
npx tsx src/runtime/reconcile.ts > /tmp/cycle-reconcile.out 2>&1
RC=$?
if [ "$RC" -eq 4 ]; then
  log "reconcile detected divergence (exit=4) — see /tmp/cycle-reconcile.out"
  persist_out /tmp/cycle-history-divergences.log /tmp/cycle-reconcile.out "$RC" "reconcile"
elif [ "$RC" -ne 0 ]; then
  log "reconcile crashed (exit=$RC) — see /tmp/cycle-reconcile.out"
  persist_out /tmp/cycle-history-errors.log /tmp/cycle-reconcile.out "$RC" "reconcile"
fi

# 2) position-watcher: TP1->BE move + (intentionally minimal) other rules.
#    Always runs — partial-fill detection needs to be quick.
npx tsx src/runtime/position-watcher.ts > /tmp/cycle-watcher.out 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  log "position-watcher failed (exit=$RC) — see /tmp/cycle-watcher.out"
  persist_out /tmp/cycle-history-errors.log /tmp/cycle-watcher.out "$RC" "position-watcher"
fi

# 3) heartbeat: self-throttles to 1/hour. Always called.
npx tsx src/tools/ops/heartbeat.ts > /tmp/cycle-hb.out 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  log "heartbeat failed (exit=$RC) — see /tmp/cycle-hb.out"
  persist_out /tmp/cycle-history-errors.log /tmp/cycle-hb.out "$RC" "heartbeat"
fi

# Note: structure-watch.ts exists but is NOT in cron. Operator preference:
# Claude (in autonomous /loop) monitors positions with contextual judgment
# and sends Telegram alerts when he sees structural concerns. Automated
# threshold-based alerts proved less useful than Claude's contextual analysis.

# 4) HEAVY: scan-decide ONLY on top-of-hour (HH:00-04).
#    This makes live use the SAME decision points as backtest engine: one per hour.
#    auto-execute runs immediately after — TAKE classifier triggers live entries
#    without going through Claude /loop. Removes 5-30 min latency that caused
#    setups to slip past their entry windows.
if [ "$TOP_OF_HOUR" = "1" ]; then
  # Coinglass refresh FIRST — the just-closed 4H CG bar MUST be ingested BEFORE
  # scan-decide reads it, else scan-decide acts on the STALE prior bar and the new
  # signal isn't seen until next hour (+1h entry lag). Measured 2026-06-09: CG API
  # publishes the closed bar ~30s after close, our DB ~1.5min; reconcile/watcher/
  # heartbeat above provide the buffer. Was AFTER scan-decide → that caused the lag.
  npx tsx src/data/cli/cg-incremental.ts > /tmp/cycle-cg.out 2>&1
  RC=$?
  if [ "$RC" -ne 0 ]; then
    log "cg-incremental failed (exit=$RC) — see /tmp/cycle-cg.out"
    persist_out /tmp/cycle-history-errors.log /tmp/cycle-cg.out "$RC" "cg-incremental"
  fi

  log "top-of-hour -> running scan-decide"
  npx tsx src/runtime/scan-decide.ts > /tmp/cycle-scan.out 2>&1
  RC=$?
  if [ "$RC" -ne 0 ]; then
    log "scan-decide failed (exit=$RC) — see /tmp/cycle-scan.out"
    persist_out /tmp/cycle-history-errors.log /tmp/cycle-scan.out "$RC" "scan-decide"
  fi
  ENTER_COUNT=$(jq -r '.enterCount // 0' /tmp/scan-decide-latest.json 2>/dev/null || echo 0)
  if [ "$ENTER_COUNT" -gt 0 ] 2>/dev/null; then
    log "actionable=${ENTER_COUNT} -> running auto-execute"
    npx tsx src/runtime/auto-execute.ts > /tmp/cycle-auto-exec.out 2>&1
    RC=$?
    if [ "$RC" -ne 0 ]; then
      log "auto-execute failed (exit=$RC) — see /tmp/cycle-auto-exec.out"
      persist_out /tmp/cycle-history-errors.log /tmp/cycle-auto-exec.out "$RC" "auto-execute"
    fi
    EXECUTED=$(jq -r '.executed // 0' /tmp/auto-execute-latest.json 2>/dev/null || echo 0)
    FAILED=$(jq -r '.failed // 0' /tmp/auto-execute-latest.json 2>/dev/null || echo 0)
    log "auto-execute done: executed=${EXECUTED} failed=${FAILED}"
    # If any auto-execute attempt FAILED (executed-but-error), preserve the full
    # JSON for post-mortem — its .out gets overwritten next top-of-hour.
    if [ "$FAILED" -gt 0 ] 2>/dev/null; then
      persist_out /tmp/cycle-history-divergences.log /tmp/auto-execute-latest.json 0 "auto-execute-with-failures"
    fi
  else
    log "actionable=0 (no setups this hour)"
  fi

else
  log "mid-hour cycle (skipping scan-decide; backtest-aligned timing)"
fi

log "cycle done"
