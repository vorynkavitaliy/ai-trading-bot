/**
 * Walk-forward scaled-in validation for any pair. Reads /tmp/<pair>-trades.json,
 * loads 1m bars for that pair, runs the standard scaled-in simulation, splits
 * 50/50 by entryTs and reports TRAIN/TEST metrics for the operator's chosen
 * config (sp0.6 TP0.8 avg 48h).
 */
import { readFileSync } from 'node:fs';
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { Bar } from '../types';

interface Trade {
  entryTs: number; exitTs: number;
  side: 'long' | 'short';
  entry: number; sl: number;
  pnlR: number; win: boolean;
}

const N_ENTRIES = 3;
const SL_ATR_MULT = 1.5;
const RISK_PER_SLOT = 1 / N_ENTRIES;

function simOne(t: Trade, bars1m: Bar[], spacingAtr: number, tpAtrMult: number, maxHoldMs: number) {
  const isLong = t.side === 'long';
  const direction = isLong ? -1 : +1;
  const atr = Math.abs(t.entry - t.sl) / SL_ATR_MULT;
  const slPrice = t.sl;

  const entryPrices: number[] = [];
  for (let i = 0; i < N_ENTRIES; i++) entryPrices.push(t.entry + direction * i * spacingAtr * atr);

  const startTs = t.entryTs;
  const endTs = startTs + maxHoldMs;
  const cycleBars = bars1m.filter(b => b.ts >= startTs && b.ts <= endTs);
  if (cycleBars.length === 0) return { result: 'no_data' as const, pnlR: 0, entriesFilled: 0 };

  const filled: boolean[] = new Array(N_ENTRIES).fill(false);
  let cumQty = 0, cumNotional = 0;
  const dist1 = Math.abs(entryPrices[0] - slPrice);
  filled[0] = true;
  cumQty += RISK_PER_SLOT / dist1;
  cumNotional += (RISK_PER_SLOT / dist1) * entryPrices[0];

  for (const b of cycleBars) {
    const avgEntry = cumNotional / cumQty;
    const tpPrice = isLong ? avgEntry + tpAtrMult * atr : avgEntry - tpAtrMult * atr;

    if (isLong && b.low <= slPrice) {
      const pnl = (slPrice - avgEntry) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'sl' as const, pnlR: pnl / totalR, entriesFilled: filled.filter(x => x).length };
    }
    if (!isLong && b.high >= slPrice) {
      const pnl = (avgEntry - slPrice) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'sl' as const, pnlR: pnl / totalR, entriesFilled: filled.filter(x => x).length };
    }
    if (isLong && b.high >= tpPrice) {
      const pnl = (tpPrice - avgEntry) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'tp' as const, pnlR: pnl / totalR, entriesFilled: filled.filter(x => x).length };
    }
    if (!isLong && b.low <= tpPrice) {
      const pnl = (avgEntry - tpPrice) * cumQty;
      const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'tp' as const, pnlR: pnl / totalR, entriesFilled: filled.filter(x => x).length };
    }

    for (let i = 1; i < N_ENTRIES; i++) {
      if (filled[i]) continue;
      const ep = entryPrices[i];
      const dist = Math.abs(ep - slPrice);
      if (dist <= 0) continue;
      const shouldFill = isLong ? (b.low <= ep) : (b.high >= ep);
      if (shouldFill) {
        const q = RISK_PER_SLOT / dist;
        filled[i] = true;
        cumQty += q;
        cumNotional += q * ep;
      }
    }
  }

  const lastBar = cycleBars[cycleBars.length - 1];
  const avgEntry = cumNotional / cumQty;
  const pnl = isLong ? (lastBar.close - avgEntry) * cumQty : (avgEntry - lastBar.close) * cumQty;
  const totalR = RISK_PER_SLOT * filled.filter(x => x).length;
  return { result: 'timeout' as const, pnlR: pnl / totalR, entriesFilled: filled.filter(x => x).length };
}

