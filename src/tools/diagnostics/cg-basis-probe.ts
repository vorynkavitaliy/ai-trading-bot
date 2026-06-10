/**
 * cg-basis-probe — read-only probe of Coinglass v4 /futures/basis/history.
 * Confirmed real path. Requires exchange + symbol + interval. Find the working
 * combination + inspect response shape + history depth.
 */
import { cgGet } from '../../core/coinglass';

const PER_CALL_TIMEOUT_MS = 15_000;
const PACE_MS = 400;

interface Probe {
  name: string;
  path: string;
  params: Record<string, string | number>;
}

const probes: Probe[] = [
  // vary exchange (symbol=BTC). Binance gave 500 — maybe basis is per non-perp exchange.
  { name: 'OKX-BTC', path: '/futures/basis/history', params: { exchange: 'OKX', symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'Bybit-BTC', path: '/futures/basis/history', params: { exchange: 'Bybit', symbol: 'BTC', interval: '4h', limit: 10 } },
  { name: 'Binance-BTC-pair-style', path: '/futures/basis/history', params: { exchange: 'Binance', symbol: 'BTCUSDT', interval: '4h', limit: 10 } },
  { name: 'Binance-BTC-1d', path: '/futures/basis/history', params: { exchange: 'Binance', symbol: 'BTC', interval: '1d', limit: 10 } },
  { name: 'Binance-BTC-noInterval', path: '/futures/basis/history', params: { exchange: 'Binance', symbol: 'BTC', limit: 10 } },
  { name: 'Deribit-BTC', path: '/futures/basis/history', params: { exchange: 'Deribit', symbol: 'BTC', interval: '4h', limit: 10 } },
];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms)),
  ]);
}

function describe(data: any): string {
  if (data == null) return 'null';
  if (Array.isArray(data)) {
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first) : typeof first;
    return `array len=${data.length} firstKeys=${JSON.stringify(keys)} sample=${JSON.stringify(first).slice(0, 400)}`;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    let extra = '';
    for (const k of keys) {
      const v = (data as any)[k];
      if (Array.isArray(v)) extra += ` ${k}[len=${v.length}, sample=${JSON.stringify(v.slice(0, 2))}]`;
    }
    return `object keys=${JSON.stringify(keys)}${extra}`.slice(0, 700);
  }
  return String(data);
}

async function main() {
  console.log('=== Coinglass /futures/basis/history param-combo probe ===\n');
  for (const p of probes) {
    try {
      const r = await withTimeout(cgGet<any>(p.path, p.params), PER_CALL_TIMEOUT_MS, p.name);
      console.log(`OK   ${p.name}  params=${JSON.stringify(p.params)}`);
      console.log(`     code=${(r as any).code}  data=${describe((r as any).data)}\n`);
    } catch (e: any) {
      console.log(`FAIL ${p.name}  params=${JSON.stringify(p.params)}`);
      console.log(`     ${(e?.message ?? String(e)).slice(0, 240)}\n`);
    }
    await new Promise(r => setTimeout(r, PACE_MS));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
