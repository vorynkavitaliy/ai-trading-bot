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

set -euo pipefail
cd /root/Projects/ai-trading-bot

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

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
if ! npx tsx src/tools/db/db-migrate.ts > /tmp/cycle-migrate.out 2>&1; then
  log "db-migrate failed (see /tmp/cycle-migrate.out)"
fi

# 1) reconcile: auto-close db_without_bybit divergences + Telegram exits.
#    Always runs — exits can happen any minute, we want fast notification.
if ! npx tsx src/runtime/reconcile.ts > /tmp/cycle-reconcile.out 2>&1; then
  log "reconcile failed (see /tmp/cycle-reconcile.out)"
fi

# 2) position-watcher: TP1->BE move + (intentionally minimal) other rules.
#    Always runs — partial-fill detection needs to be quick.
if ! npx tsx src/runtime/position-watcher.ts > /tmp/cycle-watcher.out 2>&1; then
  log "position-watcher failed (see /tmp/cycle-watcher.out)"
fi

# 3) heartbeat: self-throttles to 1/hour. Always called.
if ! npx tsx src/tools/ops/heartbeat.ts > /tmp/cycle-hb.out 2>&1; then
  log "heartbeat failed (see /tmp/cycle-hb.out)"
fi

# 4) HEAVY: scan-decide ONLY on top-of-hour (HH:00-04).
#    This makes live use the SAME decision points as backtest engine: one per hour.
#    auto-execute runs immediately after — TAKE classifier triggers live entries
#    without going through Claude /loop. Removes 5-30 min latency that caused
#    setups to slip past their entry windows.
if [ "$TOP_OF_HOUR" = "1" ]; then
  log "top-of-hour -> running scan-decide"
  if ! npx tsx src/runtime/scan-decide.ts > /tmp/cycle-scan.out 2>&1; then
    log "scan-decide failed (see /tmp/cycle-scan.out)"
  fi
  ENTER_COUNT=$(jq -r '.enterCount // 0' /tmp/scan-decide-latest.json 2>/dev/null || echo 0)
  if [ "$ENTER_COUNT" -gt 0 ] 2>/dev/null; then
    log "actionable=${ENTER_COUNT} -> running auto-execute"
    if ! npx tsx src/runtime/auto-execute.ts > /tmp/cycle-auto-exec.out 2>&1; then
      log "auto-execute failed (see /tmp/cycle-auto-exec.out)"
    fi
    EXECUTED=$(jq -r '.executed // 0' /tmp/auto-execute-latest.json 2>/dev/null || echo 0)
    FAILED=$(jq -r '.failed // 0' /tmp/auto-execute-latest.json 2>/dev/null || echo 0)
    log "auto-execute done: executed=${EXECUTED} failed=${FAILED}"
  else
    log "actionable=0 (no setups this hour)"
  fi

  # Coinglass refresh at top of hour (granularity is 4h, hourly is plenty).
  if ! npx tsx src/data/cli/cg-incremental.ts > /tmp/cycle-cg.out 2>&1; then
    log "cg-incremental failed (see /tmp/cycle-cg.out)"
  fi
else
  log "mid-hour cycle (skipping scan-decide; backtest-aligned timing)"
fi

log "cycle done"
