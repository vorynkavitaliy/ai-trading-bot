#!/usr/bin/env bash
# Telegram digest — 5 themed slots/day, the operator's Kyiv-day arc (2026-06-11):
#   05:03 UTC (08:03 Киев)  morning — «Доброе утро»: азиатская сессия, ночь бота,
#                            календарь дня, прогноз + счёт прогнозов
#   09:03 UTC (12:03 Киев)  bot     — «Бот-час»: техотчёт, аудит, рентген пар,
#                            лимитки, темп vs движок (без новостного ресёрча)
#   13:03 UTC (16:03 Киев)  macro   — «Макро-чекпойнт»: вышедшие данные США,
#                            Европа, DXY/доходности, реакция крипты
#   17:03 UTC (20:03 Киев)  us      — «Американская сессия»: Wall Street, ETF-потоки,
#                            вечерние сетапы бота
#   20:03 UTC (23:03 Киев)  night   — «Итог дня»: разбор дня, анализ каждой открытой
#                            позиции на ночь, новый прогноз, доброй ночи
# NOTE: cron is UTC; when Kyiv reverts to winter time (UTC+2, конец октября) the
# window shifts an hour late — re-pin the hours then.
#
# Install (system crontab, runs as root like the bot cycle):
#   3 5,9,13,17,20 * * * /root/Projects/ai-trading-bot/scripts/digest-report.sh >> /tmp/digest-report.log 2>&1
#
# Manual run: bash scripts/digest-report.sh [morning|bot|macro|us|night]
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
    05) MODE="morning" ;;
    09) MODE="bot" ;;
    13) MODE="macro" ;;
    17) MODE="us" ;;
    20) MODE="night" ;;
    *)  MODE="bot" ;;   # off-schedule manual run: safest read-only slot
  esac
fi

case "$MODE" in
  morning) PROMPT_FILE="scripts/digest-morning.prompt.md"; TIMEOUT=1800; MAX_TURNS=160 ;;
  bot)     PROMPT_FILE="scripts/digest-bot.prompt.md";     TIMEOUT=1200; MAX_TURNS=100 ;;
  macro)   PROMPT_FILE="scripts/digest-macro.prompt.md";   TIMEOUT=1500; MAX_TURNS=120 ;;
  us)      PROMPT_FILE="scripts/digest-us.prompt.md";      TIMEOUT=1500; MAX_TURNS=120 ;;
  night)   PROMPT_FILE="scripts/digest-night.prompt.md";   TIMEOUT=2400; MAX_TURNS=200 ;;
  *) echo "unknown mode: $MODE"; exit 1 ;;
esac
PROMPT_FILE="/root/Projects/ai-trading-bot/$PROMPT_FILE"
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
