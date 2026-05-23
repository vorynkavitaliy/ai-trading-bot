/**
 * Live SL analysis — answer "почему так часто получаем стопы".
 *
 * Pulls from `trades` table (only status='closed' with exit_reason set) and
 * computes:
 *   1. Aggregate WR/PF/expR for last 7/14/30 days vs full window.
 *   2. exit_reason histogram (sl / tp1 / tp2 / tp1_then_sl_be / manual / ...).
 *   3. Per-pair SL count and net R.
 *   4. Per-hour-of-day (UTC) SL clustering.
 *   5. Streaks — longest consecutive SL run, current open streak.
 *   6. Recent SLs (last 10) — pair, side, time, R.
 *
 * Read-only. Usage: npx tsx src/tools/diagnostics/live-sl-analysis.ts [days=14]
 */
import { query, close as closePg } from '../../core/db';

type Row = {
  id: number;
  symbol: string;
  side: string;
  status: string;
  exit_reason: string | null;
  pnl_usd: string | null;
  realized_r: string | null;
  opened_at: string | null;
  closed_at: string | null;
};

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return 'n/a';
  return n.toFixed(d);
}

async function main() {
  const days = Number(process.argv[2] ?? 14);
  const sinceMs = Date.now() - days * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();

  console.log('═'.repeat(78));
  console.log(`LIVE SL ANALYSIS — last ${days} days (since ${sinceIso})`);
  console.log('═'.repeat(78));

  // Pull every closed trade. Account-bucket dedup: each signal is mirrored to
  // every sub-key, so for win/loss math we collapse by (opened_at, symbol).
  const { rows } = await query<Row>(
    `SELECT id, symbol, side, status, exit_reason, pnl_usd::text, realized_r::text,
            opened_at::text, closed_at::text
     FROM trades
     WHERE status = 'closed'
       AND closed_at >= $1
     ORDER BY closed_at ASC`,
    [sinceIso]
  );

  if (rows.length === 0) {
    console.log('\nNo closed trades in window.');
    await closePg();
    return;
  }

  // Dedup across sub-keys: one logical trade = (opened_at minute, symbol, side).
  const seen = new Map<string, Row>();
  for (const r of rows) {
    const minute = r.opened_at ? r.opened_at.slice(0, 16) : 'na';
    const key = `${r.symbol}|${r.side}|${minute}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  const trades = Array.from(seen.values());

  console.log(`\nClosed trades in window: ${rows.length} raw rows → ${trades.length} logical trades after sub-key dedup\n`);

  // --- 1. Aggregate metrics
  let wins = 0, losses = 0, beScratch = 0;
  let sumR = 0;
  let sumPosR = 0, sumNegR = 0;
  for (const t of trades) {
    const r = t.realized_r != null ? Number(t.realized_r) : 0;
    sumR += r;
    if (r > 0.05) { wins++; sumPosR += r; }
    else if (r < -0.05) { losses++; sumNegR += r; }
    else beScratch++;
  }
  const total = wins + losses + beScratch;
  const wr = total ? (wins / total) * 100 : 0;
  const pf = sumNegR < 0 ? sumPosR / Math.abs(sumNegR) : Infinity;
  const expR = total ? sumR / total : 0;

  console.log('━━━ AGGREGATE ━━━');
  console.log(`  trades:        ${total}  (wins ${wins} / losses ${losses} / BE-scratch ${beScratch})`);
  console.log(`  win rate:      ${fmt(wr, 1)}%`);
  console.log(`  profit factor: ${fmt(pf, 2)}`);
  console.log(`  expectancy:    ${fmt(expR, 3)} R / trade`);
  console.log(`  net R:         ${fmt(sumR, 2)} R`);

  // --- 2. Exit-reason histogram
  console.log('\n━━━ EXIT REASON BREAKDOWN ━━━');
  const reasons = new Map<string, { n: number; r: number }>();
  for (const t of trades) {
    const k = t.exit_reason ?? 'null';
    const r = t.realized_r != null ? Number(t.realized_r) : 0;
    const cur = reasons.get(k) ?? { n: 0, r: 0 };
    cur.n++;
    cur.r += r;
    reasons.set(k, cur);
  }
  const reasonList = Array.from(reasons.entries()).sort((a, b) => b[1].n - a[1].n);
  for (const [k, v] of reasonList) {
    const pct = (v.n / trades.length) * 100;
    console.log(`  ${k.padEnd(20)}  ${String(v.n).padStart(3)}  (${fmt(pct, 1)}%)   net ${fmt(v.r, 2)}R  avg ${fmt(v.r / v.n, 3)}R`);
  }

  // --- 3. Per-pair SL counts
  console.log('\n━━━ PER-PAIR (sorted by SL count, desc) ━━━');
  type Per = { trades: number; sl: number; tp1: number; tp2: number; other: number; netR: number };
  const per = new Map<string, Per>();
  for (const t of trades) {
    const cur = per.get(t.symbol) ?? { trades: 0, sl: 0, tp1: 0, tp2: 0, other: 0, netR: 0 };
    cur.trades++;
    cur.netR += t.realized_r != null ? Number(t.realized_r) : 0;
    const er = t.exit_reason ?? '';
    if (er === 'sl') cur.sl++;
    else if (er === 'tp1') cur.tp1++;
    else if (er === 'tp2') cur.tp2++;
    else cur.other++;
    per.set(t.symbol, cur);
  }
  const perList = Array.from(per.entries()).sort((a, b) => b[1].sl - a[1].sl);
  console.log('  pair         n   sl  tp1  tp2  other   netR    slRate');
  for (const [sym, v] of perList) {
    const slRate = (v.sl / v.trades) * 100;
    console.log(`  ${sym.padEnd(11)} ${String(v.trades).padStart(3)} ${String(v.sl).padStart(4)} ${String(v.tp1).padStart(4)} ${String(v.tp2).padStart(4)} ${String(v.other).padStart(6)} ${fmt(v.netR, 2).padStart(7)}  ${fmt(slRate, 1).padStart(5)}%`);
  }

  // --- 4. SL by hour of day (UTC)
  console.log('\n━━━ SL BY HOUR OF DAY (UTC) ━━━');
  const byHour = new Array(24).fill(0);
  for (const t of trades) {
    if (t.exit_reason !== 'sl' || !t.closed_at) continue;
    const h = new Date(t.closed_at).getUTCHours();
    byHour[h]++;
  }
  const maxH = Math.max(...byHour, 1);
  for (let h = 0; h < 24; h++) {
    const bar = '█'.repeat(Math.round((byHour[h] / maxH) * 30));
    console.log(`  ${String(h).padStart(2, '0')}:00 UTC  ${String(byHour[h]).padStart(3)}  ${bar}`);
  }

  // --- 5. Streaks
  console.log('\n━━━ LOSS STREAKS ━━━');
  let curStreak = 0, maxStreak = 0, lastStreakEnd = '';
  let curStreakStart = '';
  let trailingLosses = 0;
  for (const t of trades) {
    const r = t.realized_r != null ? Number(t.realized_r) : 0;
    if (r < -0.05) {
      if (curStreak === 0) curStreakStart = t.closed_at?.slice(0, 16) ?? '';
      curStreak++;
      if (curStreak > maxStreak) {
        maxStreak = curStreak;
        lastStreakEnd = t.closed_at?.slice(0, 16) ?? '';
      }
    } else {
      curStreak = 0;
    }
  }
  // trailing losses = consecutive losses up to most-recent trade
  for (let i = trades.length - 1; i >= 0; i--) {
    const r = trades[i].realized_r != null ? Number(trades[i].realized_r) : 0;
    if (r < -0.05) trailingLosses++;
    else break;
  }
  console.log(`  longest loss streak in window: ${maxStreak} (ended ${lastStreakEnd})`);
  console.log(`  trailing loss streak (now):    ${trailingLosses}`);

  // --- 6. Last 10 SLs
  console.log('\n━━━ LAST 10 SLs ━━━');
  const sls = trades.filter((t) => t.exit_reason === 'sl').slice(-10);
  if (sls.length === 0) console.log('  none');
  for (const t of sls) {
    const r = t.realized_r != null ? Number(t.realized_r) : 0;
    const open = t.opened_at?.slice(0, 16) ?? '?';
    const close = t.closed_at?.slice(0, 16) ?? '?';
    console.log(`  ${close}  ${t.symbol.padEnd(10)} ${t.side.padEnd(4)}  opened ${open}  R=${fmt(r, 2)}`);
  }

  // --- 7. Sanity: are we still actively trading?
  const lastClose = trades[trades.length - 1].closed_at;
  const ageH = lastClose ? (Date.now() - Date.parse(lastClose)) / 3_600_000 : null;
  console.log(`\nLast closed trade: ${lastClose ?? 'n/a'}  (${ageH != null ? fmt(ageH, 1) + 'h ago' : 'n/a'})`);

  await closePg();
}

main().catch(async (e) => {
  console.error(e);
  try { await closePg(); } catch {}
  process.exit(1);
});
