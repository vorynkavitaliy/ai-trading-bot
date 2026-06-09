/**
 * Join recent+older ROW files from eth-packaged-grid.ts, find configs positive in
 * BOTH halves, rank by min(PF). Also flag two-sided (long AND short both >0).
 *
 * Usage: npx tsx src/backtest/cli/eth-grid-join.ts /tmp/eth_s3_recent.rows /tmp/eth_s3_older.rows
 */
import { readFileSync } from 'fs';

interface Row { label: string; trades: number; wr: number; pf: number; sumR: number; maxDD: number; ret: number; ltr: number; lr: number; str: number; sr: number; }

function parse(path: string): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith('ROW|')) continue;
    const p = line.split('|');
    // ROW|label|half|trades|wr|pf|sumR|maxDD|ret|ltr|lr|str|sr
    m.set(p[1], { label: p[1], trades: +p[3], wr: +p[4], pf: +p[5], sumR: +p[6], maxDD: +p[7], ret: +p[8], ltr: +p[9], lr: +p[10], str: +p[11], sr: +p[12] });
  }
  return m;
}

const recent = parse(process.argv[2]);
const older = parse(process.argv[3]);

const both: Array<{ label: string; r: Row; o: Row; minPF: number; twoSided: boolean }> = [];
for (const [label, r] of recent) {
  const o = older.get(label);
  if (!o) continue;
  if (r.sumR > 0 && o.sumR > 0) {
    const twoSided = r.lr > 0 && r.sr > 0 && o.lr > 0 && o.sr > 0;
    both.push({ label, r, o, minPF: Math.min(r.pf, o.pf), twoSided });
  }
}
both.sort((a, b) => b.minPF - a.minPF);

console.log(`configs compared: ${recent.size}/${older.size} (recent/older). both-halves-positive: ${both.length}\n`);
console.log('minPF | twoSided | config | recent[PF sumR | L_R S_R] | older[PF sumR | L_R S_R]');
for (const f of both) {
  console.log(
    `${f.minPF.toFixed(2)} | ${f.twoSided ? 'YES' : 'no '} | ${f.label.padEnd(28)} | ` +
    `R[PF${f.r.pf.toFixed(2)} R${f.r.sumR.toFixed(1)} DD${f.r.maxDD.toFixed(1)} | L${f.r.lr.toFixed(1)} S${f.r.sr.toFixed(1)}] | ` +
    `O[PF${f.o.pf.toFixed(2)} R${f.o.sumR.toFixed(1)} DD${f.o.maxDD.toFixed(1)} | L${f.o.lr.toFixed(1)} S${f.o.sr.toFixed(1)}]`
  );
}

const cleared = both.filter(f => f.minPF >= 1.4);
const twoSidedCleared = both.filter(f => f.minPF >= 1.4 && f.twoSided);
console.log(`\n>>> configs with min(PF) >= 1.4 in BOTH halves: ${cleared.length}`);
console.log(`>>> of those, ALSO two-sided (long&short both >0 both halves): ${twoSidedCleared.length}`);
if (cleared.length) for (const c of cleared) console.log(`    ${c.label}  minPF ${c.minPF.toFixed(2)}  twoSided=${c.twoSided}`);
