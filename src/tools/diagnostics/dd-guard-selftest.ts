/**
 * dd-guard-selftest — deterministic checks for DailyDdGuard trigger logic.
 * Run: npx tsx src/tools/diagnostics/dd-guard-selftest.ts
 */
import { DailyDdGuard } from '../../runtime/daily-dd-guard';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const D = (s: string) => new Date(s + 'T00:00:00.000Z');
const base = 200_000;
const thr = 4.3; // % of base → $8,600 trigger

console.log('=== DailyDdGuard self-test (base=200k, thr=4.3% → $8,600) ===');

// 1) Peak tracking + no breach on small dip.
{
  const g = new DailyDdGuard(base, thr);
  g.update(200_000, D('2026-02-17'));
  g.update(205_000, D('2026-02-17')); // new peak
  const r = g.update(200_000, D('2026-02-17')); // −$5,000 from peak (2.5% of base) → no breach
  check('peak follows up, small dip no breach', !r.breach && Math.abs(g.status().peakEquity - 205_000) < 1);
  check('drawdownPctOfBase ≈ 2.5%', Math.abs(g.status().drawdownPctOfBase - 2.5) < 0.01);
}

// 2) Breach exactly at threshold (peak 205k − 8,600 = 196,400).
{
  const g = new DailyDdGuard(base, thr);
  g.update(205_000, D('2026-02-17'));
  const justAbove = g.update(196_500, D('2026-02-17')); // −$8,500 < trigger → no
  check('just above threshold → no breach', !justAbove.breach);
  const atThr = g.update(196_400, D('2026-02-17')); // −$8,600 == trigger → breach
  check('at threshold → breach', atThr.breach);
}

// 3) One fire per day (does not re-fire same day).
{
  const g = new DailyDdGuard(base, thr);
  g.update(205_000, D('2026-02-17'));
  const first = g.update(190_000, D('2026-02-17'));
  const second = g.update(185_000, D('2026-02-17')); // deeper, same day
  check('fires once', first.breach);
  check('does not re-fire same day', !second.breach && g.isHaltedToday);
}

// 4) Daily reset → can fire again next UTC day.
{
  const g = new DailyDdGuard(base, thr);
  g.update(205_000, D('2026-02-17'));
  g.update(190_000, D('2026-02-17')); // breach day 1
  const newDay = g.update(196_000, D('2026-02-18')); // new day, peak resets to 196k
  check('new day resets peak', Math.abs(g.status().peakEquity - 196_000) < 1 && !newDay.breach && !g.isHaltedToday);
  const breach2 = g.update(187_400, D('2026-02-18')); // 196k − 8,600 = 187,400 → breach
  check('can fire again next day', breach2.breach);
}

// 5) Ignores non-finite / zero equity (warmup).
{
  const g = new DailyDdGuard(base, thr);
  const r1 = g.update(NaN, D('2026-02-17'));
  const r2 = g.update(0, D('2026-02-17'));
  check('NaN/zero equity ignored', !r1.breach && !r2.breach);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
