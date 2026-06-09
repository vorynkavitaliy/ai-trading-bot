/**
 * db-trades-7d — ground-truth live trades over the last N days (default 7) from the
 * trades table. Splits by side (Buy/Sell=short), sums pnl_usd ACROSS all account rows
 * (signals are broadcast to every subkey → N rows per pair-trade), and lists the
 * closed trades. Truth metric is pnl_usd (realized_r in DB is inflated ~2x on TP1
 * partials — see memory feedback_live_vs_backtest_truth); we also recompute honest R.
 *
 * Run: npx tsx src/tools/diagnostics/db-trades-7d.ts 7
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const days = parseFloat(process.argv[2] ?? '7');
  const sinceMs = Date.now() - days * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();

  const { rows } = await query<any>(
    `SELECT id, account_key, symbol, side, status, qty, initial_qty,
            entry_price, sl, exit_price, exit_reason, pnl_usd, realized_r,
            opened_at, closed_at, rationale
       FROM trades
      WHERE closed_at >= $1::timestamptz AND status = 'closed'
      ORDER BY closed_at ASC, id ASC`,
    [sinceIso],
  );
  // Entry classification: auto-execute prefixes rationale with "[auto]". Anything
  // else = an operator manual entry (execute.ts run by hand).
  const isAuto = (r: any) => String(r.rationale ?? '').trim().startsWith('[auto]');

  const n = (v: any) => (v == null ? null : Number(v));
  const honestR = (r: any): number | null => {
    const e = n(r.entry_price), sl = n(r.sl), q = n(r.initial_qty) ?? n(r.qty), p = n(r.pnl_usd);
    if (e == null || sl == null || q == null || p == null || Math.abs(e - sl) === 0 || q === 0) return null;
    return p / (Math.abs(e - sl) * q);
  };

  console.log(`\nLIVE closed trades since ${sinceIso} (${days}d) — pnl summed across ALL account rows\n`);

  // By side
  const bySide = new Map<string, { n: number; pnl: number }>();
  // By symbol+side
  const bySym = new Map<string, { n: number; pnl: number }>();
  let total = 0;
  for (const r of rows) {
    const side = String(r.side);
    const pnl = n(r.pnl_usd) ?? 0;
    total += pnl;
    const s = bySide.get(side) ?? { n: 0, pnl: 0 }; s.n++; s.pnl += pnl; bySide.set(side, s);
    const k = `${r.symbol} ${side}`;
    const sy = bySym.get(k) ?? { n: 0, pnl: 0 }; sy.n++; sy.pnl += pnl; bySym.set(k, sy);
  }

  console.log('=== BY SIDE (Sell = short) ===');
  for (const [side, v] of bySide) console.log(`  ${side.padEnd(5)} rows=${String(v.n).padStart(3)}  pnl=$${v.pnl.toFixed(0)}`);
  console.log(`  TOTAL rows=${rows.length}  pnl=$${total.toFixed(0)}`);

  // Auto (algo) vs manual (operator) entry split — separates the strategy from your hand.
  const cls = { auto: { n: 0, pnl: 0 }, manual: { n: 0, pnl: 0 } };
  for (const r of rows) {
    const c = isAuto(r) ? cls.auto : cls.manual;
    c.n++; c.pnl += n(r.pnl_usd) ?? 0;
  }
  console.log('\n=== BY ENTRY TYPE (algo vs your manual) ===');
  console.log(`  ALGO   (auto-execute) rows=${String(cls.auto.n).padStart(3)}  pnl=$${cls.auto.pnl.toFixed(0)}`);
  console.log(`  MANUAL (your entries) rows=${String(cls.manual.n).padStart(3)}  pnl=$${cls.manual.pnl.toFixed(0)}`);

  console.log('\n=== BY SYMBOL × SIDE (sorted by pnl) ===');
  for (const [k, v] of [...bySym.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
    console.log(`  ${k.padEnd(16)} rows=${String(v.n).padStart(3)}  pnl=$${v.pnl.toFixed(0)}`);
  }

  console.log('\n=== CLOSED TRADES (each account row) ===  [A=algo / M=your manual entry]');
  console.log('closed_at            symbol     side  E  reason        pnl$      honestR');
  for (const r of rows) {
    const hr = honestR(r);
    console.log(
      `  ${String(r.closed_at instanceof Date ? r.closed_at.toISOString() : r.closed_at).slice(0, 19)}  ` +
      `${String(r.symbol).padEnd(9)}  ${String(r.side).padEnd(4)}  ${isAuto(r) ? 'A' : 'M'}  ${String(r.exit_reason ?? '').padEnd(12)}  ` +
      `${(n(r.pnl_usd) ?? 0).toFixed(0).padStart(8)}  ${(hr == null ? '—' : hr.toFixed(2)).padStart(7)}`,
    );
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
