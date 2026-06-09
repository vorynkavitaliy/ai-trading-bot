/**
 * portfolio-pairs — run an arbitrary set of pairs (each with its WINNING standalone
 * config, single entry) as one book over a year, NO flatten (raw combined-risk). For
 * assembling the new two-sided-edge portfolio and checking whether correlated pairs'
 * daily-DD stacks past Hyro limits.
 * Run: npx tsx src/backtest/cli/portfolio-pairs.ts <risk> <days> PAIR1 PAIR2 ...
 *   e.g. npx tsx src/backtest/cli/portfolio-pairs.ts 1.25 365 BTCUSDT SOLUSDT ADAUSDT
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

function cfg(pair: string, risk: number): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'XRPUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'BNBUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'LINKUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'ETHUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    default: throw new Error(`no config for ${pair}`);
  }
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const risk = parseFloat(process.argv[2] ?? '1.25');
  const days = parseFloat(process.argv[3] ?? '365');
  // Each pair: "PAIR" (uses the global risk) or "PAIR:risk" (per-pair override).
  const riskMap: Record<string, number> = {};
  const pairs = process.argv.slice(4).map(s => {
    const [p, rstr] = s.toUpperCase().split(':');
    riskMap[p] = rstr ? parseFloat(rstr) : risk;
    return p;
  });
  if (!pairs.length) { console.error('usage: portfolio-pairs.ts <risk> <days> PAIR[:risk]...'); process.exit(1); }
  const startEquity = 200_000;
  const riskOf = (sym: string) => riskMap[sym] ?? risk;

  const FLAT = process.env.FLATTEN ? parseFloat(process.env.FLATTEN) : undefined;
  const CAP = process.env.CAP ? parseInt(process.env.CAP, 10) : pairs.length;
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({ symbol: p, strategy: cfg(p, riskOf(p)), priority: i }));
  const endTs = Date.now(), startTs = endTs - days * 24 * 3600_000;
  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(strats, {
    startEquity, slippagePct: 0.25, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs,
    maxParallelCap: CAP, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: FLAT,
  });
  if (FLAT != null) console.log(`  (flatten ARMED at ${FLAT}% · cap ${CAP})`);

  const stats = (t: ClosedTrade[]) => {
    let eq = startEquity, peak = eq, maxDD = 0, w = 0, l = 0, sumR = 0, usd = 0;
    for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
      const pnl = x.pnlR * (riskOf(x.symbol) / 100 * startEquity);
      eq += pnl; usd += pnl; if (eq > peak) peak = eq;
      const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
      sumR += x.pnlR; if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
    }
    const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, sumR, maxDD, ret: usd / startEquity * 100, usd };
  };
  const S = stats(r.trades);
  const dd = r.dailyDd;
  console.log(`\n══ ПОРТФЕЛЬ [${pairs.join(' + ')}] — 1 год (${days}d), риск ${risk}%, cap ${pairs.length}, NO flatten ══\n`);
  console.log(`  Доход:    ${(S.ret >= 0 ? '+' : '') + S.ret.toFixed(1)}%   ($${S.usd.toFixed(0)})`);
  console.log(`  PF ${S.pf.toFixed(2)} · WR ${S.wr.toFixed(0)}% · сделок ${S.n}`);
  console.log(`  MaxDD ${S.maxDD.toFixed(1)}% · худ.день ${dd.worstDailyDdPct}% · Hyro−5% ${dd.daysBreach5}/${dd.balDaysBreach5}  → ${dd.daysBreach5 === 0 && S.maxDD < 10 ? 'ВЫЖИВАЕТ ✅' : 'ПРОБОЙ ❌'}`);
  console.log(`\n  вклад по парам:`);
  for (const p of pairs) { const s = stats(r.trades.filter(x => x.symbol === p)); console.log(`    ${p.padEnd(9)} n=${String(s.n).padStart(3)} WR=${s.wr.toFixed(0)}% PF=${s.pf.toFixed(2)} доход +${s.ret.toFixed(1)}%`); }
  const sd = (x: string) => stats(r.trades.filter(t => String((t as any).side) === x));
  const L = sd('long'), Sh = sd('short');
  console.log(`\n  лонг:  n=${L.n} WR=${L.wr.toFixed(0)}% доход +${L.ret.toFixed(1)}%`);
  console.log(`  шорт:  n=${Sh.n} WR=${Sh.wr.toFixed(0)}% доход +${Sh.ret.toFixed(1)}%`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
