/**
 * add-pair-cg-backfill — research-only Coinglass backfill for NEW screen candidates.
 *
 * Pulls ONLY the 3 signals the two-sided WF screen actually fades on:
 *   funding_oi_weighted (per coin), ls_top_account + ls_top_position (per pair, Binance).
 * ~360d @ 4h. Additive INSERT ON CONFLICT DO NOTHING into the real cg_* tables (harmless:
 * live scan-decide only reads tier1Pairs() symbols). Does NOT touch the live coinglass-backfill
 * SYMBOLS list. Logs fetched/inserted counts per symbol (doubles as a data-availability probe).
 *
 * Run: npx tsx src/backtest/cli/add-pair-cg-backfill.ts            (default candidate set)
 *      npx tsx src/backtest/cli/add-pair-cg-backfill.ts AVAX SUI   (coins, USDT/Binance pair derived)
 */
import { cgGet } from '../../core/coinglass';
import { query, close as closePg } from '../../core/db';

const TF = '4h';
const HISTORY_LIMIT = 2160;       // 4h × 2160 = 360d (plan max, probed 2026-06-03)
const REF_EXCHANGE = 'Binance';
const PACE_MS = 220;

// Feasible candidates = liquid Bybit perps that HAVE 4H candles but lack CG data.
// (TIA/AAVE/UNI/POL excluded — no candles. AVAX/DOT/NEAR/SUI/OP have ~360-383d candles.)
const DEFAULT_COINS = ['AVAX', 'DOT', 'NEAR', 'SUI', 'OP'];

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function bulkInsert(table: string, cols: string[], rows: any[][]): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vals: string[] = [];
    const params: any[] = [];
    slice.forEach((row, idx) => {
      const base = idx * cols.length;
      vals.push('(' + cols.map((_, k) => `$${base + k + 1}`).join(', ') + ')');
      params.push(...row);
    });
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${vals.join(', ')} ON CONFLICT DO NOTHING`;
    const r = await query(sql, params);
    inserted += r.rowCount;
  }
  return inserted;
}

async function backfillCoin(coin: string) {
  const pair = `${coin}USDT`;
  const summary: Record<string, number> = {};

  // 1. funding oi-weighted (per coin)
  const fo = await cgGet<any[]>('/futures/funding-rate/oi-weight-history', { symbol: coin, interval: TF, limit: HISTORY_LIMIT });
  summary.fundOi = await bulkInsert('cg_funding_oi_weighted',
    ['symbol', 'ts', 'fr_open', 'fr_high', 'fr_low', 'fr_close'],
    (fo.data ?? []).map((d: any) => [coin, d.time, d.open, d.high, d.low, d.close]));
  summary.fundOiFetched = (fo.data ?? []).length;
  await delay(PACE_MS);

  // 2. top-account ratio (per pair, Binance)
  const ta = await cgGet<any[]>('/futures/top-long-short-account-ratio/history', { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT });
  summary.lsAcc = await bulkInsert('cg_ls_top_account',
    ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
    (ta.data ?? []).map((d: any) => [REF_EXCHANGE, pair, d.time, d.top_account_long_percent, d.top_account_short_percent, d.top_account_long_short_ratio]));
  summary.lsAccFetched = (ta.data ?? []).length;
  await delay(PACE_MS);

  // 3. top-position ratio (per pair, Binance)
  const tp = await cgGet<any[]>('/futures/top-long-short-position-ratio/history', { exchange: REF_EXCHANGE, symbol: pair, interval: TF, limit: HISTORY_LIMIT });
  summary.lsPos = await bulkInsert('cg_ls_top_position',
    ['exchange', 'pair', 'ts', 'long_pct', 'short_pct', 'ratio'],
    (tp.data ?? []).map((d: any) => [REF_EXCHANGE, pair, d.time, d.top_position_long_percent, d.top_position_short_percent, d.top_position_long_short_ratio]));
  summary.lsPosFetched = (tp.data ?? []).length;
  await delay(PACE_MS);

  const dayspan = (n: number) => Math.round(n * 4 / 24);
  console.log(`${pair.padEnd(10)} fundOi ${String(summary.fundOiFetched).padStart(4)}f/${String(summary.fundOi).padStart(4)}i (~${dayspan(summary.fundOiFetched)}d) · lsAcc ${String(summary.lsAccFetched).padStart(4)}f/${String(summary.lsAcc).padStart(4)}i · lsPos ${String(summary.lsPosFetched).padStart(4)}f/${String(summary.lsPos).padStart(4)}i`);
}

async function main() {
  const coins = process.argv.slice(2).length ? process.argv.slice(2).map(s => s.toUpperCase().replace(/USDT$/, '')) : DEFAULT_COINS;
  console.log(`\n=== add-pair CG backfill (3 screen signals, ~360d @4h) · coins: ${coins.join(' ')} ===`);
  console.log('pair       | fundOi fetched/inserted (days) · lsAcc f/i · lsPos f/i');
  console.log('─'.repeat(90));
  for (const coin of coins) {
    try { await backfillCoin(coin); }
    catch (e: any) { console.log(`${coin}USDT — ERROR: ${e?.message ?? String(e)}`); }
  }
  await closePg();
  console.log('\ndone.');
}

main().catch(e => { console.error(e); process.exit(1); });
