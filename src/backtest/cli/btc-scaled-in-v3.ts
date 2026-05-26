/**
 * V3: explore parameter combinations to LIFT WR significantly.
 *
 * Three knobs:
 *   - SPACING_ATR: distance between entries (0.3..0.75)
 *   - TP_ATR_MULT: TP distance from avg (1.0..2.0). Tighter TP → higher WR but smaller R per win.
 *   - MAX_HOLD: 48h vs 96h vs 144h. Longer hold → fewer timeouts → higher WR.
 *   - TP MODE: 'avg' (TP from avg entry) vs 'fixed' (TP at original first-entry+2ATR target).
 *
 * Goal: find config that pushes WR ≥ 65% while keeping sumR ≥ baseline.
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

type TpMode = 'avg' | 'fixed';

function simOne(t: Trade, bars1m: Bar[], spacingAtr: number, tpAtrMult: number, maxHoldMs: number, tpMode: TpMode) {
  const isLong = t.side === 'long';
  const direction = isLong ? -1 : +1;
  const atr = Math.abs(t.entry - t.sl) / SL_ATR_MULT;
  const slPrice = t.sl;
  const fixedTpPrice = isLong ? t.entry + tpAtrMult * atr : t.entry - tpAtrMult * atr;

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
  const qty1 = RISK_PER_SLOT / dist1;
  filled[0] = true;
  cumQty += qty1;
  cumNotional += qty1 * entryPrices[0];

  for (const b of cycleBars) {
    const avgEntry = cumNotional / cumQty;
    const tpPrice = tpMode === 'avg'
      ? (isLong ? avgEntry + tpAtrMult * atr : avgEntry - tpAtrMult * atr)
      : fixedTpPrice;

    if (isLong && b.low <= slPrice) {
      const pnlPerQty = slPrice - avgEntry;
      const totalRRisked = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'sl' as const, pnlR: (pnlPerQty * cumQty) / totalRRisked, entriesFilled: filled.filter(x => x).length };
    }
    if (!isLong && b.high >= slPrice) {
      const pnlPerQty = avgEntry - slPrice;
      const totalRRisked = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'sl' as const, pnlR: (pnlPerQty * cumQty) / totalRRisked, entriesFilled: filled.filter(x => x).length };
    }
    if (isLong && b.high >= tpPrice) {
      const pnlPerQty = tpPrice - avgEntry;
      const totalRRisked = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'tp' as const, pnlR: (pnlPerQty * cumQty) / totalRRisked, entriesFilled: filled.filter(x => x).length };
    }
    if (!isLong && b.low <= tpPrice) {
      const pnlPerQty = avgEntry - tpPrice;
      const totalRRisked = RISK_PER_SLOT * filled.filter(x => x).length;
      return { result: 'tp' as const, pnlR: (pnlPerQty * cumQty) / totalRRisked, entriesFilled: filled.filter(x => x).length };
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
  const pnlPerQty = isLong ? (lastBar.close - avgEntry) : (avgEntry - lastBar.close);
  const totalRRisked = RISK_PER_SLOT * filled.filter(x => x).length;
  return { result: 'timeout' as const, pnlR: (pnlPerQty * cumQty) / totalRRisked, entriesFilled: filled.filter(x => x).length };
}

async function main() {
  const raw = JSON.parse(readFileSync('/tmp/btc-trades.json', 'utf8'));
  const trades: Trade[] = raw.trades;
  const firstTs = trades.reduce((m, t) => Math.min(m, t.entryTs), Infinity) - 24 * 3600_000;
  const lastTs = trades.reduce((m, t) => Math.max(m, t.entryTs), 0) + 7 * 24 * 3600_000;
  console.log(`Loading 1m bars…`);
  const bars1m = await loadBars('BTCUSDT', '1m', { fromTs: firstTs, toTs: lastTs });
  console.log(`Loaded ${bars1m.length} 1m bars\n`);

  console.log('BASELINE S1:  n=107  WR=57.0%  sumR=31.15  PF=1.63\n');

  const configs = [
    // Tight-TP sweep targeting WR ≥ 75% (operator goal)
    { sp: 0.6, tp: 0.8, hold: 48, mode: 'avg' as TpMode, label: 'sp0.6 TP0.8 avg 48h' },
    { sp: 0.6, tp: 0.7, hold: 48, mode: 'avg' as TpMode, label: 'sp0.6 TP0.7 avg 48h' },
    { sp: 0.6, tp: 0.6, hold: 48, mode: 'avg' as TpMode, label: 'sp0.6 TP0.6 avg 48h' },
    { sp: 0.6, tp: 0.5, hold: 48, mode: 'avg' as TpMode, label: 'sp0.6 TP0.5 avg 48h' },
    { sp: 0.6, tp: 0.4, hold: 48, mode: 'avg' as TpMode, label: 'sp0.6 TP0.4 avg 48h' },
    // Other spacings
    { sp: 0.4, tp: 0.8, hold: 48, mode: 'avg' as TpMode, label: 'sp0.4 TP0.8 avg 48h' },
    { sp: 0.4, tp: 0.6, hold: 48, mode: 'avg' as TpMode, label: 'sp0.4 TP0.6 avg 48h' },
    { sp: 0.5, tp: 0.7, hold: 48, mode: 'avg' as TpMode, label: 'sp0.5 TP0.7 avg 48h' },
    { sp: 0.7, tp: 0.8, hold: 48, mode: 'avg' as TpMode, label: 'sp0.7 TP0.8 avg 48h' },
    // Longer max-hold variants of best candidates
    { sp: 0.6, tp: 0.8, hold: 96, mode: 'avg' as TpMode, label: 'sp0.6 TP0.8 avg 96h' },
    { sp: 0.6, tp: 0.6, hold: 96, mode: 'avg' as TpMode, label: 'sp0.6 TP0.6 avg 96h' },
  ];

  console.log('config'.padEnd(36) + ' |   n   WR%   sumR    PF    tp/sl/timeout   fills 1/2/3');
  for (const c of configs) {
    const sims = trades.map(t => simOne(t, bars1m, c.sp, c.tp, c.hold * 3600_000, c.mode));
    const valid = sims.filter(s => s.result !== 'no_data');
    const wins = valid.filter(s => s.pnlR > 0.05).length;
    const wr = valid.length ? wins / valid.length * 100 : 0;
    const sumR = valid.reduce((s, x) => s + x.pnlR, 0);
    const winR = valid.filter(s => s.pnlR > 0).reduce((s, x) => s + x.pnlR, 0);
    const lossR = Math.abs(valid.filter(s => s.pnlR < 0).reduce((s, x) => s + x.pnlR, 0));
    const pf = lossR > 0 ? winR / lossR : Infinity;
    const tp = valid.filter(s => s.result === 'tp').length;
    const sl = valid.filter(s => s.result === 'sl').length;
    const to = valid.filter(s => s.result === 'timeout').length;
    const f1 = valid.filter(s => s.entriesFilled === 1).length;
    const f2 = valid.filter(s => s.entriesFilled === 2).length;
    const f3 = valid.filter(s => s.entriesFilled === 3).length;

    console.log(
      c.label.padEnd(36) + ' | ' +
      String(valid.length).padStart(3) + '  ' +
      wr.toFixed(1).padStart(5) + '  ' +
      sumR.toFixed(2).padStart(6) + '  ' +
      pf.toFixed(2).padStart(5) + '   ' +
      `${tp}/${sl}/${to}`.padEnd(12) + '   ' +
      `${f1}/${f2}/${f3}`
    );
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
