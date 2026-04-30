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
for flag in /tmp/trade-trigger.flag /tmp/postmortem-trigger.flag; do
  if [ -f "$flag" ]; then
    echo "🚩 $flag — fresh: $(cat "$flag")"
  else
    echo "   $flag — none"
  fi
done

echo ""
echo "═══════════════ TMUX SESSION ═══════════════"
if tmux has-session -t claude-trader 2>/dev/null; then
  echo "✅ tmux session 'claude-trader' running"
  tmux list-windows -t claude-trader -F '   • #W (#{window_panes} panes)'
  echo ""
  echo "   attach: npm run trader:attach"
else
  echo "❌ tmux session 'claude-trader' NOT running (run: npm run trader:start)"
fi
