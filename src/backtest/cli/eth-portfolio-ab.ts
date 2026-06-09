/**
 * eth-portfolio-ab — does adding ETH (S3 fundingFade .70/.30 sl2.5 tp3 no-trend, the
 * packaged-grid finalist) to the LIVE 4-pair book (BTC+SOL+ADA+LINK) help or hurt?
 * The binding constraint is correlated drawdown on ONE account, not single-pair edge —
 * ETH is highly correlated to BTC, so the question is whether its standalone +R survives
 * inside the book or just amplifies the correlated drawdown. 4-pair base vs 5-pair(+ETH),
 * full / older / recent, flatten armed (4.3), realistic slip.
 *
 * Run: npx tsx src/backtest/cli/eth-portfolio-ab.ts [days=340]
 *   SLIP (0.05), ETH_RISK (0.6), FLATTEN (4.3) env overridable.
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade, fundingTaConfluence } from '../../strategies/cg-fade';
import { Strategy, ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

const SLIP = parseFloat(process.env.SLIP ?? '0.05');
const ETH_RISK = parseFloat(process.env.ETH_RISK ?? '0.6');
const FLAT = process.env.FLATTEN ? parseFloat(process.env.FLATTEN) : 4.3;
const START_EQ = 200_000;

const BASE = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];
const RISK: Record<string, number> = { BTCUSDT: 1.25, SOLUSDT: 0.875, ADAUSDT: 0.875, LINKUSDT: 0.6, ETHUSDT: ETH_RISK };

function cfg(pair: string, risk: number): Strategy {
  switch (pair) {
    case 'BTCUSDT': return lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'SOLUSDT': return fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'ADAUSDT': return fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    case 'LINKUSDT': return fundingTaConfluence({ slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk });
    // ETH packaged-grid finalist: S3 fundingFade, wide stop, NO trend filter, single-entry.
    case 'ETHUSDT': return fundingFade({ pctHi: .70, pctLo: .30, usePairTrend: false, useBtcTrend: false, slAtrMult: 2.5, tpAtrMult: 3.0, maxHoldBars: 12, riskPct: risk });
    default: throw new Error(`no config for ${pair}`);
  }
}

function stats(t: ClosedTrade[]) {
  let eq = START_EQ, peak = eq, maxDD = 0, w = 0, l = 0, usd = 0;
  for (const x of [...t].sort((a, b) => a.exitTs - b.exitTs)) {
    const pnl = x.pnlR * (RISK[x.symbol] / 100 * START_EQ);
    eq += pnl; usd += pnl; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    if (x.pnlR > 0.05) w++; else if (x.pnlR < -0.05) l++;
  }
  const winR = t.filter(x => x.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(t.filter(x => x.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  return { n: t.length, wr: (w + l) ? w / (w + l) * 100 : 0, pf: lossR > 0 ? winR / lossR : 99, maxDD, ret: usd / START_EQ * 100 };
}

async function run(pairs: string[], startTs: number, endTs: number) {
  resetCgFadeCooldownState();
  const strats: PortfolioSymbolStrategy[] = pairs.map((p, i) => ({ symbol: p, strategy: cfg(p, RISK[p]), priority: i }));
  const r = await runPortfolioBacktest(strats, {
    startEquity: START_EQ, slippagePct: SLIP, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs,
    maxParallelCap: pairs.length, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: FLAT,
  });
  return { S: stats(r.trades), dd: r.dailyDd, trades: r.trades };
}

async function window(label: string, days: number, startTs: number, endTs: number) {
  const ann = (x: number) => (x >= 0 ? '+' : '') + (x * 365 / days).toFixed(0) + '%/г';
  console.log(`\n══ ${label} (${days}d) · slip ${SLIP}% · flatten ${FLAT} · ETH-risk ${ETH_RISK}% ══`);
  const base = await run(BASE, startTs, endTs);
  console.log(`  БАЗА 4-pair (BTC+SOL+ADA+LINK): доход ${(base.S.ret >= 0 ? '+' : '') + base.S.ret.toFixed(1)}% (${ann(base.S.ret)}) · PF ${base.S.pf.toFixed(2)} · MaxDD ${base.S.maxDD.toFixed(1)}% · худ.день ${base.dd.worstDailyDdPct}% · Hyro ${base.dd.daysBreach5}/${base.dd.balDaysBreach5} · n=${base.S.n}`);
  const res = await run([...BASE, 'ETHUSDT'], startTs, endTs);
  const dRet = res.S.ret - base.S.ret, dDD = res.S.maxDD - base.S.maxDD;
  const ok = dRet > 0 && dDD <= 1.0 && res.dd.daysBreach5 === 0;
  console.log(`  +ETH 5-pair:                   доход ${(res.S.ret >= 0 ? '+' : '') + res.S.ret.toFixed(1)}% (${ann(res.S.ret)}) · PF ${res.S.pf.toFixed(2)} · MaxDD ${res.S.maxDD.toFixed(1)}% · худ.день ${res.dd.worstDailyDdPct}% · Hyro ${res.dd.daysBreach5}/${res.dd.balDaysBreach5} · n=${res.S.n}`);
  const cs = stats(res.trades.filter(x => x.symbol === 'ETHUSDT'));
  const sd = (x: string) => stats(res.trades.filter(t => String((t as any).side) === x && t.symbol === 'ETHUSDT'));
  console.log(`      Δ доход ${(dRet >= 0 ? '+' : '') + dRet.toFixed(1)}pp · Δ MaxDD ${(dDD >= 0 ? '+' : '') + dDD.toFixed(1)}pp → ${ok ? 'ДОБАВЛЯТЬ ✅' : 'НЕ ДОБАВЛЯТЬ ❌'}  | ETH: n=${cs.n} PF=${cs.pf.toFixed(2)} (лонг +${sd('long').ret.toFixed(1)}% / шорт +${sd('short').ret.toFixed(1)}%)`);
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const days = parseFloat(process.argv[2] ?? '340');
  const now = Date.now();
  const D = days * 24 * 3600_000;
  await window('ПОЛНОЕ ОКНО', days, now - D, now);
  await window('СТАРАЯ ПОЛОВИНА', Math.round(days / 2), now - D, now - D / 2);
  await window('СВЕЖАЯ ПОЛОВИНА', Math.round(days / 2), now - D / 2, now);
  console.log(`\n  Heat-замечание: BTC1.25+SOL0.875+ADA0.875+LINK0.6+ETH${ETH_RISK} = ${(1.25 + 0.875 + 0.875 + 0.6 + ETH_RISK).toFixed(3)}% vs totalHeatCap 3.75% — добавление ETH требует поднять cap или урезать риск.`);
  console.log(`  Критерий ДОБАВЛЯТЬ: Δдоход > 0 И ΔMaxDD ≤ +1.0pp И 0 дней Hyro−5%.`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
