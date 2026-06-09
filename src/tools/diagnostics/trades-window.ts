/**
 * trades-window — list live trades opened in the last N days, deduped to one row per
 * SIGNAL (a signal is broadcast to all 4 accounts → 4 near-identical rows; we collapse
 * them and sum pnl). For backtest-vs-live comparison.
 *
 * Columns: opened, symbol, side, A(lgo)/M(anual), status/exit, honestR (closed), summed pnl$,
 * entry (fill), signal_price (if logged). honestR = Σpnl / (stopDist × Σinitial_qty) — the
 * memory-mandated recompute (reconcile.realized_r can be ~2× inflated on TP1-partials).
 *
 * Run: npx tsx src/tools/diagnostics/trades-window.ts [days=4]
 */
import { query, close as closePg } from '../../core/db';

interface Row {
  symbol: string; side: string; account_bucket: string; account_key: string;
  entry_price: string | null; signal_price: string | null; sl: string | null; initial_qty: string | null;
  status: string; exit_reason: string | null; pnl_usd: string | null; opened_at: string; rationale: string | null;
}

async function main(): Promise<void> {
  const days = parseFloat(process.argv[2] ?? '4');
  const sinceMs = Date.now() - days * 24 * 3600_000;
  const { rows } = await query<Row>(
    `SELECT symbol, side, account_bucket, account_key, entry_price::text, signal_price::text,
            sl::text, initial_qty::text, status, exit_reason, pnl_usd::text, opened_at::text, rationale
     FROM trades WHERE opened_at >= to_timestamp($1/1000.0) ORDER BY opened_at ASC`,
    [sinceMs],
  );

  // Group to one signal: key = symbol|side|opened-to-minute.
  interface Sig { symbol: string; side: string; opened: string; algo: boolean; status: string;
    exit: string; entry: number; signal: number | null; sl: number; qtySum: number; pnlSum: number; nAcct: number; }
  const sigs = new Map<string, Sig>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.side}|${r.opened_at.slice(0, 16)}`;
    const entry = r.entry_price ? parseFloat(r.entry_price) : NaN;
    const sl = r.sl ? parseFloat(r.sl) : NaN;
    const qty = r.initial_qty ? parseFloat(r.initial_qty) : 0;
    const pnl = r.pnl_usd ? parseFloat(r.pnl_usd) : 0;
    const sig = r.signal_price ? parseFloat(r.signal_price) : null;
    const algo = (r.rationale ?? '').startsWith('[auto]');
    const existing = sigs.get(key);
    if (existing) {
      existing.qtySum += qty; existing.pnlSum += pnl; existing.nAcct += 1;
    } else {
      sigs.set(key, { symbol: r.symbol, side: r.side, opened: r.opened_at.slice(0, 16), algo,
        status: r.status, exit: r.exit_reason ?? (r.status === 'open' ? 'OPEN' : '?'),
        entry, signal: sig, sl, qtySum: qty, pnlSum: pnl, nAcct: 1 });
    }
  }

  const list = [...sigs.values()].sort((a, b) => a.opened.localeCompare(b.opened));
  console.log(`\nLIVE TRADES — opened in last ${days}d  (${list.length} signals, deduped from ${rows.length} account-rows)\n`);
  console.log(`  opened            sym   side  src  status   exit          honestR   pnl$(Σacct)   entry        signal`);
  for (const s of list) {
    const stopDist = Math.abs(s.entry - s.sl);
    const honestR = (s.status !== 'open' && stopDist > 0 && s.qtySum > 0) ? (s.pnlSum / (stopDist * s.qtySum)) : NaN;
    const rStr = Number.isFinite(honestR) ? (honestR >= 0 ? '+' : '') + honestR.toFixed(2) : '   —';
    console.log(
      `  ${s.opened}  ${s.symbol.replace('USDT', '').padEnd(4)}  ${s.side.padEnd(4)}  ${s.algo ? 'A' : 'M'}    ` +
      `${s.status.padEnd(7)}  ${s.exit.padEnd(12)}  ${rStr.padStart(7)}   ${s.pnlSum.toFixed(0).padStart(9)}   ` +
      `${Number.isFinite(s.entry) ? s.entry.toFixed(5) : 'n/a'}   ${s.signal != null ? s.signal.toFixed(5) : 'NULL'}`,
    );
  }

  const algo = list.filter((s) => s.algo);
  const manual = list.filter((s) => !s.algo);
  const closedAlgo = algo.filter((s) => s.status !== 'open');
  console.log(`\n  ── summary ──`);
  console.log(`  algo signals:   ${algo.length}  (${algo.filter((s) => s.status === 'open').length} open, ${closedAlgo.length} closed)`);
  console.log(`  manual signals: ${manual.length}`);
  console.log(`  algo pnl Σ:     $${algo.reduce((a, s) => a + s.pnlSum, 0).toFixed(0)}   manual pnl Σ: $${manual.reduce((a, s) => a + s.pnlSum, 0).toFixed(0)}`);
  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
