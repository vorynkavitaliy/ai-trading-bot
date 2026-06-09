/**
 * btc-one-year — PURE BITCOIN, 1 year, the winning standalone strategy. Month-by-month.
 *   Strategy: ls_top_position fade, 0.85/0.15, BTC-trend filter, SL 2.0×ATR, TP 2.0×ATR,
 *             single entry (NO DCA), hold 48h. Risk 1.25%/trade (arg1), 365d (arg2).
 * Run: npx tsx src/backtest/cli/btc-one-year.ts [risk=1.25] [days=365]
 */
import { runPortfolioBacktest, PortfolioSymbolStrategy } from '../engine-portfolio';
import { resetCgFadeCooldownState, lsTopPositionFade, fundingFade } from '../../strategies/cg-fade';
import { Strategy } from '../types';
import { ClosedTrade } from '../types';
import { close as closePg } from '../../core/db';

// Per-pair winning standalone config (from pair-strategy-search): BTC → ls_top_position
// fade + wide stop; ETH → funding fade + wide thresholds + tight stop.
function winningStrat(pair: string, risk: number): { strat: Strategy; desc: string } {
  // Per-pair winning standalone config (from pair-strategy-search, both-halves robust):
  if (pair === 'ETHUSDT') return { strat: fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'funding fade .70/.30 · both trends · SL 1.5×ATR · 1 вход · хват 48ч' };
  if (pair === 'SOLUSDT') return { strat: fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'funding fade .70/.30 · both trends · SL 2.0×ATR · 1 вход · хват 48ч' };
  if (pair === 'BNBUSDT') return { strat: fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'funding fade .70/.30 · both trends · SL 1.5×ATR · 1 вход · хват 48ч' };
  if (pair === 'XRPUSDT') return { strat: fundingFade({ pctHi: .70, pctLo: .30, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'funding fade .70/.30 · both trends · SL 1.5×ATR · 1 вход · хват 48ч' };
  if (pair === 'LINKUSDT') return { strat: fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'funding fade .75/.25 · both trends · SL 1.5×ATR · 1 вход · хват 48ч' };
  if (pair === 'ADAUSDT') return { strat: fundingFade({ pctHi: .75, pctLo: .25, slAtrMult: 1.5, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'funding fade .75/.25 · both trends · SL 1.5×ATR · 1 вход · хват 48ч' };
  return { strat: lsTopPositionFade({ pctHi: .85, pctLo: .15, usePairTrend: false, useBtcTrend: true, slAtrMult: 2.0, tpAtrMult: 2.0, maxHoldBars: 12, riskPct: risk }), desc: 'ls_top_position fade .85/.15 · BTC trend · SL 2.0×ATR · 1 вход · хват 48ч' };
}

async function main() {
  process.env.DECISION_CADENCE = '240m';
  delete process.env.ANCHOR_4H;
  const PAIR = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
  const RISK = parseFloat(process.argv[3] ?? '1.25');
  const days = parseFloat(process.argv[4] ?? '365');
  const startEquity = 200_000;
  const fixedRiskUsd = startEquity * (RISK / 100);
  const endTs = Date.now(), startTs = endTs - days * 24 * 3600_000;

  const { strat, desc } = winningStrat(PAIR, RISK);
  const pairs: PortfolioSymbolStrategy[] = [{ symbol: PAIR, strategy: strat, priority: 0 }];
  resetCgFadeCooldownState();
  const r = await runPortfolioBacktest(pairs, {
    startEquity, slippagePct: 0.25, takerFeeRate: 0.00055, makerFeeRate: 0.0002, leverage: 10,
    decisionTf: '240m', tp1SlMode: 'no_move', bePlusBufferPct: 0.10, cronRealistic: true,
    startTs, endTs,
    maxParallelCap: 1, maxEntriesPerWindow: 99, entryCapWindowMs: 12 * 3600_000,
    cooldownOnCommit: true, intradayDdGuardPct: undefined, dailyDdFlattenPct: undefined,
  });

  const trades = [...r.trades].sort((a, b) => a.exitTs - b.exitTs);
  // Summary
  let eq = startEquity, peak = eq, maxDD = 0, wins = 0, losses = 0, sumR = 0;
  for (const t of trades) {
    eq += t.pnlR * fixedRiskUsd; if (eq > peak) peak = eq;
    const d = (peak - eq) / peak * 100; if (d > maxDD) maxDD = d;
    sumR += t.pnlR; if (t.pnlR > 0.05) wins++; else if (t.pnlR < -0.05) losses++;
  }
  const total = wins + losses;
  const winR = trades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const lossR = Math.abs(trades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const pf = lossR > 0 ? winR / lossR : 99;
  const ret = (eq - startEquity) / startEquity * 100;

  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(`  ЧИСТЫЙ ${PAIR} — 1 ГОД (${days}d)  ·  риск ${RISK}%/сделку  ·  старт $${startEquity.toLocaleString()}`);
  console.log(`  ${desc}`);
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`  Сделок:        ${trades.length}`);
  console.log(`  Win rate:      ${(wins / Math.max(1, total) * 100).toFixed(1)}%`);
  console.log(`  Profit Factor: ${pf.toFixed(2)}`);
  console.log(`  Доход за год:  ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%   ($${(eq - startEquity).toFixed(0)})`);
  console.log(`  Итог капитал:  $${eq.toFixed(0)}`);
  console.log(`  MaxDD:         ${maxDD.toFixed(1)}%`);
  console.log(`  Худший день:   ${r.dailyDd.worstDailyDdPct}% (MTM)  @ ${r.dailyDd.worstDay}`);
  console.log(`  Hyro −5% дней: ${r.dailyDd.daysBreach5} (MTM) / ${r.dailyDd.balDaysBreach5} (баланс)  → ${r.dailyDd.daysBreach5 === 0 && maxDD < 10 ? 'ВЫЖИВАЕТ' : 'ПРОБОЙ'}`);

  // Monthly
  const byMonth = new Map<string, { n: number; r: number }>();
  for (const t of trades) {
    const m = new Date(t.exitTs).toISOString().slice(0, 7);
    const e = byMonth.get(m) ?? { n: 0, r: 0 }; e.n++; e.r += t.pnlR; byMonth.set(m, e);
  }
  console.log(`\n  месяц     сделок    P&L$       нараст.$     нараст.%`);
  console.log(`  ─────────────────────────────────────────────────────`);
  let cum = 0;
  for (const [m, e] of [...byMonth.entries()].sort()) {
    const pnl = e.r * fixedRiskUsd; cum += pnl;
    console.log(`  ${m}   ${String(e.n).padStart(4)}    ${(pnl >= 0 ? '+' : '') + pnl.toFixed(0).padStart(7)}    ${(cum >= 0 ? '+' : '') + cum.toFixed(0).padStart(8)}    ${(cum / startEquity * 100 >= 0 ? '+' : '') + (cum / startEquity * 100).toFixed(1)}%`);
  }
  // By side (long vs short)
  const bySide = new Map<string, { n: number; r: number; wins: number; losses: number }>();
  for (const t of trades) {
    const side = String((t as any).side ?? 'unknown');
    const e = bySide.get(side) ?? { n: 0, r: 0, wins: 0, losses: 0 };
    e.n++; e.r += t.pnlR;
    if (t.pnlR > 0.05) e.wins++; else if (t.pnlR < -0.05) e.losses++;
    bySide.set(side, e);
  }
  console.log(`\n  сторона   сделок   WR      sumR     P&L$`);
  console.log(`  ──────────────────────────────────────────────`);
  for (const [side, e] of bySide) {
    const tot = e.wins + e.losses;
    console.log(`  ${side.padEnd(8)}  ${String(e.n).padStart(4)}   ${(e.wins / Math.max(1, tot) * 100).toFixed(0).padStart(3)}%  ${e.r.toFixed(1).padStart(7)}   ${(e.r * fixedRiskUsd >= 0 ? '+' : '') + (e.r * fixedRiskUsd).toFixed(0)}`);
  }
  // Detail: trades that exited in the last 12 days (the June cluster — check for end-of-window artifacts)
  const cutoff = endTs - 12 * 24 * 3600_000;
  console.log(`\n  ПОСЛЕДНИЕ СДЕЛКИ (выход за 12 дней) — entry→exit · сторона · причина · pnlR · $`);
  console.log(`  ────────────────────────────────────────────────────────────────────────`);
  for (const t of trades.filter(t => t.exitTs >= cutoff)) {
    const en = new Date((t as any).entryTs ?? t.exitTs).toISOString().slice(5, 16).replace('T', ' ');
    const ex = new Date(t.exitTs).toISOString().slice(5, 16).replace('T', ' ');
    const side = String((t as any).side ?? '?');
    const reason = String((t as any).exitReason ?? (t as any).reason ?? '?');
    const ep = (t as any).entryPrice, xp = (t as any).exitPrice, sl = (t as any).sl;
    const px = ep != null ? `entry ${Number(ep).toFixed(0)} → exit ${xp != null ? Number(xp).toFixed(0) : '?'} (SL ${sl != null ? Number(sl).toFixed(0) : '?'})` : '';
    console.log(`  ${en} → ${ex}  ${side.padEnd(6)} ${reason.padEnd(10)} ${t.pnlR.toFixed(2).padStart(6)}R  ${px}`);
  }
  console.log(`══════════════════════════════════════════════════════════════════\n`);
  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
