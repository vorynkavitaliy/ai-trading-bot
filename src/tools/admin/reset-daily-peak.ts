/**
 * reset-daily-peak — clears today's risk_daily_peak row and re-seeds it at the
 * CURRENT equity, then prints the recomputed risk state.
 *
 * Use when the stored daily peak no longer matches the live account set — e.g. a
 * sub-account was intentionally removed from accounts.json, so equity legitimately
 * dropped and the stale 4-account peak triggers a FALSE trailing-DD hard-kill.
 * P&L-based kills (soft/hard/total) are untouched; only the peak baseline resets.
 *
 * Run: npx tsx src/tools/admin/reset-daily-peak.ts
 */

import { query, close as closePg } from '../../core/db';
import { getRiskState } from '../../runtime/risk-guard';

async function main(): Promise<void> {
  const utcDay = new Date().toISOString().slice(0, 10);
  const del = await query(`DELETE FROM risk_daily_peak WHERE utc_day = $1::date`, [utcDay]);
  console.log(`deleted ${del.rowCount ?? 0} stale peak row(s) for ${utcDay}`);

  const s = await getRiskState();
  console.log('=== recomputed risk state ===');
  console.log(JSON.stringify({
    totalEquityUsd: Math.round(s.totalEquityUsd),
    dailyPnlPct: Number(s.dailyPnlPct.toFixed(2)),
    dailyPeakEquityUsd: Math.round(s.dailyPeakEquityUsd),
    dailyTroughEquityUsd: Math.round(s.dailyTroughEquityUsd),
    dailyDdFromPeakPct: Number(s.dailyDdFromPeakPct.toFixed(2)),
    softKillTriggered: s.softKillTriggered,
    hardKillTriggered: s.hardKillTriggered,
    totalKillTriggered: s.totalKillTriggered,
  }, null, 2));

  await closePg();
}

main().catch((e) => { console.error(e); process.exit(1); });
