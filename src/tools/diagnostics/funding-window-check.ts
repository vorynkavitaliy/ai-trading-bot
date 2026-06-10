// Verifies the asymmetric funding window (2026-06-10): blocked ONLY the 10 min
// BEFORE settlement at 00/08/16 UTC, open immediately after.
import { isFundingWindow } from '../../runtime/risk-guard';

const CASES: Array<[string, boolean]> = [
  ['2026-06-11T23:49:00Z', false],
  ['2026-06-11T23:50:00Z', true],
  ['2026-06-11T23:59:59Z', true],
  ['2026-06-11T00:00:00Z', false],
  ['2026-06-11T00:01:30Z', false],
  ['2026-06-11T00:09:00Z', false],
  ['2026-06-11T07:55:00Z', true],
  ['2026-06-11T08:02:00Z', false],
  ['2026-06-11T15:55:00Z', true],
  ['2026-06-11T16:05:00Z', false],
  ['2026-06-11T11:55:00Z', false],
  ['2026-06-11T12:01:00Z', false],
  ['2026-06-11T19:55:00Z', false],
];

let failed = 0;
for (const [iso, expected] of CASES) {
  const actual = isFundingWindow(new Date(iso));
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${iso} expected=${expected} actual=${actual}`);
}
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
