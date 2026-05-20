// Post-mortem на конкретных trades 2026-05-19 которые "потеряли структуру":
// BTC, ETH, SOL, TAO shorts вошли вечером 19-го, к утру 20-го стали невалидны.
//
// Для каждой сделки:
//   1. Загрузить 1H bars от entry до actual exit
//   2. На каждом 1H close: пересчитать VAH/VAL/PWL/PWH (как strategy)
//   3. Проверить разные exit-conditions:
//      A. price > VAH (для short) / price < VAL (для long) — structure invalidation
//      B. Reverse setup detected (full opposite VP-SMC entry triggers)
//      C. Distance to SL > 50%
//      D. Sustained 3 1H bars closed against direction
//   4. Найти earliest trigger и $$ saved vs actual close
//
// Question: какой criteria detect structure break раньше всего БЕЗ ложных triggers?

import { query, close as closePg } from '../../core/db';
import { buildVolumeProfile } from '../../strategies/btc-vp-smc';

const TRADES = [
  { symbol: 'BTCUSDT',  side: 'short' as const, entry: 76789.7, sl: 77509.13, entryTs: Date.parse('2026-05-19T10:01:00Z'), closedTs: Date.parse('2026-05-20T07:30:00Z'), closeEst: 77400 },
  { symbol: 'ETHUSDT',  side: 'short' as const, entry: 2113.41, sl: 2133.58, entryTs: Date.parse('2026-05-19T10:01:39Z'), closedTs: Date.parse('2026-05-20T06:53:00Z'), closeEst: 2132 },
  { symbol: 'SOLUSDT',  side: 'short' as const, entry: 84.64,   sl: 85.30,   entryTs: Date.parse('2026-05-19T11:00:56Z'), closedTs: Date.parse('2026-05-20T07:30:00Z'), closeEst: 84.95 },
  { symbol: 'TAOUSDT',  side: 'short' as const, entry: 257.43,  sl: 263.85,  entryTs: Date.parse('2026-05-19T19:00:00Z'), closedTs: Date.parse('2026-05-20T07:30:00Z'), closeEst: 261.10 },
];

interface BarRow { ts: number; open: number; high: number; low: number; close: number; volume: number }

async function loadBars(symbol: string, tf: string, fromTs: number, toTs: number): Promise<BarRow[]> {
  // load 30 days before fromTs (need 24h+touch lookback for VP)
  const r = await query<any>(
    `SELECT ts::text, open::text, high::text, low::text, close::text, volume::text
     FROM candles WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND ts <= $4
     ORDER BY ts`,
    [symbol, tf, fromTs - 30 * 86400_000, toTs]
  );
  return r.rows.map(row => ({
    ts: Number(row.ts), open: Number(row.open), high: Number(row.high),
    low: Number(row.low), close: Number(row.close), volume: Number(row.volume),
  }));
}

