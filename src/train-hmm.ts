#!/usr/bin/env npx tsx
/**
 * Train 3-state Gaussian HMM on BTC 1H history and write params to
 * vault/state/hmm-params.json.
 *
 * Usage:
 *   npx tsx src/train-hmm.ts --symbol BTCUSDT --interval 60 --bars 8760 \
 *     --states 3 --out vault/state/hmm-params.json
 *
 * Defaults match the CLAUDE.md spec: BTCUSDT, 1H, 365 days (8760 bars).
 *
 * Bybit V5 kline endpoint returns max 1000 rows per call. We paginate by
 * walking `end` timestamps backward until we have `bars` rows.
 *
 * Runtime ~30-90s depending on network (9 API calls + EM on 8760 samples).
 */
import { AccountManager } from './core/account-manager';
import { BybitClient } from './core/bybit-client';
import { RegimeHmm, type FeatureVector } from './analysis/regime-hmm';
import type { KlineIntervalV3 } from 'bybit-api';

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        out[key] = val;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

/**
 * Fetch `totalBars` klines by paginating backward via `end` timestamp.
 * Returns candles in chronological order (oldest → newest).
 */
async function fetchHistory(
  bybit: BybitClient,
  symbol: string,
  interval: KlineIntervalV3,
  totalBars: number,
): Promise<Array<{ timestamp: number; close: number }>> {
  const pageSize = 1000;
  const allBars: Array<{ timestamp: number; close: number }> = [];
  let end = Date.now();
  const seen = new Set<number>();

  while (allBars.length < totalBars) {
    const page = await bybit.getKlinesPage(symbol, interval, end, pageSize);
    if (!page.length) break;

    const freshBefore = allBars.length;
    for (const b of page) {
      if (!seen.has(b.timestamp)) {
        seen.add(b.timestamp);
        allBars.push({ timestamp: b.timestamp, close: b.close });
      }
    }
    const freshAdded = allBars.length - freshBefore;
    if (freshAdded === 0) break;

    const oldestTs = page[0].timestamp;
    end = oldestTs - 1;

    await new Promise((r) => setTimeout(r, 150));

    if (page.length < pageSize) break;
    if (allBars.length >= totalBars + pageSize) break;
  }

  allBars.sort((a, b) => a.timestamp - b.timestamp);
  return allBars.slice(-totalBars);
}

async function main() {
  const argv = parseArgs();
  const symbol = (argv.symbol ?? 'BTCUSDT').toUpperCase();
  const interval = (argv.interval ?? '60') as KlineIntervalV3;
  const bars = Number(argv.bars ?? '8760');
  const states = Number(argv.states ?? '3');
  const out = argv.out ?? 'vault/state/hmm-params.json';

  if (states !== 3) {
    throw new Error(`Only 3-state HMM supported (got states=${states})`);
  }

  console.log(`[hmm-train] symbol=${symbol} interval=${interval} bars=${bars} out=${out}`);

  const mgr = new AccountManager();
  const bybit = new BybitClient(mgr);

  console.log('[hmm-train] fetching history…');
  const t0 = Date.now();
  const history = await fetchHistory(bybit, symbol, interval, bars);
  console.log(
    `[hmm-train] fetched ${history.length} bars in ${Math.round((Date.now() - t0) / 1000)}s ` +
      `(first: ${new Date(history[0].timestamp).toISOString()}, ` +
      `last: ${new Date(history[history.length - 1].timestamp).toISOString()})`,
  );

  if (history.length < 500) {
    throw new Error(`Need ≥500 bars, got ${history.length}`);
  }

  const closes = history.map((h) => h.close);
  const feats: FeatureVector[] = RegimeHmm.features(closes);
  console.log(`[hmm-train] computed ${feats.length} feature vectors (2-D)`);

  console.log('[hmm-train] fitting HMM via Baum-Welch…');
  const tFit = Date.now();
  const { params, iterations, finalLogLik } = RegimeHmm.train(feats, {
    symbol,
    interval: String(interval),
    maxIter: 100,
    tol: 1e-4,
  });
  console.log(
    `[hmm-train] EM converged in ${iterations} iterations (${Math.round((Date.now() - tFit) / 1000)}s), final log-likelihood = ${finalLogLik.toFixed(2)}`,
  );

  RegimeHmm.save(out, params);
  console.log(`[hmm-train] wrote params → ${out}`);

  // === Sanity report ===
  console.log('\n=== Emissions (sorted by return_mean) ===');
  const sortedIdx = [0, 1, 2].sort(
    (a, b) => params.emissions[a].return_mean - params.emissions[b].return_mean,
  );
  for (const i of sortedIdx) {
    const em = params.emissions[i];
    console.log(
      `  [${params.state_labels[i]}] idx=${i} ` +
        `return_mean=${em.return_mean.toFixed(6)} std=${em.return_std.toFixed(6)} | ` +
        `vol_mean=${em.vol_mean.toFixed(6)} std=${em.vol_std.toFixed(6)}`,
    );
  }

  console.log('\n=== Transition matrix (rows sum to 1) ===');
  for (let i = 0; i < 3; i++) {
    const row = params.transitions[i]
      .map((p) => p.toFixed(3))
      .join('  ');
    console.log(`  [${params.state_labels[i]}] → ${row}   (labels: ${params.state_labels.join(', ')})`);
  }

  console.log('\n=== Last 5 bars inference (sanity) ===');
  for (let k = 5; k >= 1; k--) {
    const sliced = closes.slice(0, closes.length - k + 1);
    try {
      const inf = RegimeHmm.infer(sliced, params);
      const ts = new Date(history[history.length - k].timestamp).toISOString();
      console.log(
        `  ${ts}  close=${sliced[sliced.length - 1].toFixed(2)}  ` +
          `state=${inf.state} conf=${inf.confidence.toFixed(2)} ` +
          `probs={bull:${inf.probs.bull.toFixed(2)}, range:${inf.probs.range.toFixed(2)}, bear:${inf.probs.bear.toFixed(2)}} ` +
          `transitioning=${inf.transitioning}`,
      );
    } catch (err: any) {
      console.log(`  (inference error: ${err.message})`);
    }
  }
}

main().catch((err) => {
  console.error('[hmm-train] FATAL:', err?.stack ?? err);
  process.exit(1);
});
