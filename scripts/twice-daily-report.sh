#!/usr/bin/env bash
# Twice-daily Telegram report — 08:00 & 20:00 UTC (fires at :03 to land just after
# the top-of-hour cycle.sh refreshes scan-decide). Headless Claude gathers bot state
# + setups + news + open-position quality + an opinion, then sends ONE Telegram
# message. READ-ONLY + send only — the prompt forbids any trading/mutation.
#
# Install (system crontab, runs as root like the bot cycle):
#   3 8,20 * * * /root/Projects/ai-trading-bot/scripts/twice-daily-report.sh >> /tmp/twice-daily-report.log 2>&1
#
# Manual run: bash scripts/twice-daily-report.sh
set -uo pipefail
cd /root/Projects/ai-trading-bot

# Mirror cycle.sh's env, plus claude's dir and a sane HOME for cron's minimal env.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin:$PATH"
export HOME="${HOME:-/root}"
# Dedicated server runs the bot as root; mark the env as a sandbox so headless
# --dangerously-skip-permissions is permitted (it is otherwise blocked under root).
export IS_SANDBOX=1

MODEL="opus"   # max effort/quality for the digest (operator: maximal effort). "sonnet" = cheaper.
PROMPT_FILE="/root/Projects/ai-trading-bot/scripts/twice-daily-report.prompt.md"
RUN_OUT="/tmp/twice-daily-report-run.out"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

echo "[$(ts)] twice-daily-report start (model=$MODEL)"

# Deep multi-source research + 5-part analysis needs many tool calls and time.
timeout 2400 claude -p "$(< "$PROMPT_FILE")" \
  --model "$MODEL" \
  --dangerously-skip-permissions \
  --max-turns 220 \
  > "$RUN_OUT" 2>&1
RC=$?

# Surface the tail so the cron log shows whether the Telegram send succeeded.
echo "[$(ts)] twice-daily-report done (exit=$RC)"
tail -n 12 "$RUN_OUT" 2>/dev/null
if [ "$RC" -ne 0 ]; then
  echo "[$(ts)] NON-ZERO EXIT ($RC) — report may not have sent; full output in $RUN_OUT"
fi
