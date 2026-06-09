/**
 * open-mfe — for each OPEN trade, compute MFE/MAE from 1m candles since entry +
 * how close price got to TP and SL (in R). Full precision (no display rounding).
 * Read-only. Run: npx tsx src/tools/diagnostics/open-mfe.ts [SYMBOL]
 */
import { query, close as closePg } from '../../core/db';

async function main() {
  const filter = process.argv[2]?.toUpperCase();
  const now = Date.now();
  const { rows: trades } = await query<any>(
    `SELECT id, symbol, side, entry_price::float8 e, sl::float8 sl, tp1::float8 tp,
            (EXTRACT(EPOCH FROM opened_at)*1000)::float8 opened, account_key
     FROM trades WHERE status='open' ${filter ? 'AND symbol=$1' : ''}
     ORDER BY symbol, account_key`, filter ? [filter] : []);
  if (!trades.length) { console.log('no open trades'); await closePg(); return; }

  // dedupe by symbol (levels identical across accounts)
  const seen = new Set<string>();
  for (const t of trades) {
    if (seen.has(t.symbol)) continue;
    seen.add(t.symbol);
    const { rows: c } = await query<any>(
      `SELECT min(low)::float8 lo, max(high)::float8 hi,
              (SELECT close::float8 FROM candles WHERE symbol=$1 AND tf='1m' ORDER BY ts DESC LIMIT 1) cur
       FROM candles WHERE symbol=$1 AND tf='1m' AND ts >= $2`, [t.symbol, Math.floor(t.opened)]);
    const lo = c[0]?.lo, hi = c[0]?.hi, cur = c[0]?.cur;
    const short = String(t.side).toLowerCase().startsWith('s');
    const stopDist = Math.abs(t.e - t.sl);
    const R = (px: number) => (short ? (t.e - px) : (px - t.e)) / stopDist;  // +R = favorable
    // favorable extreme: short→lowest low, long→highest high
    const fav = short ? lo : hi, adv = short ? hi : lo;
    const tpGapPx = short ? (lo - t.tp) : (t.tp - hi);  // >0 = TP not reached yet, by this much
    console.log(`\n${t.symbol} ${t.side}  entry ${t.e.toFixed(5)}  TP ${t.tp.toFixed(5)}  SL ${t.sl.toFixed(5)}  (stopDist ${stopDist.toFixed(5)} = 1R)`);
    console.log(`  opened ${new Date(t.opened).toISOString()}  (${((now - t.opened) / 3600_000).toFixed(1)}h ago)`);
    console.log(`  since-entry 1m range: low ${lo?.toFixed(5)}  high ${hi?.toFixed(5)}  current ${cur?.toFixed(5)}`);
    console.log(`  MFE (best favorable):  ${fav?.toFixed(5)}  = ${R(fav).toFixed(2)}R   ← closest to TP`);
    console.log(`  MAE (worst adverse):   ${adv?.toFixed(5)}  = ${R(adv).toFixed(2)}R   ← closest to SL`);
    console.log(`  current:               ${cur?.toFixed(5)}  = ${R(cur).toFixed(2)}R`);
    if (tpGapPx > 0) console.log(`  >> TP NOT touched — missed by ${tpGapPx.toFixed(5)} (${(tpGapPx / stopDist).toFixed(2)}R short of TP at deepest)`);
    else console.log(`  >> TP price WAS reached/breached (low ${lo?.toFixed(5)} ≤ TP ${t.tp.toFixed(5)}) — fill should have triggered!`);
  }
  await closePg();
}
main().catch(e => { console.error(e); process.exit(1); });
