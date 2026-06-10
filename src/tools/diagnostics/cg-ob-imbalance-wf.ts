/**
 * cg-ob-imbalance-wf — rolling 3-window WF on pooled depth-imbalance (imbPct) to
 * test stability of the OOS-positive IC. If positivity is concentrated in the most
 * recent window only, it's regime, not edge. Read-only.
 */
import { query, close } from '../../core/db';

const WINDOW = 180;
const HORIZONS = [3, 6, 12];
const HLABEL: Record<number, string> = { 3: '12h', 6: '24h', 12: '48h' };
const PAIRS: { pair: string; coin: string }[] = [
  { pair: 'BTCUSDT', coin: 'BTC' }, { pair: 'SOLUSDT', coin: 'SOL' }, { pair: 'ETHUSDT', coin: 'ETH' },
  { pair: 'XRPUSDT', coin: 'XRP' }, { pair: 'LTCUSDT', coin: 'LTC' }, { pair: 'ARBUSDT', coin: 'ARB' },
  { pair: 'INJUSDT', coin: 'INJ' }, { pair: 'ATOMUSDT', coin: 'ATOM' }, { pair: 'BNBUSDT', coin: 'BNB' },
  { pair: 'LINKUSDT', coin: 'LINK' }, { pair: 'ADAUSDT', coin: 'ADA' }, { pair: 'DOGEUSDT', coin: 'DOGE' },
  { pair: 'TAOUSDT', coin: 'TAO' },
];

function pearson(x: number[], y: number[]): number {
  const n = x.length; if (n < 3) return NaN;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i]*x[i]; syy += y[i]*y[i]; sxy += x[i]*y[i]; }
  const cov = sxy - sx*sy/n, vx = sxx - sx*sx/n, vy = syy - sy*sy/n;
  return (vx<=0||vy<=0)?NaN:cov/Math.sqrt(vx*vy);
}
function spearman(x: number[], y: number[]): number {
  const n = x.length; if (n < 10) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v,i)=>[v,i] as [number,number]).sort((p,q)=>p[0]-q[0]);
    const r = new Array(n).fill(0); let i=0;
    while(i<n){let j=i;while(j+1<n&&idx[j+1][0]===idx[i][0])j++;const avg=(i+j)/2+1;for(let k=i;k<=j;k++)r[idx[k][1]]=avg;i=j+1;}
    return r;
  };
  return pearson(rank(x), rank(y));
}
function rollPct(arr: number[], i: number, win: number): number {
  const lo = Math.max(0, i-win+1); const cur = arr[i]; let le=0,n=0;
  for(let k=lo;k<=i;k++){n++;if(arr[k]<=cur)le++;} return n>1?le/n:0.5;
}

interface R { ts: number; imbPct: number; fwd: Record<number, number|null>; }

async function loadPair(pair: string): Promise<R[]> {
  const ob = await query<any>(`SELECT ts, bids_usd::float8 b, asks_usd::float8 a FROM cg_orderbook_pair WHERE pair=$1 ORDER BY ts ASC`, [pair]);
  const cd = await query<any>(`SELECT ts, close::float8 c FROM candles WHERE symbol=$1 AND tf='240m' ORDER BY ts ASC`, [pair]);
  const cMap = new Map<number, number>(); for (const r of cd.rows) cMap.set(Number(r.ts), r.c);
  const base = ob.rows.map((r:any)=>({ts:Number(r.ts),b:r.b,a:r.a})).filter((r:any)=>cMap.has(r.ts));
  const imb = base.map((r:any)=>(r.b-r.a)/(r.b+r.a));
  const out: R[] = [];
  for (let i=0;i<base.length;i++){
    const ts = base[i].ts, c0 = cMap.get(ts)!; const fwd: Record<number,number|null> = {};
    for (const h of HORIZONS){ const cf = cMap.get(ts+h*4*3600*1000); fwd[h] = cf!=null?(cf-c0)/c0:null; }
    out.push({ ts, imbPct: rollPct(imb,i,WINDOW), fwd });
  }
  return out;
}

async function main() {
  let all: R[] = [];
  for (const { pair } of PAIRS) { try { all = all.concat(await loadPair(pair)); } catch {} }
  all.sort((a,b)=>a.ts-b.ts);
  const n = all.length;
  const w = Math.floor(n/3);
  const wins = [all.slice(0,w), all.slice(w,2*w), all.slice(2*w)];
  console.log('=== ROLLING 3-WINDOW WF (pooled imbPct depth-imbalance) ===');
  console.log(`pooled n=${n}, per-window ~${w}\n`);
  wins.forEach((win, wi) => {
    const t0 = new Date(win[0].ts).toISOString().slice(0,10);
    const t1 = new Date(win[win.length-1].ts).toISOString().slice(0,10);
    const line = HORIZONS.map(h=>{
      const s:number[]=[],f:number[]=[];
      for(const r of win){const fv=r.fwd[h];if(fv!=null&&Number.isFinite(r.imbPct)){s.push(r.imbPct);f.push(fv);}}
      return s.length>=30?`${HLABEL[h]} IC=${spearman(s,f).toFixed(4)} (n=${s.length})`:`${HLABEL[h]} NA`;
    }).join('  ');
    console.log(`W${wi+1} ${t0}..${t1}: ${line}`);
  });
  await close();
}
main().catch(e=>{console.error('crashed',e?.message??String(e));process.exit(1);});
