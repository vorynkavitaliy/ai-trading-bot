/**
 * cbp-pagination-probe — test whether /coinbase-premium-index accepts start_time/end_time
 * to page beyond the 4500-row cap on the 1h interval. Read-only.
 */
import { cgGet } from '../../core/coinglass';

async function main() {
  // 1h first row was 1764813600. Ask for data ending just before that.
  const params: Record<string, any>[] = [
    { interval: '1h', limit: 10, end_time: 1764813600 },
    { interval: '1h', limit: 10, endTime: 1764813600 },
    { interval: '1h', limit: 10, end: 1764813600 },
  ];
  for (const p of params) {
    try {
      const r = await cgGet<any>('/coinbase-premium-index', p);
      const d: any = r.data;
      const arr = Array.isArray(d) ? d : null;
      if (arr && arr.length) {
        console.log(`params=${JSON.stringify(p)} -> rows=${arr.length} firstTime=${arr[0].time} lastTime=${arr[arr.length - 1].time}`);
      } else {
        console.log(`params=${JSON.stringify(p)} -> empty/non-array`);
      }
    } catch (e: any) {
      console.log(`params=${JSON.stringify(p)} ERROR: ${e?.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
