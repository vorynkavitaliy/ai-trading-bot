/**
 * Robustness battery for the supply-tide reserve signal (R1 = -dReserve7d, R3 = -reservePct60).
 *  (a) Quarter-by-quarter IC (is OOS strength a single-regime artifact?)
 *  (b) Momentum-orthogonalized IC: residualize signal on trailing-h return, re-IC vs fwd-h return.
 *  (c) Sign of mean fwd return when signal>0 vs <0, per half (does direction hold?).
 *  (d) Forward vs PRICE itself: is falling-reserve just lagging price up?
 */
import { cgGet } from '../../core/coinglass';
import { query } from '../../core/db';

const DAY = 86400_000;
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0); let i = 0;
  while (i < idx.length) { let j = i; while (j+1<idx.length && idx[j+1][0]===idx[i][0]) j++; const avg=(i+j)/2+1; for(let k=i;k<=j;k++) r[idx[k][1]]=avg; i=j+1; } return r;
}
function pearson(a: number[], b: number[]): number {
  const n=a.length; if(n<3) return NaN; let ma=0,mb=0; for(let i=0;i<n;i++){ma+=a[i];mb+=b[i];} ma/=n;mb/=n;
  let num=0,da=0,db=0; for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;num+=x*y;da+=x*x;db+=y*y;} return da===0||db===0?NaN:num/Math.sqrt(da*db);
}
function spearman(a: number[], b: number[]): number { return pearson(rank(a), rank(b)); }
function cleanPair(a: number[], b: number[]): [number[], number[]] { const x:number[]=[],y:number[]=[]; for(let i=0;i<a.length;i++) if(Number.isFinite(a[i])&&Number.isFinite(b[i])){x.push(a[i]);y.push(b[i]);} return [x,y]; }
function olsResid(y: number[], x: number[]): number[] {
  // residual of y regressed on x
  const n=y.length; let mx=0,my=0; for(let i=0;i<n;i++){mx+=x[i];my+=y[i];} mx/=n;my/=n;
  let sxy=0,sxx=0; for(let i=0;i<n;i++){sxy+=(x[i]-mx)*(y[i]-my);sxx+=(x[i]-mx)*(x[i]-mx);}
  const b=sxx===0?0:sxy/sxx; const a=my-b*mx; return y.map((v,i)=>v-(a+b*x[i]));
}
function rollingPct(series:(number|null)[], idx:number, win:number):number|null {
  const lo=Math.max(0,idx-win+1); const w:number[]=[]; for(let i=lo;i<=idx;i++){const v=series[i]; if(v!=null&&Number.isFinite(v)) w.push(v);} const cur=series[idx];
  if(cur==null||w.length<10) return null; let below=0; for(const v of w) if(v<cur) below++; return below/w.length;
}

