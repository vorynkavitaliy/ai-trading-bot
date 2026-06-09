/**
 * coalescer-selftest — verifies the time-windowed Coalescer core that collapses
 * per-account daemon notifications into one message.
 *
 * Run: npx tsx src/tools/diagnostics/coalescer-selftest.ts
 * Exits 0 on pass, 1 on any failed assertion. No Telegram / DB / network.
 */

import { Coalescer } from '../../runtime/notification-coalescer';

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  // 1) N adds on the SAME key within the window → exactly ONE flush carrying all N items.
  {
    const flushes: number[][] = [];
    const c = new Coalescer<number>(80, async (_k, items) => { flushes.push(items); });
    c.add('ARBUSDT-Sell', 1);
    c.add('ARBUSDT-Sell', 2);
    c.add('ARBUSDT-Sell', 3);
    c.add('ARBUSDT-Sell', 4);
    await sleep(160);
    check('4 same-key adds → 1 flush', flushes.length === 1);
    check('flush carries all 4 items', flushes[0]?.length === 4);
    check('items preserved in order', JSON.stringify(flushes[0]) === '[1,2,3,4]');
  }

  // 2) Different keys → separate flushes (no cross-pair merge).
  {
    const flushes = new Map<string, number[]>();
    const c = new Coalescer<number>(80, async (k, items) => { flushes.set(k, items); });
    c.add('ARBUSDT-Sell', 1);
    c.add('SOLUSDT-Sell', 9);
    await sleep(160);
    check('2 keys → 2 distinct flushes', flushes.size === 2);
    check('ARB bucket isolated', JSON.stringify(flushes.get('ARBUSDT-Sell')) === '[1]');
    check('SOL bucket isolated', JSON.stringify(flushes.get('SOLUSDT-Sell')) === '[9]');
  }

  // 3) A second burst AFTER the first window flushed → a fresh, separate flush.
  {
    let flushCount = 0;
    const c = new Coalescer<number>(60, async () => { flushCount++; });
    c.add('BNBUSDT-Sell', 1);
    await sleep(120);
    c.add('BNBUSDT-Sell', 2);
    await sleep(120);
    check('two separated bursts → 2 flushes', flushCount === 2);
  }

  // 4) Throttle pattern (mirrors coalesceNakedSlAlert): once sent, repeats inside
  //    the throttle window are dropped before buffering.
  {
    const THROTTLE = 200;
    const lastSent = new Map<string, number>();
    let flushCount = 0;
    const c = new Coalescer<number>(40, async (k) => { lastSent.set(k, Date.now()); flushCount++; });
    const tryAdd = (k: string, v: number): boolean => {
      const last = lastSent.get(k) ?? 0;
      if (Date.now() - last < THROTTLE) return false;
      c.add(k, v);
      return true;
    };
    check('1st alert buffered', tryAdd('XRPUSDT-Sell', 1) === true);
    await sleep(80);                                  // flush fires, stamps lastSent
    check('repeat within throttle dropped', tryAdd('XRPUSDT-Sell', 2) === false);
    await sleep(80);
    check('still throttled', tryAdd('XRPUSDT-Sell', 3) === false);
    check('throttle window → exactly 1 flush', flushCount === 1);
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
