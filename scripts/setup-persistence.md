# Persistence setup — run Claude trader 24/7 on VPS

## The problem

Claude Code runs as an interactive CLI tied to your SSH TTY. When you disconnect:
- TTY closes → Claude process receives SIGHUP → can die.
- Even if process survives, `CronCreate` is session-only and only fires while REPL is idle.

VPS keeps running, but the Claude session on it can be silently killed.

## Three layers of persistence

### Layer 1 — tmux (survives SSH disconnect)

Claude runs inside a tmux session that lives on the VPS. When you disconnect SSH, tmux keeps running.

**Start / attach:**

```bash
cd /root/Projects/ai-trading-bot
./scripts/start-trader.sh
```

The script:
- Creates tmux session `claude-trader` if missing.
- Attaches you to it.
- Inside: runs `claude --continue` (resumes last conversation).

**Detach while leaving Claude running:** `Ctrl+B` then `D`.

**Reattach from a new SSH session:**

```bash
tmux attach -t claude-trader
```

**Kill it (only if you need to stop):**

```bash
tmux kill-session -t claude-trader
```

### Layer 2 — systemd (survives VPS reboot)

tmux sessions die when the VPS reboots. systemd starts Claude inside tmux automatically on boot.

**Install (one-time):**

```bash
cp /root/Projects/ai-trading-bot/scripts/claude-trader.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable claude-trader.service
systemctl start claude-trader.service
```

**Check status:**

```bash
systemctl status claude-trader.service
tmux ls    # should show claude-trader session
```

**Attach to running:**

```bash
tmux attach -t claude-trader
```

**Stop / restart:**

```bash
systemctl stop claude-trader.service
systemctl restart claude-trader.service
```

### Layer 3 — `/schedule` remote trigger (recommended for /trade-scan)

Even with tmux + systemd, `CronCreate` is session-only and dies on process restart. For the `/trade-scan` scheduler, use `/schedule` instead — it runs on Anthropic's cloud infrastructure and is independent of the VPS entirely.

**Inside Claude, once /trade-scan is running in the tmux session:**

```
/schedule create "/trade-scan all" --cron "*/3 * * * *" --name trade-scan-all
```

Benefits:
- Survives VPS shutdown (Anthropic infrastructure fires the agent).
- Survives Claude process restart.
- Centralized monitoring via `/schedule list`.

## Daily operation

1. SSH into VPS.
2. `tmux attach -t claude-trader` — see current state, interact if needed.
3. `Ctrl+B D` to detach; close laptop; Claude keeps running.
4. Trading continues autonomously; Telegram alerts report on state.

## If Claude needs a new conversation (context exhausted)

Inside the tmux session:
1. Exit Claude cleanly.
2. Run `claude` (not `--continue`) for a fresh start.
3. Re-run your recurring task: `/loop 3m /trade-scan all` or `/schedule create …`.

## Verification checklist

- [ ] `tmux ls` shows `claude-trader` session.
- [ ] `tmux attach -t claude-trader` shows live Claude REPL.
- [ ] `/schedule list` (or `CronList`) shows active `trade-scan` job.
- [ ] `systemctl status claude-trader` is `active (running)`.
- [ ] After detach (Ctrl+B D) and SSH disconnect + reconnect, you can reattach and see recent cycles.

## Belt + suspenders: OS-level heartbeat (optional)

Add a system cron job that alerts via Telegram if `/trade-scan` hasn't run recently:

```bash
# Check last vault journal write; alert if stale >10min
*/5 * * * * root find /root/Projects/ai-trading-bot/vault/Journal -mmin -10 -name "$(date -u +\%Y-\%m-\%d).md" | grep -q . || curl -s -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" -d "chat_id=$TG_CHAT_ID&text=⚠️ /trade-scan stale >10min"
```

(Requires `TG_BOT_TOKEN` + `TG_CHAT_ID` env vars. Adapt to your Telegram setup.)
