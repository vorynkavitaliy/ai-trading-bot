#!/usr/bin/env bash
# Telegram digest — 5×/day, operator's Kyiv-day window (2026-06-11):
#   FULL  at 05:03 & 20:03 UTC (08:03 & 23:03 Киев, лето/EEST) — deep research,
#         opinion, forecast + scorecard.
#   PULSE at 09:03, 13:03, 17:03 UTC (12/16/20 Киев) — компактный апдейт: логи,
#         охота, исправность, короткий рыночный пульс. Без полного ресёрча.
# NOTE: cron is UTC; when Kyiv reverts to winter time (UTC+2, конец октября) the
# window shifts an hour late — re-pin the hours then.
#
# Install (system crontab, runs as root like the bot cycle):
#   3 5,9,13,17,20 * * * /root/Projects/ai-trading-bot/scripts/digest-report.sh >> /tmp/digest-report.log 2>&1
#
# Manual run: bash scripts/digest-report.sh [full|pulse]
set -uo pipefail
cd /root/Projects/ai-trading-bot

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin:$PATH"
export HOME="${HOME:-/root}"
# Dedicated server runs the bot as root; mark the env as a sandbox so headless
# --dangerously-skip-permissions is permitted (it is otherwise blocked under root).
export IS_SANDBOX=1

MODEL="claude-fable-5"   # operator 2026-06-11: newest model. Fallbacks: "opus", "sonnet".

HOUR_UTC=$(date -u +%H)
MODE="${1:-}"
if [ -z "$MODE" ]; then
  case "$HOUR_UTC" in
    05|20) MODE="full" ;;
    *)     MODE="pulse" ;;
  esac
fi

if [ "$MODE" = "full" ]; then
  PROMPT_FILE="/root/Projects/ai-trading-bot/scripts/digest-full.prompt.md"
  TIMEOUT=2400
  MAX_TURNS=220
else
  PROMPT_FILE="/root/Projects/ai-trading-bot/scripts/digest-pulse.prompt.md"
  TIMEOUT=900
  MAX_TURNS=80
fi
RUN_OUT="/tmp/digest-report-run.out"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

echo "[$(ts)] digest-report start (mode=$MODE model=$MODEL)"

timeout "$TIMEOUT" claude -p "$(< "$PROMPT_FILE")" \
  --model "$MODEL" \
  --dangerously-skip-permissions \
  --max-turns "$MAX_TURNS" \
  > "$RUN_OUT" 2>&1
RC=$?

echo "[$(ts)] digest-report done (mode=$MODE exit=$RC)"
tail -n 12 "$RUN_OUT" 2>/dev/null
if [ "$RC" -ne 0 ]; then
  echo "[$(ts)] NON-ZERO EXIT ($RC) — report may not have sent; full output in $RUN_OUT"
fi
