// Replay lost actionable signals from /tmp/auto-execute-history.jsonl
//
// For each entry where executed=false (cycle hit the spawn-path bug), re-run
// the VP-SMC strategy on the same 1H decision bar to recover entry/SL/TP1/TP2,
// then forward-simulate against actual 1m bars to determine outcome (SL, TP1,
// TP2, BE-tail, or still-open).
//
// Output: per-signal table with realized pnlR and aggregated portfolio P&L
// assuming each signal had landed at risk_pct of starting equity.

import { runBacktest } from '../../backtest/engine';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../../strategies/btc-vp-smc';
import { ClosedTrade } from '../../backtest/types';
import { close as closePg } from '../../core/db';
import { log } from '../../core/logger';
import * as fs from 'node:fs';

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT:  { maxStopAtrPct: 4.5 },
  SOLUSDT:  { maxStopAtrPct: 5.5 },
  XRPUSDT:  { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
  TONUSDT:  { maxStopAtrPct: 5.0 },
  DOGEUSDT: { maxStopAtrPct: 5.5 },
  APTUSDT:  { maxStopAtrPct: 5.0 },
  ARBUSDT:  { maxStopAtrPct: 5.0 },
  TAOUSDT:  { maxStopAtrPct: 5.0 },
  INJUSDT:  { maxStopAtrPct: 5.0 },
};

const SLIPPAGE_PCT = parseFloat(process.env.RP_SLIP ?? '0.25');
const RISK_PCT = 0.375;
const START_EQUITY = 50_000;

const COMMON = {
  startEquity: START_EQUITY,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: SLIPPAGE_PCT,
  riskPctBase: 0.6,
  leverage: 10,
  tp1SlMode: 'no_move' as const,
  bePlusBufferPct: 0.10,
};

interface FailedSignal {
  ts: string;
  symbol: string;
  side: string;
  rrTp2: number;
  cycleTs: number;
}

function parseHistory(path: string): FailedSignal[] {
  const out: FailedSignal[] = [];
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }
    const cycleTs = row.cycle?.ts;
    if (!cycleTs) continue;
    for (const rec of row.records ?? []) {
      if (rec.executed === false && rec.exitCode === 1) {
        out.push({
          ts: row.ts,
          symbol: rec.symbol,
          side: rec.side,
          rrTp2: rec.rrTp2,
          cycleTs,
        });
      }
    }
  }
  return out;
}

async function main() {
  const historyPath = process.env.HISTORY_PATH ?? '/tmp/auto-execute-history.jsonl';
  const sinceTs = process.env.SINCE_ISO ? Date.parse(process.env.SINCE_ISO) : Date.parse('2026-05-17T00:00:00Z');
  const allFailed = parseHistory(historyPath).filter(s => s.cycleTs >= sinceTs);

  console.log('==================================================================================');
  console.log(`LOST-SIGNAL REPLAY  —  slip ${SLIPPAGE_PCT}%, risk ${RISK_PCT}%`);
  console.log(`source: ${historyPath}`);
  console.log(`since:  ${new Date(sinceTs).toISOString()}`);
  console.log(`failed signals to replay: ${allFailed.length}`);
  console.log('==================================================================================\n');

  // For each lost signal, run a TINY single-pair backtest window that BRACKETS the signal hour.
  // We need ~300 hours of warmup before, and enough hours after to let the trade resolve.
  // We then locate the trade that opens at or near cycleTs and report its outcome.
  let combinedR = 0;
  let combinedUsd = 0;
  let wins = 0, losses = 0, opens = 0;

  console.log('  ts                  pair      side    rrTp2   entry     sl       tp1      tp2      exit-reason       R      $@0.375%');
  console.log('  ' + '─'.repeat(120));

  for (const sig of allFailed) {
    // 25 days lookback for warmup + funding + features stability + VP/PWL.
    // Then 7 days lookahead so even worst-case time-stop resolves.
    const windowStart = sig.cycleTs - 25 * 86_400_000;
    const windowEnd = Math.min(Date.now(), sig.cycleTs + 7 * 86_400_000);
    const params = { ...DEFAULT_BTC_VP_SMC, ...(PER_SYMBOL[sig.symbol] ?? {}) };
    const strategy = btcVpSmc(params);
    let result;
    try {
      result = await runBacktest(strategy, { symbol: sig.symbol, startTs: windowStart, endTs: windowEnd, ...COMMON });
    } catch (e: any) {
      console.log(`  ${sig.ts}  ${sig.symbol.padEnd(8)}  ${sig.side.padEnd(5)}   ${sig.rrTp2.toFixed(2).padStart(5)}  ERROR: ${e?.message ?? String(e)}`);
      continue;
    }
    // Find the trade whose entryTs is closest to the cycle hour (cycleTs may be at HH:00:34Z, entry at HH:00:00Z within the next minute).
    const target = sig.cycleTs;
    let best: ClosedTrade | null = null;
    let bestDelta = Infinity;
    for (const t of result.trades) {
      const dt = Math.abs(t.entryTs - target);
      if (dt < bestDelta && dt < 30 * 60_000) {  // within 30 min of cycle ts
        bestDelta = dt;
        best = t;
      }
    }

    if (!best) {
      // Signal didn't fire in the replay — possibly the strategy gating slightly shifted (data freshness etc.)
      console.log(`  ${sig.ts}  ${sig.symbol.padEnd(8)}  ${sig.side.padEnd(5)}   ${sig.rrTp2.toFixed(2).padStart(5)}  (signal did not fire in replay — bar feature drift?)`);
      continue;
    }

    const usd = best.pnlR * RISK_PCT / 100 * START_EQUITY;
    combinedR += best.pnlR;
    combinedUsd += usd;
    if (best.pnlR > 0) wins++; else if (best.pnlR < 0) losses++;
    const reasonShort = best.exitReason === 'tp1_then_sl_be' ? 'tp1→be' : best.exitReason;
    console.log(
      `  ${sig.ts}  ${sig.symbol.padEnd(8)}  ${sig.side.padEnd(5)}   ${sig.rrTp2.toFixed(2).padStart(5)}   ${best.entry.toFixed(4).padStart(8)}  ${best.sl.toFixed(4).padStart(7)}  ${best.tp1.toFixed(4).padStart(7)}  ${(best.tp2 ?? 0).toFixed(4).padStart(7)}  ${reasonShort.padEnd(15)}  ${best.pnlR.toFixed(2).padStart(5)}R  $${usd.toFixed(0).padStart(5)}`
    );
  }

  console.log('  ' + '─'.repeat(120));
  console.log(`\nrecovered signals: ${wins + losses + opens}/${allFailed.length}`);
  console.log(`  wins:   ${wins}`);
  console.log(`  losses: ${losses}`);
  console.log(`  totalR: ${combinedR.toFixed(2)}R`);
  console.log(`  P&L on $${START_EQUITY} equity at ${RISK_PCT}% risk:  $${combinedUsd.toFixed(2)}`);
  console.log(`  multiplied across 3 sub-accounts of similar size:    ~$${(combinedUsd * 3).toFixed(0)}`);

  await closePg();
}

main().catch(async (e) => {
  log.error('replay failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
