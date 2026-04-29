import { runBacktest } from '../engine';
import { formatMetrics } from '../metrics';
import { runWalkforward, formatWalkforward } from '../walkforward';
import { btcVpSmc, DEFAULT_BTC_VP_SMC, BtcVpSmcParams } from '../strategies/btc-vp-smc';
import { close as closePg } from '../../lib/db';
import { log } from '../../lib/logger';

const COMMON = {
  startEquity: 50_000,
  takerFeeRate: 0.00055,
  makerFeeRate: 0.0002,
  slippagePct: 0.05,
  riskPctBase: 0.6,
  leverage: 10,
};

// Alts have wider relative volatility than BTC ("bigger step"). Same skeleton,
// expanded maxStop and slightly looser FVG min so signals can fire on faster moves.
// Per-symbol overrides applied below if needed.
const ALT_PARAMS_DEFAULT: BtcVpSmcParams = {
  ...DEFAULT_BTC_VP_SMC,
  maxStopAtrPct: 5.5,
};

const PER_SYMBOL: Record<string, Partial<BtcVpSmcParams>> = {
  ETHUSDT: { maxStopAtrPct: 4.5 },
  SOLUSDT: { maxStopAtrPct: 5.5 },
  XRPUSDT: { maxStopAtrPct: 5.5 },
  AVAXUSDT: { maxStopAtrPct: 5.5 },
  BNBUSDT:  { maxStopAtrPct: 4.0 },  // lower vol than typical alt, more BTC-like beta
  LTCUSDT:  { maxStopAtrPct: 4.5 },
  LINKUSDT: { maxStopAtrPct: 5.0 },
  NEARUSDT: { maxStopAtrPct: 5.5 },
  ATOMUSDT: { maxStopAtrPct: 5.0 },
};

function paramsFor(symbol: string): BtcVpSmcParams {
  const override = PER_SYMBOL[symbol] ?? {};
  return { ...ALT_PARAMS_DEFAULT, ...override };
}

async function main() {
  const symbol = (process.argv[2] ?? '').toUpperCase();
  if (!symbol) {
    console.error('usage: alt-vp-smc.ts <SYMBOL> [days=85] [wf]');
    process.exit(1);
  }
  const days = parseInt(process.argv[3] ?? '85', 10);
  const wfFlag = process.argv[4] === 'wf';
  const now = Date.now();
  const startTs = now - days * 24 * 60 * 60_000;
  const endTs = now;
  const params = paramsFor(symbol);
  const strategy = btcVpSmc(params);
  console.log(`== ${strategy.name} ==`);
  console.log(`== ${symbol}, ${days}d, ${new Date(startTs).toISOString().slice(0,10)} → ${new Date(endTs).toISOString().slice(0,10)}, mode=${wfFlag ? 'walk-forward' : 'single'}, maxStop=${params.maxStopAtrPct}% ==\n`);

  if (wfFlag) {
    const report = await runWalkforward(strategy, {
      symbol, startTs, endTs, windowDays: 30, ...COMMON,
    });
    console.log(formatWalkforward(report));
  } else {
    const r = await runBacktest(strategy, { symbol, startTs, endTs, ...COMMON });
    console.log(formatMetrics(symbol, r.metrics));
    if (r.trades.length > 0) {
      console.log('\nall trades:');
      for (const t of r.trades) {
        console.log(`  ${new Date(t.entryTs).toISOString().slice(0,16)} ${t.side.toUpperCase().padEnd(5)} entry ${t.entry.toFixed(4)} → exit ${t.exit.toFixed(4)}  R:${t.pnlR.toFixed(2)}  (${t.exitReason})`);
      }
    } else {
      console.log('\nno trades fired.');
    }
  }
  await closePg();
}

main().catch(async (e) => {
  log.error('alt-vp-smc failed', { err: e?.message ?? String(e), stack: e?.stack });
  try { await closePg(); } catch {}
  process.exit(1);
});
