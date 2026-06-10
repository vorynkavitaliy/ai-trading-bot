/**
 * Final orthogonality + significance for R1 -dReserve7d @ h=7.
 *  (1) corr vs funding_oi 60d pct over the OVERLAP window only (funding starts 2025-05-23).
 *  (2) corr vs ls_top_position 60d pct (the other live fade) if available.
 *  (3) Block-bootstrap of OOS IC: 7d non-overlapping blocks resampled to get a CI,
 *      accounting for the overlapping-window autocorrelation.
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY = 86400_000;
function rank(xs:number[]):number[]{const idx=xs.map((v,i)=>[v,i] as [number,number]).sort((a,b)=>a[0]-b[0]);const r=new Array(xs.length).fill(0);let i=0;while(i<idx.length){let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;const avg=(i+j)/2+1;for(let k=i;k<=j;k++)r[idx[k][1]]=avg;i=j+1;}return r;}
function pearson(a:number[],b:number[]):number{const n=a.length;if(n<3)return NaN;let ma=0,mb=0;for(let i=0;i<n;i++){ma+=a[i];mb+=b[i];}ma/=n;mb/=n;let num=0,da=0,db=0;for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;num+=x*y;da+=x*x;db+=y*y;}return da===0||db===0?NaN:num/Math.sqrt(da*db);}
function spearman(a:number[],b:number[]):number{return pearson(rank(a),rank(b));}
function cleanPair(a:number[],b:number[]):[number[],number[]]{const x:number[]=[],y:number[]=[];for(let i=0;i<a.length;i++)if(Number.isFinite(a[i])&&Number.isFinite(b[i])){x.push(a[i]);y.push(b[i]);}return[x,y];}
function rollingPct(s:(number|null)[],idx:number,win:number):number|null{const lo=Math.max(0,idx-win+1);const w:number[]=[];for(let i=lo;i<=idx;i++){const v=s[i];if(v!=null&&Number.isFinite(v))w.push(v);}const cur=s[idx];if(cur==null||w.length<10)return null;let below=0;for(const v of w)if(v<cur)below++;return below/w.length;}

async function main(){
  const bal:any=await cgGet<any>('/exchange/balance/chart',{symbol:'BTC'});
  const balTl=(bal.data.time_list as number[]).map(Number);
  const dm=bal.data.data_map as Record<string,(number|null)[]>;const ex=Object.keys(dm);
  const resTotal=balTl.map((_,i)=>{let s=0;for(const e of ex){const v=dm[e][i];if(typeof v==='number'&&Number.isFinite(v))s+=v;}return s;});
  const days=balTl.map(t=>Math.floor(t/DAY)*DAY);const d2i=new Map<number,number>();for(let i=0;i<days.length;i++)d2i.set(days[i],i);
  const uniq=Array.from(d2i.keys()).sort((a,b)=>a-b);
  const c=await query<any>(`SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`,[]);
  const closeBy=new Map<number,number>();for(const r of c.rows)closeBy.set(Math.floor(parseInt(r.ts,10)/DAY)*DAY,parseFloat(r.close));
  const u=uniq.map(d=>({day:d,res:resTotal[d2i.get(d)!],close:closeBy.get(d)??null})).filter(r=>r.close!=null);
  const N=u.length;const res=u.map(r=>r.res);const cl=u.map(r=>r.close!);
  const sig=u.map((_,i)=>i>=7?-(res[i]-res[i-7]):NaN);
  const fr=u.map((_,i)=>i+7<N?Math.log(cl[i+7]/cl[i]):NaN);

  // funding_oi daily pct
  const f=await query<any>(`SELECT ts::text, fr_close::text FROM cg_funding_oi_weighted WHERE symbol='BTC' ORDER BY ts ASC`,[]);
  const fundBy=new Map<number,number>();for(const r of f.rows)fundBy.set(Math.floor(parseInt(r.ts,10)/DAY)*DAY,parseFloat(r.fr_close));
  const fund=u.map(r=>fundBy.get(r.day)??null);
  const fundPct=u.map((_,i)=>{const p=rollingPct(fund,i,60);return p==null?NaN:p;});

  // ls_top_position daily pct (try cg table)
  let lsPct:number[]=u.map(()=>NaN);
  try{
    const tbls=await query<any>(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'cg_ls%'`,[]);
    console.log('cg_ls* tables:', tbls.rows.map((r:any)=>r.table_name).join(','));
  }catch(e:any){console.log('table introspection err',e.message);}

  console.log('\n=== orthogonality vs live fade (funding_oi 60d pct) ===');
  // restrict to funding-available overlap
  const [s1,f1]=cleanPair(sig,fundPct);
  console.log(`corr(R1 -dReserve7d, funding_oi 60d pct) Spearman = ${spearman(s1,f1).toFixed(4)}  n=${s1.length}`);

  // also corr of the FADE SIGNAL (funding pct is the fade: high pct -> short). The live trades fade -> directionally signal = -(fundPct-0.5)
  const fadeSig=u.map((_,i)=>Number.isFinite(fundPct[i])?-(fundPct[i]-0.5):NaN);
  const [s2,f2]=cleanPair(sig,fadeSig);
  console.log(`corr(R1, funding-FADE directional signal) Spearman = ${spearman(s2,f2).toFixed(4)}  n=${s2.length}`);

  // (3) block bootstrap OOS IC, 7d blocks
  const split=Math.floor(N/2);
  const pairs:[number,number][]=[];
  for(let i=split;i<N;i++) if(Number.isFinite(sig[i])&&Number.isFinite(fr[i])) pairs.push([sig[i],fr[i]]);
  // build non-overlapping 7-day blocks
  const blocks:[number,number][][]=[];
  for(let i=0;i+7<=pairs.length;i+=7) blocks.push(pairs.slice(i,i+7));
  const nb=blocks.length;
  const ics:number[]=[];
  let seed=12345; function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
  for(let b=0;b<2000;b++){
    const samp:[number,number][]=[];
    for(let k=0;k<nb;k++){const blk=blocks[Math.floor(rnd()*nb)];for(const p of blk) samp.push(p);}
    ics.push(spearman(samp.map(p=>p[0]),samp.map(p=>p[1])));
  }
  ics.sort((a,b)=>a-b);
  const pctl=(q:number)=>ics[Math.floor(q*ics.length)];
  const fullOOS=spearman(pairs.map(p=>p[0]),pairs.map(p=>p[1]));
  let posFrac=0;for(const v of ics)if(v>0)posFrac++;posFrac/=ics.length;
  console.log('\n=== block-bootstrap OOS IC (R1 h=7, 7d blocks, 2000 reps) ===');
  console.log(`full OOS IC=${fullOOS.toFixed(4)}  CI95=[${pctl(0.025).toFixed(4)}, ${pctl(0.975).toFixed(4)}]  frac>0=${posFrac.toFixed(3)}  nBlocks=${nb}`);

  process.exit(0);
}
main().catch(e=>{console.error('ERR',e?.message??String(e));console.error(e?.stack);process.exit(1);});
