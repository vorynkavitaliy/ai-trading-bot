/**
 * Live 7-day snapshot for backtest comparison.
 *
 * Pulls all closed trades from past 7 days, dedups across sub-keys (one logical
 * trade per (symbol, side, opened_at_minute)), prints aggregate + per-pair +
 * trade-by-trade so we can compare R-by-R against 7-day backtest output.
 *
 * Read-only.
 */
import { query, close as closePg } from '../../core/db';

type Row = {
  id: number;
  symbol: string;
  side: string;
  status: string;
  exit_reason: string | null;
  realized_r: string | null;
  pnl_usd: string | null;
  entry_price: string | null;
  sl: string | null;
  qty: string | null;
  initial_qty: string | null;
  tp1_filled_qty: string | null;
  opened_at: string | null;
  closed_at: string | null;
};

/**
 * Correct realized R for trades that hit TP1 partial.
 *
 * Bug in src/runtime/reconcile.ts:188 — uses `t.qty` (= remaining qty after TP1
 * partial close) when computing riskedUsd, instead of initial qty. This inflates
 * realized_r by ~2× for any trade where TP1 fired.
 *
 * Recompute here as pnl_usd / (stopDist × initialQty).
 *  - initialQty = qty + tp1_filled_qty when TP1 fired (qty is what's left)
 *  - initialQty = qty otherwise
 *  - initial_qty column is sometimes populated (newer trades) — prefer it when present
 */
function correctR(r: Row): number {
  const recorded = r.realized_r != null ? Number(r.realized_r) : 0;
  if (r.pnl_usd == null || r.entry_price == null || r.sl == null || r.qty == null) {
    return recorded;
  }
  const entry = Number(r.entry_price);
  const sl = Number(r.sl);
  const stopDist = Math.abs(entry - sl);
  if (!isFinite(stopDist) || stopDist <= 0) return recorded;
  const qtyRemaining = Number(r.qty);
  const tp1Filled = r.tp1_filled_qty != null ? Number(r.tp1_filled_qty) : 0;
  // Best estimate of original (pre-TP1-partial) qty.
  const initialQty = r.initial_qty != null
    ? Number(r.initial_qty)
    : (tp1Filled > 0 ? qtyRemaining + tp1Filled : qtyRemaining);
  const riskedUsd = stopDist * initialQty;
  if (!isFinite(riskedUsd) || riskedUsd <= 0) return recorded;
  return Number(r.pnl_usd) / riskedUsd;
}

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return 'n/a';
  return n.toFixed(d);
}

async function main() {
  const days = Number(process.argv[2] ?? 7);
  const sinceMs = Date.now() - days * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();

  console.log(`LIVE ${days}d SNAPSHOT — since ${sinceIso}`);
  console.log('═'.repeat(78));

  const { rows } = await query<Row>(
    `SELECT id, symbol, side, status, exit_reason,
            realized_r::text, pnl_usd::text,
            entry_price::text, sl::text, qty::text,
            initial_qty::text, tp1_filled_qty::text,
            opened_at::text, closed_at::text
     FROM trades
     WHERE status = 'closed' AND closed_at >= $1
     ORDER BY opened_at ASC`,
    [sinceIso]
  );

  if (rows.length === 0) { console.log('no trades'); await closePg(); return; }

  const seen = new Map<string, Row>();
  for (const r of rows) {
    const minute = r.opened_at ? r.opened_at.slice(0, 16) : 'na';
    const key = `${r.symbol}|${r.side}|${minute}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  const trades = Array.from(seen.values());

  console.log(`raw rows: ${rows.length}   logical trades (dedup): ${trades.length}`);
  console.log();

  let wins = 0, losses = 0, be = 0, sumR = 0, sumPos = 0, sumNeg = 0;
  let sumRRecorded = 0;
  for (const t of trades) {
    const r = correctR(t);
    const rRec = t.realized_r != null ? Number(t.realized_r) : 0;
    sumRRecorded += rRec;
    sumR += r;
    if (r > 0.05) { wins++; sumPos += r; }
    else if (r < -0.05) { losses++; sumNeg += r; }
    else be++;
  }
  const total = wins + losses + be;
  const wr = total ? (wins / total) * 100 : 0;
  const pf = sumNeg < 0 ? sumPos / Math.abs(sumNeg) : Infinity;
  const expR = total ? sumR / total : 0;

  console.log('AGGREGATE  (R corrected for reconcile.ts:188 bug)');
  console.log(`  trades:        ${total}   (wins ${wins} / losses ${losses} / BE ${be})`);
  console.log(`  WR:            ${fmt(wr, 1)}%`);
  console.log(`  PF:            ${fmt(pf, 2)}`);
  console.log(`  expR:          ${fmt(expR, 3)} R/trade`);
  console.log(`  net R (corr):  ${fmt(sumR, 2)} R`);
  console.log(`  net R (DB):    ${fmt(sumRRecorded, 2)} R   ← uncorrected, inflated by ~2× on TP1 trades`);
  console.log();

  console.log('TRADE-BY-TRADE  (R-rec = DB, R-corr = corrected)');
  console.log('  opened             closed             symbol      side    exit         R-rec  R-corr');
  for (const t of trades) {
    const rRec = t.realized_r != null ? Number(t.realized_r) : 0;
    const r = correctR(t);
    const op = t.opened_at?.slice(0, 16) ?? '?';
    const cl = t.closed_at?.slice(0, 16) ?? '?';
    const er = (t.exit_reason ?? '').padEnd(10);
    console.log(`  ${op}   ${cl}   ${t.symbol.padEnd(10)}  ${t.side.padEnd(6)}  ${er}  ${fmt(rRec, 2).padStart(6)}  ${fmt(r, 2).padStart(6)}`);
  }

  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
