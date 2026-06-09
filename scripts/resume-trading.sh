#!/usr/bin/env bash
# One-shot: remove the auto-execute PAUSE so the bot returns to normal mode.
# Scheduled via a transient systemd timer (systemd-run --on-calendar) to fire at
# 00:00 UTC. The `rm` is done FIRST and unconditionally, so resume is guaranteed
# even if the Telegram confirmation below fails (minimal env / node missing).
set -uo pipefail
export PATH="/root/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
cd /root/Projects/ai-trading-bot || exit 1

PAUSE="/root/Projects/ai-trading-bot/vault/Watchlist/PAUSE.md"

# Idempotent: only act (and notify) if the pause actually existed. Guards against
# double-fire (e.g. timer + a fallback) producing a misleading "resumed" message.
if [ ! -e "$PAUSE" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] resume-trading: no PAUSE present, nothing to do" >> /tmp/cycle.log
  exit 0
fi

rm -f "$PAUSE"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] resume-trading: PAUSE removed -> auto-execute back to normal mode" >> /tmp/cycle.log

# Best-effort Telegram confirmation (resume already guaranteed by the rm above).
npx tsx src/tools/diagnostics/tg-test.ts "✅ Бот снят с паузы автоматически (00:00 UTC). Штатный режим: авто-исполнение сигналов включено. Новый UTC-день — дневные лимиты и счётчик входов сброшены." >> /tmp/cycle.log 2>&1 || true
