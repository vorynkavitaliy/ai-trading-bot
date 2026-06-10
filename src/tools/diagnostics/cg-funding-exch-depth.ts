/**
 * cg-funding-exch-depth — for each major exchange, fetch per-exchange funding-rate
 * history (/futures/funding-rate/history) for a symbol and report depth + earliest ts,
 * so we know how deep a cross-exchange dispersion series we can build for IS/OOS.
 *
 * Run: npx tsx src/tools/diagnostics/cg-funding-exch-depth.ts [BTCUSDT]
 */
import { cgGet } from '../../core/coinglass';

const PACE_MS = 300;
const sym = process.argv[2] ?? 'BTCUSDT';
const interval = '4h';
const limit = 4500; // ask for a lot; see what we get

const exchanges = ['Binance', 'OKX', 'Bybit', 'Bitget', 'Gate', 'HTX', 'Kraken', 'dYdX', 'Hyperliquid', 'KuCoin', 'MEXC', 'CoinEx', 'Bitmex'];

async function main() {
  console.log(`\n=== per-exchange funding history depth for ${sym} @ ${interval} ===\n`);
  for (const ex of exchanges) {
    try {
      const r = await cgGet<any[]>('/futures/funding-rate/history', { exchange: ex, symbol: sym, interval, limit });
      const data = (r as any).data ?? [];
      if (!Array.isArray(data) || data.length === 0) {
        console.log(`${ex.padEnd(12)} EMPTY`);
      } else {
        const first = data[0];
        const last = data[data.length - 1];
        const firstD = new Date(first.time).toISOString().slice(0, 10);
        const lastD = new Date(last.time).toISOString().slice(0, 10);
        console.log(`${ex.padEnd(12)} rows=${String(data.length).padStart(5)}  ${firstD} .. ${lastD}  sampleClose=${first.close}`);
      }
    } catch (e: any) {
      console.log(`${ex.padEnd(12)} ERR ${String(e?.message ?? e).slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}

main().catch(e => { console.error('crash', e?.message ?? e); process.exit(1); });