async function main() {
  for (const t of TRADES) {
    console.log(`\n========== ${t.symbol} ${t.side} ==========`);
    console.log(`Entry: ${t.entry} @ ${new Date(t.entryTs).toISOString().slice(11,16)}`);
    console.log(`SL:    ${t.sl} (distance: ${((Math.abs(t.entry - t.sl) / t.entry) * 100).toFixed(2)}%)`);
    console.log(`Actual close: ~${t.closeEst} @ ${new Date(t.closedTs).toISOString().slice(11,16)}`);
    const actualLossPct = ((t.closeEst - t.entry) / t.entry * (t.side === 'short' ? -1 : 1)) * 100;
    console.log(`Actual loss: ${actualLossPct.toFixed(2)}%`);

    const bars1h = await loadBars(t.symbol, '60m', t.entryTs, t.closedTs);
    const bars1w = await loadBars(t.symbol, '1W', t.entryTs - 30 * 86400_000, t.closedTs);
    if (bars1h.length === 0) { console.log('No bars'); continue; }

    // Find first bar at or after entry
    const startIdx = bars1h.findIndex(b => b.ts >= t.entryTs);
    if (startIdx < 0) { console.log('No bars after entry'); continue; }

    // Iterate hourly from entry forward
    const triggers: Record<string, { ts: number; bar: BarRow; price: number; lossPct: number } | null> = {
      'A_above_VAH (for short) / below_VAL (for long)': null,
      'B_reverse_setup': null,
      'C_50pct_to_SL': null,
      'D_3_bars_against': null,
    };

    let barsAgainst = 0;

    for (let i = startIdx; i < bars1h.length; i++) {
      const cur = bars1h[i];

      // Build VP from prior 24 1H bars (skip recent 6 for touch window)
      const vpStart = Math.max(0, i - 30);
      const vpEnd = i - 6;
      if (vpEnd <= vpStart + 12) continue;  // need data
      const vpBars = bars1h.slice(vpStart, vpEnd);
      const vp = buildVolumeProfile(vpBars, 24, 0.7);
      if (!vp) continue;

      // Get current PWH/PWL from most recent CLOSED 1W bar before cur.ts
      const lastWeek = bars1w.filter(b => b.ts < cur.ts).pop();
      if (!lastWeek) continue;
      const pwl = lastWeek.low;
      const pwh = lastWeek.high;

      const price = cur.close;
      const buffer = price * 0.001;  // 0.1% buffer

      // Hours since entry
      const hoursSinceEntry = (cur.ts - t.entryTs) / 3_600_000;
      if (hoursSinceEntry < 1) continue;  // skip first hour

      // A. Structure invalidation: short price > VAH, long price < VAL
      if (!triggers['A_above_VAH (for short) / below_VAL (for long)']) {
        const broken = (t.side === 'short' && price > vp.vah + buffer)
                    || (t.side === 'long' && price < vp.val - buffer);
        if (broken) {
          const lossPct = ((price - t.entry) / t.entry * (t.side === 'short' ? -1 : 1)) * 100;
          triggers['A_above_VAH (for short) / below_VAL (for long)'] = { ts: cur.ts, bar: cur, price, lossPct };
        }
      }

      // B. Reverse-setup (simplified — would need recent VAL touch + FVG check; just check price BELOW VAL → bull setup territory)
      // For SHORT: bull setup means VAL touched recently AND price > VAL (re-entry). Simplified: price > vp.poc (above POC)
      if (!triggers['B_reverse_setup']) {
        // Position-broken when price violates the opposite VA boundary
        const opp = (t.side === 'short' && price > vp.poc + buffer)
                 || (t.side === 'long' && price < vp.poc - buffer);
        if (opp && hoursSinceEntry >= 2) {
          const lossPct = ((price - t.entry) / t.entry * (t.side === 'short' ? -1 : 1)) * 100;
          triggers['B_reverse_setup'] = { ts: cur.ts, bar: cur, price, lossPct };
        }
      }

      // C. 50% to SL
      if (!triggers['C_50pct_to_SL']) {
        const stopDist = Math.abs(t.entry - t.sl);
        const curDrawdown = t.side === 'short' ? Math.max(0, price - t.entry) : Math.max(0, t.entry - price);
        if (curDrawdown / stopDist >= 0.5) {
          const lossPct = ((price - t.entry) / t.entry * (t.side === 'short' ? -1 : 1)) * 100;
          triggers['C_50pct_to_SL'] = { ts: cur.ts, bar: cur, price, lossPct };
        }
      }

      // D. 3 consecutive bars closing against
      const against = t.side === 'short' ? cur.close > cur.open : cur.close < cur.open;
      if (against) barsAgainst++; else barsAgainst = 0;
      if (!triggers['D_3_bars_against'] && barsAgainst >= 3) {
        const lossPct = ((price - t.entry) / t.entry * (t.side === 'short' ? -1 : 1)) * 100;
        triggers['D_3_bars_against'] = { ts: cur.ts, bar: cur, price, lossPct };
      }
    }

    console.log('\nTrigger analysis:');
    console.log('criterion                                          ts          price       hyp_loss%   saved_vs_actual');
    console.log('-----------------------------------------------------------------------------------------');
    for (const [name, trig] of Object.entries(triggers)) {
      if (!trig) {
        console.log(`${name.padEnd(50)} never fired`);
      } else {
        const saved = actualLossPct - trig.lossPct;
        console.log(`${name.padEnd(50)} ${new Date(trig.ts).toISOString().slice(11,16)}     ${trig.price.toFixed(4)}     ${trig.lossPct.toFixed(2)}%        ${saved.toFixed(2)}pp`);
      }
    }
  }

  await closePg();
}

main().catch(async e => { console.error(e); try { await closePg(); } catch {} process.exit(1); });
