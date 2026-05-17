// Smoke-test for the cron hot path: validates that scan-decide → auto-execute →
// execute spawn chain works end-to-end without actually placing live orders.
//
// What it does:
//   1. Writes a fake /tmp/scan-decide-latest.json containing one synthetic
//      actionable signal (action=enter, riskCheck.allowed=true).
//   2. Spawns src/runtime/auto-execute.ts as cron would, with env DRY_RUN=1
//      so that execute.ts's eventual Bybit calls are no-ops.
//   3. Reads /tmp/auto-execute-latest.json and asserts: exitCode 0, no
//      ERR_MODULE_NOT_FOUND, no other crash strings.
//   4. Restores the original /tmp/scan-decide-latest.json so cron is unaffected.
//
// Why: the 2026-05-17 hotfix (commit 906868c) recovered from a path bug
// (spawn target was src/src/execute.ts after refactor 6ff2094) that silently
// dropped every actionable signal for ~10h. tsc --noEmit didn't catch it
// because the path was a runtime string. This smoke catches that class of
// regression.
//
// Usage: npx tsx src/tools/diagnostics/smoke-pipeline.ts
// Exit code 0 = pass, non-zero = fail.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_PATH = '/tmp/scan-decide-latest.json';
const SUMMARY_PATH = '/tmp/auto-execute-latest.json';

// Pick a symbol+side combo that the strategy generates often so the synthetic
// signal looks plausible. Numbers don't have to match real prices — DRY_RUN
// makes execute.ts skip Bybit and only run the precheck + persist path.
const FAKE_SIGNAL = {
  // auto-execute reads scan.cycle.iso for freshness check (must be within FRESHNESS_MS)
  cycle: { ts: Date.now(), iso: new Date().toISOString() },
  ts: Date.now(),
  iso: new Date().toISOString(),
  totalSymbols: 1,
  enterCount: 1,
  risk: {
    totalEquityUsd: 50000,
    dailyPnlPct: 0,
    openPositionsCount: 0,
    totalHeatPct: 0,
    softKillTriggered: false,
    hardKillTriggered: false,
    pairBlocked: {},
    inFundingWindow: false,
  },
  decisions: [
    {
      symbol: 'SMOKEUSDT',  // intentionally a NON-real symbol so even if DRY_RUN slips, Bybit will reject
      action: 'enter',
      side: 'short',
      orderType: 'market',
      entryPrice: 100,
      sl: 102,
      tp1: 99,
      tp2: 98,
      sizePct: 0.375,
      rationale: '[smoke-test] synthetic signal — DO NOT EXECUTE',
      riskCheck: { allowed: true, sizeMultiplier: 1.0 },
      enrichment: { rrTp2: 1.0, setupQuality: { rrTp2: 1.0 } },
    },
  ],
};

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

async function main() {
  const checks: Check[] = [];

  // Save original scan-decide JSON if exists
  let originalScan: string | null = null;
  try { originalScan = fs.readFileSync(SCAN_PATH, 'utf8'); } catch { /* ignore */ }

  let originalSummary: string | null = null;
  try { originalSummary = fs.readFileSync(SUMMARY_PATH, 'utf8'); } catch { /* ignore */ }

  try {
    // 1) Inject fake signal
    fs.writeFileSync(SCAN_PATH, JSON.stringify(FAKE_SIGNAL, null, 2));
    checks.push({ name: 'inject fake scan-decide', pass: true });

    // 2) Run auto-execute as cron would
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('npx', ['tsx', 'src/runtime/auto-execute.ts'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DRY_RUN: '1' },
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });

    checks.push({
      name: 'auto-execute spawn returns',
      pass: result.code === 0,
      detail: `exit=${result.code}`,
    });

    const combined = result.stdout + '\n' + result.stderr;
    checks.push({
      name: 'no ERR_MODULE_NOT_FOUND in output',
      pass: !combined.includes('ERR_MODULE_NOT_FOUND'),
      detail: combined.includes('ERR_MODULE_NOT_FOUND') ? 'module path bug regressed!' : undefined,
    });
    checks.push({
      name: 'no Cannot find module in output',
      pass: !combined.includes('Cannot find module'),
    });

    // 3) Read auto-execute summary
    let summary: any = null;
    try {
      summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
    } catch (e: any) {
      checks.push({ name: 'auto-execute-latest.json readable', pass: false, detail: e.message });
    }
    if (summary) {
      checks.push({ name: 'auto-execute-latest.json readable', pass: true });

      // 4) Verify auto-execute actually attempted to spawn execute.ts (not just early-exited)
      // The synthetic signal sets enterCount=1 so auto-execute should not exit at PAUSE/stale.
      // Either it spawned execute.ts (record present) OR it bailed for a different gating reason —
      // either way, the spawn path should NOT have produced an ERR_MODULE_NOT_FOUND.
      const recordExists = (summary.records ?? []).length > 0 || summary.actionable === 0 || summary.error;
      checks.push({ name: 'summary has records or graceful no-op', pass: recordExists, detail: JSON.stringify({ actionable: summary.actionable, records: (summary.records ?? []).length, error: summary.error }) });

      // If a record exists, verify it doesn't carry the module-not-found error.
      for (const rec of summary.records ?? []) {
        const errStr = String(rec.error ?? '');
        const moduleBug = errStr.includes('Cannot find module') || errStr.includes('ERR_MODULE_NOT_FOUND');
        checks.push({
          name: `record ${rec.symbol}: no spawn-path bug in stderr`,
          pass: !moduleBug,
          detail: moduleBug ? errStr.slice(0, 200) : undefined,
        });
      }
    }
  } finally {
    // Always restore original scan-decide
    if (originalScan !== null) {
      fs.writeFileSync(SCAN_PATH, originalScan);
    } else {
      try { fs.unlinkSync(SCAN_PATH); } catch { /* ignore */ }
    }
    if (originalSummary !== null) {
      fs.writeFileSync(SUMMARY_PATH, originalSummary);
    } else {
      try { fs.unlinkSync(SUMMARY_PATH); } catch { /* ignore */ }
    }
  }

  // Report
  console.log('==================================================================================');
  console.log('SMOKE TEST  —  scan-decide → auto-execute → execute spawn chain');
  console.log('==================================================================================\n');
  const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));
  for (const c of checks) {
    const status = c.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}  ${pad(c.name, 50)} ${c.detail ? ' — ' + c.detail : ''}`);
  }
  const failed = checks.filter(c => !c.pass).length;
  console.log(`\n${failed === 0 ? '🟢 All ' + checks.length + ' checks passed' : '🔴 ' + failed + '/' + checks.length + ' checks FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke-test crashed:', e?.message ?? String(e));
  process.exit(2);
});
