/**
 * entry-slippage-audit — measures live signal→fill slippage on real closed trades.
 *
 * The strategy anchors SL/TP to the DECISION price (≈ the 4H-boundary price the signal
 * was computed at). The market order fills seconds-to-minutes later at a moved price.
 * That gap inflates (or deflates) the realized stop distance — and thus realized risk%.
 *
 * Per trade (deduped by symbol+opened-second, one signal = N account rows):
 *   pDecision  = 1m candle OPEN at the 4H boundary ≤ opened_at  (decision-instant price)
 *   fill       = entry_price
 *   slip%      = (fill − pDecision)/pDecision, signed adverse by side
 *   inflation  = |sl − fill| / |sl − pDecision|   (>1 = risk inflated by adverse slip)
 *
 * Read-only. Run: npx tsx src/tools/diagnostics/entry-slippage-audit.ts [days=120]
 */
import { query, close as closePg } from '../../core/db';

const FOURH = 4 * 3600_000;

async function main() {
  const days = parseFloat(process.argv[2] ?? '120');
  const since = Date.now() - days * 86_400_000;
  const { rows } = await query<any>(
    `SELECT DISTINCT ON (symbol, date_trunc('second', opened_at))
            symbol, side, entry_price::float8 fill, sl::float8 sl,
            (EXTRACT(EPOCH FROM opened_at)*1000)::float8 opened, status, exit_reason
     FROM trades
     WHERE entry_price IS NOT NULL AND sl IS NOT NULL
       AND opened_at >= to_timestamp($1/1000.0)
     ORDER BY symbol, date_trunc('second', opened_at), id`, [since]);

  const recs: any[] = [];
  for (const t of rows) {
    const boundary = Math.floor(t.opened / FOURH) * FOURH;
    const c = await query<any>(
      `SELECT open::float8 o FROM candles WHERE symbol=$1 AND tf='1m' AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
      [t.symbol, boundary]);
    const pDec = c.rows[0]?.o;
    if (!pDec || !t.fill || !t.sl) continue;
    const short = String(t.side).toLowerCase().startsWith('s') && String(t.side).toLowerCase() !== 'long';
    const isShort = /sell|short/i.test(t.side);
    const slipPct = (t.fill - pDec) / pDec * 100;                       // +=fill above decision
    const adversePct = isShort ? -slipPct : slipPct;                     // + = worse for our side
    const intendedDist = Math.abs(t.sl - pDec);
    const actualDist = Math.abs(t.sl - t.fill);
    const inflation = intendedDist > 0 ? actualDist / intendedDist : NaN;
    recs.push({ symbol: t.symbol, side: t.side, opened: t.opened, pDec, fill: t.fill, slipPct, adversePct, inflation, exit: t.exit_reason });
  }

  recs.sort((a, b) => b.adversePct - a.adversePct);
  console.log(`\n=== entry-slippage audit · ${days}d · ${recs.length} signals (deduped) ===`);
  console.log('symbol      side  decision→fill  slip%   adverse%  riskInflation  exit');
  console.log('─'.repeat(82));
  for (const r of recs) {
    console.log(`${r.symbol.padEnd(10)} ${String(r.side).padEnd(5)} ${r.pDec.toFixed(5)}→${r.fill.toFixed(5)}  ${(r.slipPct>=0?'+':'')+r.slipPct.toFixed(2)}%  ${(r.adversePct>=0?'+':'')+r.adversePct.toFixed(2)}%   ${r.inflation.toFixed(2)}×          ${r.exit ?? ''}`);
  }
  if (recs.length) {
    const infl = recs.map(r => r.inflation).sort((a, b) => a - b);
    const adv = recs.map(r => r.adversePct).sort((a, b) => a - b);
    const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
    const advCount = recs.filter(r => r.adversePct > 0.3).length;
    const inflCount = recs.filter(r => r.inflation > 1.15).length;
    console.log('─'.repeat(82));
    console.log(`risk inflation:  median ${pct(infl,0.5).toFixed(2)}×  mean ${mean(infl).toFixed(2)}×  p90 ${pct(infl,0.9).toFixed(2)}×  max ${infl[infl.length-1].toFixed(2)}×`);
    console.log(`adverse slip:    median ${pct(adv,0.5).toFixed(2)}%  mean ${mean(adv).toFixed(2)}%  p90 ${pct(adv,0.9).toFixed(2)}%  max ${adv[adv.length-1].toFixed(2)}%`);
    console.log(`>0.3% adverse:   ${advCount}/${recs.length} (${(advCount/recs.length*100).toFixed(0)}%)   |   >1.15× risk-inflated: ${inflCount}/${recs.length} (${(inflCount/recs.length*100).toFixed(0)}%)`);
  }
  await closePg();
}
main().catch(e => { console.error(e); process.exit(1); });
