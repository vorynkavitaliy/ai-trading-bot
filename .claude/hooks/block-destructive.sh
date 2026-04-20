#!/bin/bash
# Pre-Bash hook: blocks catastrophic destructive operations that should never
# happen during normal bot operation. Exists to catch modelling mistakes in
# bypassPermissions mode where there is no human prompt to catch them.
#
# This hook does NOT block normal rm/git/curl — only clearly-catastrophic patterns.
#
# Input: JSON on stdin with tool_input.command
# Output: exit 2 + stderr message to block; exit 0 to allow.

input=$(cat)
command=$(echo "$input" | grep -oP '"command"\s*:\s*"\K[^"]+(?=")' | head -1)

block() {
  local reason="$1"
  cat >&2 <<MSG
🚫 Catastrophic operation blocked: $reason

This hook catches operations that should never happen during normal bot operation.
If you genuinely need to run this command, execute it manually in a separate terminal.

Command was: $command
MSG
  exit 2
}

# rm -rf of root, home, critical dirs
if echo "$command" | grep -qE '(^|\s|;|&&|\|)\s*(sudo\s+)?rm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r?|--recursive\s+--force|--force\s+--recursive)\s+(/|/\*|/root($|/)|~($|/)|/home($|/)|\$HOME($|/)|/etc($|/)|/var($|/)|/usr($|/)|/bin($|/)|/sbin($|/)|/boot($|/)|/sys($|/)|/proc($|/)|/\.\.)'; then
  block "rm -rf against system or home directory"
fi

# rm -rf of the project root itself
if echo "$command" | grep -qE 'rm\s+-[a-z]*r[a-z]*f?.*(/root/Projects/ai-trading-bot($|/\s*$))'; then
  block "rm -rf of project root"
fi

# git force push to main/master
if echo "$command" | grep -qE 'git\s+push\s+.*--force.*(main|master|origin/main|origin/master)'; then
  block "git force push to main/master"
fi

# git reset --hard to a remote ref that would lose uncommitted work (soft block)
# (allow git reset --hard HEAD, block if resetting to specific SHA from history)
if echo "$command" | grep -qE 'git\s+reset\s+--hard\s+[a-f0-9]{7,40}(\s|$)'; then
  block "git reset --hard to arbitrary SHA (can lose work)"
fi

# Pipe to shell (curl | bash / wget | sh etc)
if echo "$command" | grep -qE '(curl|wget|fetch)\s+[^|]*\|\s*(bash|sh|zsh|python|python3|node|ruby|perl)(\s|$)'; then
  block "piping remote content to shell interpreter"
fi

# Fork bomb
if echo "$command" | grep -qE ':\(\)\s*\{.*\|.*&.*\}'; then
  block "fork bomb pattern"
fi

# dd to block devices
if echo "$command" | grep -qE 'dd\s+.*of=/dev/(sd[a-z]|nvme|hd[a-z]|disk|xvd)'; then
  block "dd to block device"
fi

# mkfs / format operations
if echo "$command" | grep -qE '(mkfs|mke2fs|mkswap|fdisk|parted)\s+/dev/'; then
  block "filesystem/partition modification"
fi

# SQL destructive without WHERE
if echo "$command" | grep -qiE '(psql|mysql|sqlite).*-c\s+["\x27].*\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b'; then
  # Allow if it's explicitly targeting test/temp DB
  if ! echo "$command" | grep -qiE '(test|temp|tmp|scratch|_test\b|_tmp\b)'; then
    block "SQL DROP/TRUNCATE on non-test database"
  fi
fi

# Cryptographic key / wallet file deletion
if echo "$command" | grep -qE 'rm\s+.*(\.ssh|\.gnupg|\.bitcoin|wallet\.dat|accounts\.json|\.env|private.*key)'; then
  block "deletion of credentials/keys/wallet files"
fi

# Chmod that grants world-write/execute to sensitive paths
if echo "$command" | grep -qE 'chmod\s+.*(777|666).*(/root|/etc|/var|\.ssh|\.env|accounts\.json)'; then
  block "chmod 777/666 on sensitive path"
fi

# shutdown / reboot / halt
if echo "$command" | grep -qE '(^|\s|;|&&)(sudo\s+)?(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)(\s|$)'; then
  block "system shutdown/reboot"
fi

exit 0
