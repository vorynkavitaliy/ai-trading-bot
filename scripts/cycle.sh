#!/usr/bin/env bash
# Cron-driven hot path. Runs scan-decide + reconcile + heartbeat without invoking Claude.
# Sets /tmp/trade-trigger.flag iff actionable signals are present, so the tmux Claude
# session knows to do a deep review on its next poll.
#
# Install via crontab -e:
#   */5 * * * * /root/Projects/ai-trading-bot/scripts/cycle.sh >> /tmp/cycle.log 2>&1

set -euo pipefail
cd /root/Projects/ai-trading-bot

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

log "cycle start"

# 1) scan-decide: refresh DB + live tickers + enrichment + risk-check.
#    Writes /tmp/scan-decide-latest.json as side effect.
if ! npx tsx src/scan-decide.ts > /tmp/cycle-scan.out 2>&1; then
  log "scan-decide failed (see /tmp/cycle-scan.out)"
fi

# 2) reconcile: auto-close db_without_bybit divergences + Telegram exits.
if ! npx tsx src/reconcile.ts > /tmp/cycle-reconcile.out 2>&1; then
  log "reconcile failed (see /tmp/cycle-reconcile.out)"
fi

# 3) heartbeat: self-throttles to 1/hour (no-op if already sent this UTC hour).
if ! npx tsx src/scripts/heartbeat.ts > /tmp/cycle-hb.out 2>&1; then
  log "heartbeat failed (see /tmp/cycle-hb.out)"
fi

# 4) Set trigger flag iff actionable + risk-allowed signals are present.
ENTER_COUNT=$(jq -r '.enterCount // 0' /tmp/scan-decide-latest.json 2>/dev/null || echo 0)
if [ "$ENTER_COUNT" -gt 0 ] 2>/dev/null; then
  ts > /tmp/trade-trigger.flag
  log "actionable=${ENTER_COUNT} → flag set"
else
  log "actionable=0 (Claude stays asleep)"
fi

# 5) Postmortem trigger: any trade closed in last 75 min lacking Postmortem file?
RECENTLY_CLOSED=$(npx tsx src/scripts/recently-closed-no-postmortem.ts 2>/dev/null || echo 0)
if [ "$RECENTLY_CLOSED" -gt 0 ] 2>/dev/null; then
  ts > /tmp/postmortem-trigger.flag
  log "postmortems pending=${RECENTLY_CLOSED} → flag set"
fi

log "cycle done"