function aggMetrics(sims: any[], baselineTrades: Trade[]) {
  const valid = sims.filter(s => s.result !== 'no_data');
  const wins = valid.filter(s => s.pnlR > 0.05).length;
  const wr = valid.length ? wins / valid.length * 100 : 0;
  const sumR = valid.reduce((s, x) => s + x.pnlR, 0);
  const winR = valid.filter(s => s.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(valid.filter(s => s.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  const pf = lossR > 0 ? winR / lossR : Infinity;
  const baselineWR = baselineTrades.length ? baselineTrades.filter(t => t.win).length / baselineTrades.length * 100 : 0;
  const baselineSumR = baselineTrades.reduce((s, t) => s + t.pnlR, 0);
  const bWins = baselineTrades.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const bLosses = Math.abs(baselineTrades.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const basePF = bLosses > 0 ? bWins / bLosses : Infinity;
  return { n: valid.length, wr, sumR, pf, baselineWR, baselineSumR, basePF };
}

async function main() {
  const pair = process.argv[2];
  if (!pair) { console.error('usage: pair-scaled-in-walkforward.ts <PAIR>'); process.exit(1); }

  const raw = JSON.parse(readFileSync(`/tmp/${pair}-trades.json`, 'utf8'));
  const trades: Trade[] = raw.trades;
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);

  console.log(`\n========== ${pair} ==========`);
  console.log(`baseline: n=${trades.length}  WR=${raw.metrics.winRate}%  sumR=${raw.metrics.totalR}  PF=${raw.metrics.profitFactor}`);

  console.log(`Loading 1m bars…`);
  const firstTs = sorted[0].entryTs - 24 * 3600_000;
  const lastTs = sorted[sorted.length - 1].entryTs + 4 * 24 * 3600_000;
  const bars1m = await loadBars(pair, '1m', { fromTs: firstTs, toTs: lastTs });
  console.log(`Loaded ${bars1m.length} 1m bars`);

  const mid = Math.floor(sorted.length / 2);
  const train = sorted.slice(0, mid);
  const test = sorted.slice(mid);
  console.log(`Split @ ${new Date(sorted[mid].entryTs).toISOString()} — TRAIN=${train.length} TEST=${test.length}`);

  const SP = 0.6, TP = 0.8, HOLD = 48 * 3600_000;
  console.log(`\nScaled-in config: sp${SP} TP${TP} avg 48h`);

  // FULL (all 107 trades)
  const simsFull = sorted.map(t => simOne(t, bars1m, SP, TP, HOLD));
  const mFull = aggMetrics(simsFull, sorted);
  console.log(`FULL:  n=${mFull.n}  WR=${mFull.wr.toFixed(1)}%  sumR=${mFull.sumR.toFixed(2)}  PF=${mFull.pf.toFixed(2)}  | baseline WR=${mFull.baselineWR.toFixed(1)}% sumR=${mFull.baselineSumR.toFixed(2)} PF=${mFull.basePF.toFixed(2)}`);

  const simsTrain = train.map(t => simOne(t, bars1m, SP, TP, HOLD));
  const mTrain = aggMetrics(simsTrain, train);
  console.log(`TRAIN: n=${mTrain.n}  WR=${mTrain.wr.toFixed(1)}%  sumR=${mTrain.sumR.toFixed(2)}  PF=${mTrain.pf.toFixed(2)}  | baseline WR=${mTrain.baselineWR.toFixed(1)}% sumR=${mTrain.baselineSumR.toFixed(2)} PF=${mTrain.basePF.toFixed(2)}`);

  const simsTest = test.map(t => simOne(t, bars1m, SP, TP, HOLD));
  const mTest = aggMetrics(simsTest, test);
  console.log(`TEST:  n=${mTest.n}  WR=${mTest.wr.toFixed(1)}%  sumR=${mTest.sumR.toFixed(2)}  PF=${mTest.pf.toFixed(2)}  | baseline WR=${mTest.baselineWR.toFixed(1)}% sumR=${mTest.baselineSumR.toFixed(2)} PF=${mTest.basePF.toFixed(2)}`);

  // Verdict
  const deltaWR = mTest.wr - mTest.baselineWR;
  const deltaPF = mTest.pf - mTest.basePF;
  const deltaSumR = mTest.sumR - mTest.baselineSumR;
  console.log(`\nDELTA on TEST: ΔWR=${deltaWR.toFixed(1)}pp  ΔPF=${deltaPF.toFixed(2)}  ΔsumR=${deltaSumR.toFixed(2)}`);

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
