/**
 * entry-slippage — measure signal-price vs actual-fill slippage on live algo entries.
 *
 * The strategy anchors SL/TP/sizing to the SIGNAL price (last-closed-bar), but a
 * MARKET order fills at the live price moments later. We don't store the signal price,
 * but we can RECONSTRUCT it from the stored sl + tp1 (single-target book):
 *   SL = signal ± slAtr·ATR,  TP = signal ∓ tpAtr·ATR
 *   → ATR = |sl - tp1| / (slAtr + tpAtr),  signal = sl ∓ slAtr·ATR (sign by side)
 * Then slippage = (signal − fill) for a short / (fill − signal) for a long; positive = ADVERSE.
 * Expressed in R against the intended (signal-based) stop distance slAtr·ATR.
 *
 * Scope: current single-entry book only (BTC/SOL/ADA/LINK), algo entries (rationale '[auto]%'),
 * tp1==tp2 (single target → sl never moved to BE), opened since the standalone migration.
 * Manual/scaled-in/old-book trades are excluded — their SL/TP don't follow the clean formula.
 *
 * Run: npx tsx src/tools/diagnostics/entry-slippage.ts [sinceISO]
 */
import { query, close as closePg } from '../../core/db';

// Per-pair (slAtrMult, tpAtrMult) for the live book — src/runtime/pair-strategies.ts.
const MULT: Record<string, { sl: number; tp: number }> = {
  BTCUSDT: { sl: 2.0, tp: 2.0 },
  SOLUSDT: { sl: 2.0, tp: 2.0 },
  ADAUSDT: { sl: 1.5, tp: 2.0 },
  LINKUSDT: { sl: 1.5, tp: 2.0 },
};

interface Row {
  symbol: string; side: string; entry_price: string; sl: string; tp1: string; tp2: string;
  signal_price: string | null;
  account_bucket: string; account_key: string; opened_at: string; status: string; exit_reason: string | null;
}

async function main(): Promise<void> {
  const since = process.argv[2] ?? '2026-06-04';
  const { rows } = await query<Row>(
    `SELECT symbol, side, entry_price::text, sl::text, tp1::text, tp2::text, signal_price::text,
            account_bucket, account_key, opened_at::text, status, exit_reason
     FROM trades
     WHERE symbol = ANY($1) AND opened_at >= $2
       AND rationale LIKE '[auto]%' AND sl IS NOT NULL AND tp1 IS NOT NULL AND tp2 IS NOT NULL
       AND tp1 = tp2
     ORDER BY opened_at ASC`,
    [Object.keys(MULT), since],
  );

  // Dedupe to one row per SIGNAL (same signal broadcast to 4 accounts → ~identical sl/tp/entry).
  const seen = new Set<string>();
  const sigs: Array<{ symbol: string; side: string; opened: string; signal: number; fill: number; atr: number;
    slipAbs: number; slipPct: number; slipR: number; riskMult: number; exit: string }> = [];

  for (const r of rows) {
    const m = MULT[r.symbol];
    if (!m) continue;
    const entry = parseFloat(r.entry_price);
    const sl = parseFloat(r.sl);
    const tp = parseFloat(r.tp1);
    const isSell = r.side === 'Sell';
    const atr = Math.abs(sl - tp) / (m.sl + m.tp);
    if (!(atr > 0)) continue;
    // Prefer the directly-logged signal price (013_signal_price.sql); fall back to
    // reconstruction from sl/tp for rows written before the column existed.
    const stored = r.signal_price != null ? parseFloat(r.signal_price) : NaN;
    const signal = Number.isFinite(stored) && stored > 0 ? stored : (isSell ? sl - m.sl * atr : sl + m.sl * atr);
    const key = `${r.symbol}|${r.side}|${r.opened_at.slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slipAbs = isSell ? signal - entry : entry - signal; // + = adverse
    const stopDistSignal = m.sl * atr;
    const slipPct = (slipAbs / signal) * 100;
    const slipR = slipAbs / stopDistSignal;
    const riskMult = Math.abs(entry - sl) / stopDistSignal; // actual risk / intended risk
    sigs.push({ symbol: r.symbol, side: r.side, opened: r.opened_at.slice(0, 16), signal, fill: entry,
      atr, slipAbs, slipPct, slipR, riskMult, exit: r.status === 'open' ? 'open' : (r.exit_reason ?? '?') });
  }

  if (sigs.length === 0) { console.log(`no current-book algo signals since ${since}`); await closePg(); return; }

  console.log(`\nENTRY SLIPPAGE — current-book algo entries since ${since}  (signal reconstructed from sl/tp1)`);
  console.log(`${sigs.length} signals  (+ = adverse fill, worse than signal)\n`);
  console.log(`  date              sym   side  signal      fill        slip%    slipR   riskMult  exit`);
  for (const s of sigs) {
    const sign = s.slipPct >= 0 ? '+' : '';
    console.log(
      `  ${s.opened}  ${s.symbol.replace('USDT', '').padEnd(4)}  ${s.side.padEnd(4)}  ` +
      `${s.signal.toFixed(5).padStart(10)}  ${s.fill.toFixed(5).padStart(10)}  ` +
      `${(sign + s.slipPct.toFixed(2)).padStart(7)}  ${(s.slipR >= 0 ? '+' : '') + s.slipR.toFixed(2).padStart(5)}  ` +
      `${s.riskMult.toFixed(2).padStart(6)}x  ${s.exit}`,
    );
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const pcts = sigs.map((s) => s.slipPct);
  const rs = sigs.map((s) => s.slipR);
  const rms = sigs.map((s) => s.riskMult);
  const adverse = sigs.filter((s) => s.slipAbs > 0).length;

  console.log(`\n── AGGREGATE (${sigs.length} signals) ──`);
  console.log(`  adverse fills:   ${adverse}/${sigs.length}  (${((adverse / sigs.length) * 100).toFixed(0)}%)`);
  console.log(`  slippage %:      mean ${mean(pcts) >= 0 ? '+' : ''}${mean(pcts).toFixed(3)}%   median ${median(pcts) >= 0 ? '+' : ''}${median(pcts).toFixed(3)}%`);
  console.log(`  slippage in R:   mean ${mean(rs) >= 0 ? '+' : ''}${mean(rs).toFixed(3)}R   median ${median(rs) >= 0 ? '+' : ''}${median(rs).toFixed(3)}R   (R eaten at entry)`);
  console.log(`  risk vs budget:  mean ${mean(rms).toFixed(3)}x   (1.00 = exactly intended 0.875%; >1 = over budget)`);
  console.log(`\n  interpretation: a +mean-slipR means each algo entry gives up that many R to`);
  console.log(`  entry slippage before the trade even starts; riskMult>1 means actual stop risk`);
  console.log(`  exceeds the sized budget by that factor.\n`);

  // Per-pair breakdown.
  const byPair = new Map<string, typeof sigs>();
  for (const s of sigs) { const a = byPair.get(s.symbol) ?? []; a.push(s); byPair.set(s.symbol, a); }
  console.log(`── BY PAIR ──`);
  for (const [sym, arr] of byPair) {
    console.log(`  ${sym.padEnd(8)} n=${arr.length}  slip% mean ${mean(arr.map((x) => x.slipPct)).toFixed(3)}  slipR mean ${mean(arr.map((x) => x.slipR)).toFixed(3)}  riskMult ${mean(arr.map((x) => x.riskMult)).toFixed(2)}x`);
  }
  await closePg();
}

main().catch(async (e) => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
