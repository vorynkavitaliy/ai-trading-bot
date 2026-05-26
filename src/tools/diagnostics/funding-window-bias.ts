/**
 * Compute how many baseline backtest trades fall inside the live funding window
 * (±10 min from 00/08/16 UTC). Live risk-guard blocks these; engine does not.
 * Quantifies the systematic backtest overestimation.
 */
import { readFileSync } from 'node:fs';

const PAIRS = ['BTCUSDT', 'TAOUSDT', 'INJUSDT', 'ATOMUSDT', 'ARBUSDT', 'XRPUSDT', 'LTCUSDT'];
const FUNDING_WINDOW_MIN = 10;
const FUNDING_INTERVAL_MS = 8 * 3600_000;
const FW_MS = FUNDING_WINDOW_MIN * 60_000;

function inFundingWindow(ts: number): boolean {
  // Nearest funding boundary: round ts to multiples of 8h
  const remainder = ts % FUNDING_INTERVAL_MS;
  // Distance to next or previous boundary
  const distToNext = FUNDING_INTERVAL_MS - remainder;
  const distToPrev = remainder;
  const minDist = Math.min(distToNext, distToPrev);
  return minDist <= FW_MS;
}

async function main() {
  let totalTrades = 0;
  let blockedTrades = 0;
  let totalSumR = 0;
  let blockedSumR = 0;
  let okSumR = 0;

  const perPair: Array<{ pair: string; n: number; blocked: number; blockedPct: number; sumRblocked: number; sumRok: number; wrBlocked: number; wrOk: number }> = [];

  for (const pair of PAIRS) {
    const path = `/tmp/${pair}-trades.json`;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const trades = raw.trades as Array<{ entryTs: number; pnlR: number; win: boolean }>;

    const blocked = trades.filter(t => inFundingWindow(t.entryTs));
    const ok = trades.filter(t => !inFundingWindow(t.entryTs));

    const sR_blocked = blocked.reduce((s, t) => s + t.pnlR, 0);
    const sR_ok = ok.reduce((s, t) => s + t.pnlR, 0);
    const wr_blocked = blocked.length ? blocked.filter(t => t.win).length / blocked.length * 100 : 0;
    const wr_ok = ok.length ? ok.filter(t => t.win).length / ok.length * 100 : 0;

    perPair.push({
      pair,
      n: trades.length,
      blocked: blocked.length,
      blockedPct: trades.length ? blocked.length / trades.length * 100 : 0,
      sumRblocked: sR_blocked,
      sumRok: sR_ok,
      wrBlocked: wr_blocked,
      wrOk: wr_ok,
    });
    totalTrades += trades.length;
    blockedTrades += blocked.length;
    totalSumR += sR_blocked + sR_ok;
    blockedSumR += sR_blocked;
    okSumR += sR_ok;
  }

  console.log('=== Funding-window bias on baseline backtest trades ===');
  console.log('Live risk-guard blocks entries when |ts - nearest_funding_boundary| ≤ 10min');
  console.log('Funding boundaries: 00:00, 08:00, 16:00 UTC');
  console.log('Engine does NOT apply this filter → backtest may overestimate trade frequency.\n');

  console.log('pair      |  n   blocked  blocked%  sumR_blocked  sumR_ok   WR_blocked  WR_ok');
  for (const p of perPair) {
    console.log(
      p.pair.padEnd(10) + '| ' +
      String(p.n).padStart(3) + '    ' +
      String(p.blocked).padStart(3) + '     ' +
      p.blockedPct.toFixed(1).padStart(5) + '%    ' +
      p.sumRblocked.toFixed(2).padStart(7) + '       ' +
      p.sumRok.toFixed(2).padStart(7) + '   ' +
      p.wrBlocked.toFixed(1).padStart(5) + '%      ' +
      p.wrOk.toFixed(1).padStart(5) + '%'
    );
  }

  console.log('\nTotal:');
  console.log(`  trades: ${totalTrades}`);
  console.log(`  blocked by funding window: ${blockedTrades} (${(blockedTrades / totalTrades * 100).toFixed(1)}%)`);
  console.log(`  sumR if all executed (backtest): ${totalSumR.toFixed(2)}`);
  console.log(`  sumR blocked: ${blockedSumR.toFixed(2)}`);
  console.log(`  sumR if blocked removed (honest expectation): ${okSumR.toFixed(2)} (${(okSumR/totalSumR*100).toFixed(1)}% of backtest)`);
}

main().catch(e => { console.error(e); process.exit(1); });