async function main() {
  const bal: any = await cgGet<any>('/exchange/balance/chart', { symbol: 'BTC' });
  const balTl = (bal.data.time_list as number[]).map(Number);
  const dm = bal.data.data_map as Record<string,(number|null)[]>; const ex=Object.keys(dm);
  const resTotal = balTl.map((_,i)=>{let s=0;for(const e of ex){const v=dm[e][i];if(typeof v==='number'&&Number.isFinite(v))s+=v;}return s;});
  const days = balTl.map(t=>Math.floor(t/DAY)*DAY);
  const d2i=new Map<number,number>(); for(let i=0;i<days.length;i++) d2i.set(days[i],i);
  const uniq=Array.from(d2i.keys()).sort((a,b)=>a-b);

  const c = await query<any>(`SELECT ts::text, close FROM candles WHERE symbol='BTCUSDT' AND tf='1D' ORDER BY ts ASC`, []);
  const closeBy=new Map<number,number>(); for(const r of c.rows) closeBy.set(Math.floor(parseInt(r.ts,10)/DAY)*DAY, parseFloat(r.close));

  interface Row{day:number;res:number;close:number|null;}
  const rows:Row[]=uniq.map(d=>({day:d,res:resTotal[d2i.get(d)!],close:closeBy.get(d)??null}));
  const u=rows.filter(r=>r.close!=null);
  const N=u.length;
  const res=u.map(r=>r.res);
  const closeArr=u.map(r=>r.close!);

  function dRes7(){return u.map((_,i)=>i>=7?-(res[i]-res[i-7]):NaN);}
  function resPct(){return u.map((_,i)=>{const p=rollingPct(res,i,60);return p==null?NaN:-(p-0.5);});}
  function fwd(h:number){return u.map((_,i)=>i+h<N?Math.log(closeArr[i+h]/closeArr[i]):NaN);}
  function trail(h:number){return u.map((_,i)=>i-h>=0?Math.log(closeArr[i]/closeArr[i-h]):NaN);}

  const sig=dRes7(); const sigPct=resPct();
  const H=7; const fr=fwd(H); const tr=trail(H);

  // (a) quarterly IC of R1 -dReserve7d @ h=7
  console.log('=== (a) ~90d-block IC: R1 -dReserve7d, h=7 ===');
  const blk=90;
  for(let lo=0; lo<N; lo+=blk){
    const hi=Math.min(N,lo+blk);
    const [a,b]=cleanPair(sig.slice(lo,hi), fr.slice(lo,hi));
    const ic=spearman(a,b);
    // also block trailing-return mean to flag the regime (bull/bear)
    let mret=0,cnt=0; for(let i=lo;i<hi;i++) if(Number.isFinite(fr[i])){mret+=fr[i];cnt++;}
    const lbl=`${new Date(u[lo].day).toISOString().slice(0,10)}..${new Date(u[hi-1].day).toISOString().slice(0,10)}`;
    console.log(`  ${lbl}  n=${a.length}  IC=${ic.toFixed(4)}  meanFwd7=${(cnt?mret/cnt:NaN).toFixed(4)}`);
  }

  // (b) momentum-orthogonalized IC, per half
  const split=Math.floor(N/2);
  console.log('\n=== (b) momentum-orthogonalized IC (signal residualized on trailing-7d ret) ===');
  for(const [lbl,lo,hi] of [['IS',0,split],['OOS',split,N]] as [string,number,number][]){
    // clean triplet sig/tr/fr
    const S:number[]=[],T:number[]=[],F:number[]=[];
    for(let i=lo;i<hi;i++) if(Number.isFinite(sig[i])&&Number.isFinite(tr[i])&&Number.isFinite(fr[i])){S.push(sig[i]);T.push(tr[i]);F.push(fr[i]);}
    const rawIC=spearman(S,F);
    const sResid=olsResid(S,T);              // remove trailing-momentum component from signal
    const fResid=olsResid(F,T);              // remove trailing-momentum component from fwd ret
    const orthIC=spearman(sResid,fResid);
    const momIC=spearman(T,F);               // pure momentum IC for reference
    console.log(`  ${lbl} n=${S.length}: rawIC=${rawIC.toFixed(4)}  momIC(trail->fwd)=${momIC.toFixed(4)}  orthIC(resid)=${orthIC.toFixed(4)}`);
  }

  // (c) directional: mean fwd7 when signal>0 (falling reserves) vs <0, per half
  console.log('\n=== (c) directional mean fwd7 by signal sign ===');
  for(const [lbl,lo,hi] of [['IS',0,split],['OOS',split,N]] as [string,number,number][]){
    let pos=0,pc=0,neg=0,nc=0;
    for(let i=lo;i<hi;i++){ if(!Number.isFinite(sig[i])||!Number.isFinite(fr[i])) continue; if(sig[i]>0){pos+=fr[i];pc++;} else {neg+=fr[i];nc++;} }
    console.log(`  ${lbl}: signal>0 (reserve falling) meanFwd7=${(pc?pos/pc:NaN).toFixed(4)} n=${pc} | signal<0 meanFwd7=${(nc?neg/nc:NaN).toFixed(4)} n=${nc} | diff=${((pc?pos/pc:0)-(nc?neg/nc:0)).toFixed(4)}`);
  }

  // (d) corr(signal, trailing) per half + corr(signal, CONTEMPORANEOUS price level pct)
  console.log('\n=== (d) lagged-momentum corr per half ===');
  for(const [lbl,lo,hi] of [['IS',0,split],['OOS',split,N]] as [string,number,number][]){
    const [a,b]=cleanPair(sig.slice(lo,hi), tr.slice(lo,hi));
    console.log(`  ${lbl}: corr(R1, trailing7d ret)=${spearman(a,b).toFixed(4)} n=${a.length}`);
  }

  // (e) repeat (a)/(b)/(c) summary for R3 reservePct
  console.log('\n=== R3 -reservePct60 @ h=7 cross-check ===');
  for(const [lbl,lo,hi] of [['IS',0,split],['OOS',split,N]] as [string,number,number][]){
    const [a,b]=cleanPair(sigPct.slice(lo,hi), fr.slice(lo,hi)); const rawIC=spearman(a,b);
    const S:number[]=[],T:number[]=[],F:number[]=[];
    for(let i=lo;i<hi;i++) if(Number.isFinite(sigPct[i])&&Number.isFinite(tr[i])&&Number.isFinite(fr[i])){S.push(sigPct[i]);T.push(tr[i]);F.push(fr[i]);}
    const orthIC=spearman(olsResid(S,T),olsResid(F,T));
    console.log(`  ${lbl}: rawIC=${rawIC.toFixed(4)} orthIC=${orthIC.toFixed(4)} n=${S.length}`);
  }

  process.exit(0);
}
main().catch(e=>{console.error('ERR',e?.message??String(e));console.error(e?.stack);process.exit(1);});
