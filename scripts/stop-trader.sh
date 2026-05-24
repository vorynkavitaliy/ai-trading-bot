#!/usr/bin/env bash
# Full halt — uninstall cron + ensure PAUSE.md exists.
#
# After this script:
#   - No more 5-minute cycles (no heartbeat / reconcile / scan-decide / auto-execute).
#   - No more Telegram notifications from the cron pipeline.
#   - tg-bot listener (Telegram command interface) is left running so /resume
#     and /status still work over Telegram.
#
# SAFETY: warns and refuses if there are open positions in the DB — those need
# server-side SL on Bybit to remain protected, but reconcile/position-watcher
# will no longer be running to detect divergence or move stops. Pass --force to
# override (only when you know Bybit has the stops and you'll watch manually).
#
# Usage:
#   ./scripts/stop-trader.sh              # halt (refuse if open positions)
#   ./scripts/stop-trader.sh --force      # halt even with open positions
#   ./scripts/stop-trader.sh --reason "migration to L/S fade"

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAUSE_FILE="$PROJECT_DIR/vault/Watchlist/PAUSE.md"

FORCE=0
REASON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --reason) REASON="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# 1) Check open positions in DB. Use psql via docker; if it's not reachable,
#    err on the side of caution and refuse without --force.
echo "→ Checking for open positions…"
OPEN_COUNT="$(docker exec trading-postgres psql -U trader -d trading -tAc \
  "SELECT COUNT(*) FROM trades WHERE status IN ('open','pending');" 2>/dev/null || echo "ERR")"

if [ "$OPEN_COUNT" = "ERR" ]; then
  if [ "$FORCE" -eq 0 ]; then
    echo "❌ Could not query DB for open positions. Pass --force if you're sure." >&2
    exit 1
  fi
  echo "⚠ DB unreachable — proceeding due to --force."
elif [ "$OPEN_COUNT" -gt 0 ]; then
  if [ "$FORCE" -eq 0 ]; then
    echo "❌ $OPEN_COUNT open/pending position(s) in DB. Refusing." >&2
    echo "   Either wait for them to resolve, or pass --force (Bybit server-side SL must be in place)." >&2
    docker exec trading-postgres psql -U trader -d trading \
      -c "SELECT symbol, side, status, opened_at::text FROM trades WHERE status IN ('open','pending');" >&2
    exit 1
  fi
  echo "⚠ $OPEN_COUNT open position(s) — proceeding due to --force."
else
  echo "✓ 0 open positions."
fi

# 2) Uninstall cron.
echo "→ Removing cron entry…"
"$PROJECT_DIR/scripts/cron-uninstall.sh"

# 3) Ensure PAUSE.md exists (defence in depth — if cron is reinstalled by
#    accident, auto-execute will still refuse to open new positions).
if [ -f "$PAUSE_FILE" ]; then
  echo "✓ PAUSE.md already present at $PAUSE_FILE"
else
  echo "→ Creating PAUSE.md…"
  mkdir -p "$(dirname "$PAUSE_FILE")"
  STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    echo "# Trading HALTED — $STAMP"
    echo ""
    if [ -n "$REASON" ]; then
      echo "**Reason:** $REASON"
    else
      echo "**Reason:** Operator halt via scripts/stop-trader.sh"
    fi
    echo ""
    echo "Cron uninstalled. auto-execute halt enforced by this file (defence in depth)."
    echo "Resume with: scripts/resume-trader.sh"
  } > "$PAUSE_FILE"
fi

# 4) Final state.
echo ""
echo "════════════════════════════════════════"
echo "✅ Trader halted."
echo "   - cron: removed"
echo "   - PAUSE.md: $PAUSE_FILE"
echo "   - tg-bot listener: left running (kill via 'tmux kill-session -t claude-trader' if needed)"
echo ""
echo "Verify:   crontab -l | grep trading"
echo "Resume:   scripts/resume-trader.sh"
echo "════════════════════════════════════════"
