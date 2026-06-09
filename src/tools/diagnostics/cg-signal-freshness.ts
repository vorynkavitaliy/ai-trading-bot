/**
 * cg-signal-freshness — is the Coinglass signal feed advancing, or frozen?
 *
 * Answers "BTC L/S Top Position percentile hasn't moved between cycles — is the
 * data stale or just a slow 30-day rank?" by dumping the latest rows (ts + value)
 * of cg_ls_top_position and cg_funding_oi_weighted for the live pairs, plus the
 * current percentile over the trailing 180-bar window (the strategy's window).
 *
 * Run: npx tsx src/tools/diagnostics/cg-signal-freshness.ts
 */
import { query, close as closePg } from '../../core/db';

const PAIRS = ['BTCUSDT', 'SOLUSDT', 'ADAUSDT', 'LINKUSDT'];
const WINDOW = 180;

function pctRank(hist: number[], cur: number): number {
  const below = hist.filter((v) => v < cur).length;
  return below / hist.length;
}

async function latestRows(table: string, keyCol: string, key: string, valCol: string, n: number) {
  const { rows } = await query<{ ts: string; v: string }>(
    `SELECT ts::text AS ts, ${valCol}::text AS v FROM ${table}
     WHERE ${keyCol} = $1 AND exchange = 'Binance' ORDER BY ts DESC LIMIT $2`,
    [key, n],
  );
  return rows.map((r) => ({ ts: Number(r.ts), v: parseFloat(r.v) }));
}

async function latestFunding(coin: string, n: number) {
  const { rows } = await query<{ ts: string; v: string }>(
    `SELECT ts::text AS ts, fr_close::text AS v FROM cg_funding_oi_weighted
     WHERE symbol = $1 ORDER BY ts DESC LIMIT $2`,
    [coin, n],
  );
  return rows.map((r) => ({ ts: Number(r.ts), v: parseFloat(r.v) }));
}

async function main(): Promise<void> {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);
  const ageH = (t: number) => ((now - t) / 3_600_000).toFixed(1);

  console.log(`now = ${new Date(now).toISOString()}\n`);

  for (const pair of PAIRS) {
    const coin = pair.replace(/USDT$/, '');
    const lsp = await latestRows('cg_ls_top_position', 'pair', pair, 'ratio', WINDOW);
    const fund = await latestFunding(coin, WINDOW);
    const lspLatest = lsp[0];
    const fundLatest = fund[0];
    const lspHist = lsp.map((r) => r.v).reverse();
    const fundHist = fund.map((r) => r.v).reverse();
    const lspPct = lspLatest ? pctRank(lspHist, lspLatest.v) : NaN;
    const fundPct = fundLatest ? pctRank(fundHist, fundLatest.v) : NaN;

    console.log(`━━ ${pair} ━━`);
    console.log(
      `  L/S TopPos : latest ${lspLatest ? iso(lspLatest.ts) : 'n/a'} (${lspLatest ? ageH(lspLatest.ts) : '?'}h ago)  ` +
        `val=${lspLatest?.v.toFixed(4)}  pct=${(lspPct * 100).toFixed(1)}%  rows=${lsp.length}`,
    );
    console.log(
      `  Funding    : latest ${fundLatest ? iso(fundLatest.ts) : 'n/a'} (${fundLatest ? ageH(fundLatest.ts) : '?'}h ago)  ` +
        `val=${fundLatest?.v.toFixed(6)}  pct=${(fundPct * 100).toFixed(1)}%  rows=${fund.length}`,
    );
    if (pair === 'BTCUSDT') {
      console.log('  last 14 L/S TopPos readings (newest first):');
      for (const r of lsp.slice(0, 14)) {
        console.log(`     ${iso(r.ts)}  (${ageH(r.ts)}h)  ratio=${r.v.toFixed(4)}`);
      }
    }
    console.log('');
  }
  await closePg();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await closePg();
  } catch {}
  process.exit(1);
});
