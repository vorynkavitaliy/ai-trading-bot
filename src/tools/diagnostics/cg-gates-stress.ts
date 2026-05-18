// Variant A (gates-off) stress test @ 0.40% slip
import { close as closePg } from '../../core/db';
import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','LTCUSDT','ATOMUSDT','TONUSDT','DOGEUSDT','APTUSDT','ARBUSDT','TAOUSDT','INJUSDT'];

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT: { maxStopAtrPct: 4.5 }, SOLUSDT: { maxStopAtrPct: 5.5 }, XRPUSDT: { maxStopAtrPct: 5.5 },
  BNBUSDT: { maxStopAtrPct: 4.0 }, LTCUSDT: { maxStopAtrPct: 4.5 }, ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT: { maxStopAtrPct: 5.0 }, DOGEUSDT: { maxStopAtrPct: 5.5 }, APTUSDT: { maxStopAtrPct: 5.0 },
  ARBUSDT: { maxStopAtrPct: 5.0 }, TAOUSDT: { maxStopAtrPct: 5.0 }, INJUSDT: { maxStopAtrPct: 5.0 },
};

const COMMON = {
  startEquity: 50_000, takerFeeRate: 0.00055, makerFeeRate: 0.0002,
  slippagePct: 0.40, riskPctBase: 0.6, leverage: 10,    // <-- STRESS slip 0.40%
  tp1SlMode: 'no_move' as const, bePlusBufferPct: 0.10,
};

const COOLDOWN_HOURS = 12;
const MIN_RR_TP2 = 0.3;
const MAX_PARALLEL = 10;
const RISK_PCT = 0.375;
const GATES_OFF = { fundingExtremeAbs: 999, lsTopMaxLong: 999, lsTopMinShort: -999 };

async function main() {
  const now = Date.now();
  const startTs = now - 365 * 24 * 60 * 60_000;
  const endTs = now;

  const allTrades: ClosedTrade[] = [];
  for (const symbol of SYMBOLS) {
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[symbol] ?? {}), ...GATES_OFF };
    const strategy = btcVpSmc(params);
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    allTrades.push(...r.trades);
    process.stdout.write(`  ${symbol}: ${r.trades.length}\n`);
  }
  console.log(`\nSignals: ${allTrades.length}`);

  allTrades.sort((a, b) => a.entryTs - b.entryTs);
  const open: { symbol: string; exitTs: number }[] = [];
  const taken: { pnlR: number; entryTs: number; exitTs: number; portfolioPnl: number }[] = [];
  const lastSlByPair = new Map<string, number>();
  const cooldownMs = COOLDOWN_HOURS * 3_600_000;

  for (const t of allTrades) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].exitTs <= t.entryTs) open.splice(i, 1);
    if (MIN_RR_TP2 > 0 && t.tp2 !== undefined) {
      const sd = Math.abs(t.entry - t.sl);
      const tp2d = t.side === 'long' ? (t.tp2 - t.entry) : (t.entry - t.tp2);
      if (sd > 0 && tp2d / sd < MIN_RR_TP2) continue;
    }
    if (cooldownMs > 0) {
      const ls = lastSlByPair.get(t.symbol);
      if (ls !== undefined && t.entryTs - ls < cooldownMs) continue;
    }
    if (open.some(p => p.symbol === t.symbol)) continue;
    if (open.length >= MAX_PARALLEL) continue;
    taken.push({ pnlR: t.pnlR, entryTs: t.entryTs, exitTs: t.exitTs, portfolioPnl: 0 });
    open.push({ symbol: t.symbol, exitTs: t.exitTs });
    if (cooldownMs > 0 && t.pnlR < 0) lastSlByPair.set(t.symbol, t.exitTs);
  }

  type Ev = { ts: number; kind: 'entry' | 'exit'; trade: typeof taken[0] };
  const events: Ev[] = [];
  for (const tt of taken) { events.push({ ts: tt.entryTs, kind: 'entry', trade: tt }); events.push({ ts: tt.exitTs, kind: 'exit', trade: tt }); }
  events.sort((a, b) => a.ts - b.ts || (a.kind === 'exit' ? -1 : 1));

  let runEquity = COMMON.startEquity, peak = runEquity, maxDDpct = 0;
  for (const ev of events) {
    if (ev.kind === 'entry') ev.trade.portfolioPnl = ev.trade.pnlR * runEquity * (RISK_PCT / 100);
    else { runEquity += ev.trade.portfolioPnl; if (runEquity > peak) peak = runEquity; const dd = (peak - runEquity) / peak * 100; if (dd > maxDDpct) maxDDpct = dd; }
  }
  const wins = taken.filter(t => t.pnlR > 0);
  const sumR = taken.reduce((s, t) => s + t.pnlR, 0);
  const wr = taken.length > 0 ? wins.length / taken.length * 100 : 0;
  console.log(`\n=== STRESS @ 0.40% slip ===`);
  console.log(`taken=${taken.length}  WR=${wr.toFixed(1)}%  avgR=${(sumR/taken.length).toFixed(3)}  MaxDD=${maxDDpct.toFixed(2)}%  P&L=${((runEquity - COMMON.startEquity) / COMMON.startEquity * 100).toFixed(2)}%`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
