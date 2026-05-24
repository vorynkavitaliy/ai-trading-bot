#!/usr/bin/env bash
# Resume trader — reinstall cron + remove PAUSE.md.
#
# Pair to scripts/stop-trader.sh. After this:
#   - 5-minute cron cycle is reinstalled.
#   - PAUSE.md removed so auto-execute will take new entries again.
#
# Usage:
#   ./scripts/resume-trader.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAUSE_FILE="$PROJECT_DIR/vault/Watchlist/PAUSE.md"

echo "→ Reinstalling cron…"
"$PROJECT_DIR/scripts/cron-install.sh"

if [ -f "$PAUSE_FILE" ]; then
  echo "→ Removing PAUSE.md…"
  rm -f "$PAUSE_FILE"
  echo "✓ PAUSE.md removed."
else
  echo "✓ No PAUSE.md to remove."
fi

echo ""
echo "════════════════════════════════════════"
echo "▶ Trader resumed."
echo "   Next cycle will fire within 5 minutes."
echo "   Logs:  npm run trader:logs   (tail /tmp/cycle.log)"
echo "════════════════════════════════════════"
