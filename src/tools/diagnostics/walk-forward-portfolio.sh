#!/bin/bash
# Walk-forward sanity test: run portfolio.ts on 12 non-overlapping 30-day windows
# across the last 365 days. Each window uses same fixed strategy params — we are
# NOT optimizing per window. Goal: confirm edge holds across all market regimes,
# not just one favorable stretch.
#
# Output: /tmp/wf-summary.txt with one line per window.

set -e
OUT=/tmp/wf-summary.txt
: > "$OUT"

echo "Walk-forward portfolio: 12 × 30d windows" | tee -a "$OUT"
echo "params: risk 0.375%, cap-10, slip 0.25%, cooldown 12h SL, rrTp2 ≥ 0.3" | tee -a "$OUT"
echo "" | tee -a "$OUT"
printf "%-12s %-12s %6s %6s %6s %8s %7s %7s\n" "from" "to" "trades" "WR%" "PF" "netR" "DD%" "pnl%" | tee -a "$OUT"
printf "%-12s %-12s %6s %6s %6s %8s %7s %7s\n" "----" "----" "------" "----" "----" "----" "----" "----" | tee -a "$OUT"

# 365 days back, anchored to now
END_NOW=$(date -u +%s)
WIN_SEC=$((30 * 24 * 3600))
for i in $(seq 12 -1 1); do
  end_ts=$((END_NOW - (i - 1) * WIN_SEC))
  start_ts=$((end_ts - WIN_SEC))
  from_iso=$(date -u -d "@$start_ts" +%Y-%m-%dT%H:%M:%SZ)
  to_iso=$(date -u -d "@$end_ts" +%Y-%m-%dT%H:%M:%SZ)
  log=/tmp/wf-w${i}.log
  BT_START_ISO="$from_iso" BT_END_ISO="$to_iso" \
    COOLDOWN_HOURS=12 MIN_RR_TP2=0.3 \
    npx tsx src/backtest/cli/portfolio.ts 30 0.375 10 "" 0.25 > "$log" 2>&1
  # Extract summary line
  trades=$(grep -oE "trades: [0-9]+" "$log" | tail -1 | awk '{print $2}')
  wr=$(grep -oE "WR: [0-9.]+%" "$log" | tail -1 | tr -d 'WR: %')
  pf=$(grep -oE "PF: [0-9.]+" "$log" | tail -1 | awk '{print $2}')
  totalr=$(grep -oE "totalR: -?[0-9.]+" "$log" | tail -1 | awk '{print $2}')
  dd=$(grep -oE "MaxDD: [0-9.]+%" "$log" | tail -1 | tr -d 'MaxDD: %')
  pnl=$(grep -oE "Net P&L: \\\$-?[0-9]+ \\(-?[0-9.]+%\\)" "$log" | tail -1 | grep -oE "\\(-?[0-9.]+%\\)" | tr -d '()%')
  printf "%-12s %-12s %6s %6s %6s %8s %7s %7s\n" \
    "${from_iso:0:10}" "${to_iso:0:10}" "${trades:-?}" "${wr:-?}" "${pf:-?}" "${totalr:-?}" "${dd:-?}" "${pnl:-?}" | tee -a "$OUT"
done

echo "" | tee -a "$OUT"
echo "Done. Per-window logs at /tmp/wf-wN.log" | tee -a "$OUT"
