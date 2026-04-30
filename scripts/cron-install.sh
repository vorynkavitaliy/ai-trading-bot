#!/usr/bin/env bash
# Install/refresh the trading-bot cron entry. Idempotent — safe to run repeatedly.

set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CYCLE="$PROJECT_DIR/scripts/cycle.sh"
MARKER="# trading-bot cycle (managed by npm run trader:cron:install)"
ENTRY="*/5 * * * * $CYCLE >> /tmp/cycle.log 2>&1   $MARKER"

chmod +x "$CYCLE"

# Read existing crontab (or empty if none); strip any prior managed entry; append fresh one.
EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -v -F "$MARKER" || true)"

{
  printf '%s\n' "$FILTERED"
  printf '%s\n' "$ENTRY"
} | crontab -

echo "✅ Cron installed: $ENTRY"
echo ""
echo "Verify: crontab -l"
echo "Logs:   tail -f /tmp/cycle.log"
