#!/usr/bin/env bash
# Remove the trading-bot cron entry.

set -euo pipefail
MARKER="# trading-bot cycle (managed by npm run trader:cron:install)"

EXISTING="$(crontab -l 2>/dev/null || true)"
if [ -z "$EXISTING" ]; then
  echo "ℹ No crontab installed — nothing to remove."
  exit 0
fi

FILTERED="$(printf '%s\n' "$EXISTING" | grep -v -F "$MARKER" || true)"
printf '%s\n' "$FILTERED" | crontab -
echo "✅ Cron entry removed."
