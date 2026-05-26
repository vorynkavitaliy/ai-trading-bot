/**
 * Walk-forward validation for sp0.6 TP0.8 (operator's chosen config).
 *
 * Splits 107 baseline S1 BTC trades 50/50 by entryTs and applies the same
 * scaled-in simulation to TRAIN and TEST halves. If TEST WR and PF are close
 * to TRAIN (within reasonable variance, no collapse to baseline) → config is
 * not overfit.
 *
 * Pass criteria:
 *   - TEST WR ≥ 65% (close to TRAIN 73.8%)
 *   - TEST PF ≥ 1.5
 *   - TEST sumR positive (any positive sumR is acceptable)
 */
import { readFileSync } from 'node:fs';
import { close as closePg } from '../../core/db';
import { loadBars } from '../../data/candles';
import { Bar } from '../types';

interface Trade {
  entryTs: number;
  side: 'long' | 'short';
  entry: number;
  sl: number;
  pnlR: number;
  win: boolean;
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
  let cumQty = 0;
  let cumNotional = 0;
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

function describe(label: string, sims: any[]) {
  const valid = sims.filter(s => s.result !== 'no_data');
  const wins = valid.filter(s => s.pnlR > 0.05).length;
  const losses = valid.filter(s => s.pnlR < -0.05).length;
  const wr = valid.length ? wins / valid.length * 100 : 0;
  const sumR = valid.reduce((s, x) => s + x.pnlR, 0);
  const winR = valid.filter(s => s.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
  const lossR = Math.abs(valid.filter(s => s.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
  const pf = lossR > 0 ? winR / lossR : Infinity;
  const tp = valid.filter(s => s.result === 'tp').length;
  const sl = valid.filter(s => s.result === 'sl').length;
  const to = valid.filter(s => s.result === 'timeout').length;
  console.log(`${label}: n=${valid.length}  WR=${wr.toFixed(1)}%  sumR=${sumR.toFixed(2)}  avgR=${(sumR/valid.length).toFixed(3)}  PF=${pf.toFixed(2)}  exits tp/sl/to=${tp}/${sl}/${to}`);
  return { n: valid.length, wr, sumR, pf, tp, sl, to };
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades.json', 'utf8'));
  const trades: Trade[] = raw.trades;
  const sorted = [...trades].sort((a, b) => a.entryTs - b.entryTs);

  console.log(`Loading 1m bars…`);
  const firstTs = sorted[0].entryTs - 24 * 3600_000;
  const lastTs = sorted[sorted.length - 1].entryTs + 4 * 24 * 3600_000;
  const bars1m = await loadBars('BTCUSDT', '1m', { fromTs: firstTs, toTs: lastTs });
  console.log(`Loaded ${bars1m.length} 1m bars\n`);

  const mid = Math.floor(sorted.length / 2);
  const train = sorted.slice(0, mid);
  const test = sorted.slice(mid);
  console.log(`Split @ ${new Date(sorted[mid].entryTs).toISOString()} — TRAIN=${train.length}  TEST=${test.length}\n`);

  console.log('=== Baseline (S1 single entry, full 107) ===');
  console.log(`Baseline FULL: n=107 WR=57.0% sumR=31.15 PF=1.63\n`);

  // Baseline WR/PF on TRAIN and TEST splits
  const trainBaselineWR = train.filter(t => t.win).length / train.length * 100;
  const testBaselineWR = test.filter(t => t.win).length / test.length * 100;
  const trainBaselineSumR = train.reduce((s, t) => s + t.pnlR, 0);
  const testBaselineSumR = test.reduce((s, t) => s + t.pnlR, 0);
  const tWins = train.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const tLosses = Math.abs(train.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const trainBaselinePF = tLosses > 0 ? tWins / tLosses : Infinity;
  const testWins = test.filter(t => t.pnlR > 0).reduce((s, t) => s + t.pnlR, 0);
  const testLosses = Math.abs(test.filter(t => t.pnlR < 0).reduce((s, t) => s + t.pnlR, 0));
  const testBaselinePF = testLosses > 0 ? testWins / testLosses : Infinity;
  console.log(`Baseline TRAIN: n=${train.length} WR=${trainBaselineWR.toFixed(1)}% sumR=${trainBaselineSumR.toFixed(2)} PF=${trainBaselinePF.toFixed(2)}`);
  console.log(`Baseline TEST:  n=${test.length} WR=${testBaselineWR.toFixed(1)}% sumR=${testBaselineSumR.toFixed(2)} PF=${testBaselinePF.toFixed(2)}\n`);

  console.log('=== Scaled-in sp0.6 TP0.8 avg 48h ===');
  const sims_train = train.map(t => simOne(t, bars1m, 0.6, 0.8, 48 * 3600_000));
  const sims_test = test.map(t => simOne(t, bars1m, 0.6, 0.8, 48 * 3600_000));
  const tr = describe('TRAIN', sims_train);
  const te = describe('TEST ', sims_test);

  console.log(`\nDelta TRAIN→TEST:`);
  console.log(`  WR:   ${tr.wr.toFixed(1)} → ${te.wr.toFixed(1)}  (Δ ${(te.wr - tr.wr).toFixed(1)})`);
  console.log(`  PF:   ${tr.pf.toFixed(2)} → ${te.pf.toFixed(2)}  (Δ ${(te.pf - tr.pf).toFixed(2)})`);
  console.log(`  avgR: ${(tr.sumR/tr.n).toFixed(3)} → ${(te.sumR/te.n).toFixed(3)}`);
  console.log(`  Δ vs baseline TEST WR: ${(te.wr - testBaselineWR).toFixed(1)}pp`);
  console.log(`  Δ vs baseline TEST PF: ${(te.pf - testBaselinePF).toFixed(2)}`);

  const ok = te.wr >= 65 && te.pf >= 1.5 && te.sumR > 0;
  console.log(`\nValidation: ${ok ? '✓ PASS' : '✗ FAIL'}`);

  // Also test a few alternative configs for robustness
  console.log('\n=== Robustness across configs (TEST only) ===');
  for (const { sp, tp } of [{ sp: 0.5, tp: 0.8 }, { sp: 0.6, tp: 1.0 }, { sp: 0.7, tp: 0.8 }, { sp: 0.6, tp: 0.6 }]) {
    const sims = test.map(t => simOne(t, bars1m, sp, tp, 48 * 3600_000));
    describe(`TEST sp${sp} TP${tp}`, sims);
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
