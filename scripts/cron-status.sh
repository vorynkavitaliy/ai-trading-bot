#!/usr/bin/env bash
# Show cron + cycle health status.

set -euo pipefail
echo "═══════════════ CRON STATUS ═══════════════"
if crontab -l 2>/dev/null | grep -q "trading-bot cycle"; then
  echo "✅ Cron entry installed:"
  crontab -l 2>/dev/null | grep "trading-bot cycle"
else
  echo "❌ Cron entry NOT installed (run: npm run trader:cron:install)"
fi

echo ""
echo "═══════════════ LAST 10 CYCLES ═══════════════"
if [ -f /tmp/cycle.log ]; then
  tail -10 /tmp/cycle.log
else
  echo "ℹ No /tmp/cycle.log yet — cron has not fired."
fi

echo ""
echo "═══════════════ FLAGS ═══════════════"
if [ -f /tmp/postmortem-trigger.flag ]; then
  echo "🚩 /tmp/postmortem-trigger.flag — fresh: $(cat /tmp/postmortem-trigger.flag)"
else
  echo "   /tmp/postmortem-trigger.flag — none"
fi

echo ""
echo "═══════════════ AUTO-EXECUTE (last cycle) ═══════════════"
if [ -f /tmp/auto-execute-latest.json ]; then
  jq '{cycle: .cycle.iso, actionable, take, downsize, skip, executed}' /tmp/auto-execute-latest.json 2>/dev/null || cat /tmp/auto-execute-latest.json
else
  echo "ℹ /tmp/auto-execute-latest.json — none yet"
fi
