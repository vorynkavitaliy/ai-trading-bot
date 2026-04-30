#!/usr/bin/env bash
# Start/attach Claude trader inside a persistent tmux session.
# Session survives SSH disconnects; Claude keeps running on the VPS.
#
# Usage:
#   ./scripts/start-trader.sh          # create or attach
#   tmux attach -t claude-trader       # reattach later
#   tmux ls                            # list sessions
#   tmux kill-session -t claude-trader # stop (only if needed)

set -euo pipefail

SESSION=claude-trader
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Attaching to existing session: $SESSION"
  exec tmux attach -t "$SESSION"
fi

echo "Creating new tmux session: $SESSION"
tmux new-session -d -s "$SESSION" -c "$PROJECT_DIR"

# Window 1 — Claude (main interactive)
tmux rename-window -t "$SESSION:0" claude
tmux send-keys -t "$SESSION:claude" "cd $PROJECT_DIR && claude --continue" C-m

# Window 2 — tail logs (optional)
tmux new-window -t "$SESSION" -n logs -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION:logs" "echo 'logs pane — tail any log file here'" C-m

tmux select-window -t "$SESSION:claude"
echo "Attaching…  (Ctrl+B then D to detach and leave it running)"
exec tmux attach -t "$SESSION"
