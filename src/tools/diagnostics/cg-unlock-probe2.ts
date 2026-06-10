/**
 * cg-unlock-probe2 — probe the verified Coinglass v4 unlock paths:
 *   /coin/unlock-list  and  /coin/vesting
 * Read-only. Dumps shape + full first-row + history depth hints.
 */
import { cgGet } from '../../core/coinglass';

const T = 20_000;
function withTimeout<T2>(p: Promise<T2>, ms: number, label: string): Promise<T2> {
  return Promise.race([p, new Promise<T2>((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms (${label})`)), ms))]);
}

function dump(tag: string, data: any) {
  console.log(`\n--- ${tag} ---`);
  if (data == null) { console.log('null'); return; }
  if (Array.isArray(data)) {
    console.log(`array len=${data.length}`);
    if (data[0]) console.log(`first=${JSON.stringify(data[0])}`);
    if (data[1]) console.log(`second=${JSON.stringify(data[1])}`);
    if (data.length > 2) console.log(`last=${JSON.stringify(data[data.length - 1])}`);
    return;
  }
  if (typeof data === 'object') {
    console.log(`obj keys=${JSON.stringify(Object.keys(data))}`);
    for (const k of Object.keys(data)) {
      const v = (data as any)[k];
      if (Array.isArray(v)) {
        console.log(`  ${k}: array len=${v.length}  first=${JSON.stringify(v[0]).slice(0, 400)}`);
      } else {
        console.log(`  ${k}: ${JSON.stringify(v).slice(0, 300)}`);
      }
    }
    return;
  }
  console.log(`scalar ${String(data)}`);
}

async function tryCall(name: string, path: string, params: Record<string, string | number>) {
  try {
    const r = await withTimeout(cgGet<any>(path, params), T, name);
    console.log(`OK   ${name}  [${path}] params=${JSON.stringify(params)} code=${(r as any).code}`);
    dump(name, (r as any).data);
    return (r as any).data;
  } catch (e: any) {
    console.log(`FAIL ${name}  [${path}] params=${JSON.stringify(params)}: ${(e?.message ?? String(e)).slice(0, 200)}`);
    return null;
  }
}

async function main() {
  console.log('=== Coinglass /coin/unlock-list + /coin/vesting probe ===');
  const list = await tryCall('unlock-list-p1', '/coin/unlock-list', { per_page: 100, page: 1 });
  await new Promise(r => setTimeout(r, 400));
  // Determine an example symbol from the list, then pull vesting for it.
  let sym = 'ARB';
  if (Array.isArray(list) && list[0]) {
    const row = list[0];
    sym = row.symbol || row.coin || row.coinSymbol || row.symbolName || sym;
  } else if (list && typeof list === 'object') {
    for (const k of ['list', 'data', 'data_list', 'dataList']) {
      const arr = (list as any)[k];
      if (Array.isArray(arr) && arr[0]) { sym = arr[0].symbol || arr[0].coin || sym; break; }
    }
  }
  await tryCall(`vesting-${sym}`, '/coin/vesting', { symbol: sym });
  await new Promise(r => setTimeout(r, 400));
  await tryCall('vesting-ARB', '/coin/vesting', { symbol: 'ARB' });
  console.log('\n=== done ===');
}

main().catch(e => { console.error('crashed', e?.message ?? String(e)); process.exit(1); });
