// Cron-direct executor: every actionable signal (action='enter' && riskCheck.allowed)
// is taken at full size. Classifier removed — backtest cap-6 @ 0.375% delivered
// +88.45% / 365d WITHOUT it; the +1.7% lift was within noise and rejected too many
// borderline setups in live (5/5 SKIP'd in 24h trial).
//
// Output: JSON summary at /tmp/auto-execute-latest.json (latest) +
//         /tmp/auto-execute-history.jsonl (append-only audit trail).

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { log } from '../core/logger';

const SCAN_PATH = '/tmp/scan-decide-latest.json';
const SUMMARY_PATH = '/tmp/auto-execute-latest.json';
const HISTORY_PATH = '/tmp/auto-execute-history.jsonl';
const RATIONALE_PATH = '/tmp/auto-execute-rationale.txt';
// PAUSE.md marker lives at project root (src/runtime → ../.. = root).
// tg-bot.ts creates this file on /pause and removes it on /resume; presence
// means auto-execute halts new entries. mkdir is recursive in tg-bot.
const PAUSE_FILE = path.resolve(__dirname, '..', '..', 'vault', 'Watchlist', 'PAUSE.md');
const FRESHNESS_MS = 6 * 60_000;

function appendHistory(entry: any): void {
  try {
    fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n');
  } catch (e: any) {
    log.warn('history append failed', { err: e.message });
  }
}

function execAndCapture(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // execute.ts lives at src/runtime/execute.ts (post-refactor 6ff2094, 2026-05-17).
    // cwd = project root so the relative path resolves correctly and so that
    // execute.ts loads .env / accounts.json / migrations from the right place.
    const child = spawn('npx', ['tsx', 'src/runtime/execute.ts', ...args], {
      cwd: path.resolve(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

interface ExecutionRecord {
  symbol: string;
  side: string;
  rrTp2: number;
  executed: boolean;
  exitCode?: number;
  error?: string;
}

async function main() {
  // Operator-set halt: vault/Watchlist/PAUSE.md (created via /pause Telegram command).
  // Skip the entire cycle while file exists — operator must /resume to re-enable.
  if (fs.existsSync(PAUSE_FILE)) {
    log.info('auto-execute: PAUSE.md present → halt all entries');
    const out = { error: 'paused', pauseFile: PAUSE_FILE, records: [] };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(out, null, 2));
    appendHistory({ ts: new Date().toISOString(), ...out });
    return;
  }

  if (!fs.existsSync(SCAN_PATH)) {
    log.info('auto-execute: no scan-decide-latest.json — exiting');
    const out = { error: 'no scan-decide json', records: [] };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(out, null, 2));
    appendHistory({ ts: new Date().toISOString(), ...out });
    return;
  }
  const raw = fs.readFileSync(SCAN_PATH, 'utf-8');
  const scan = JSON.parse(raw);

  const ageMs = Date.now() - new Date(scan.cycle.iso).getTime();
  if (ageMs > FRESHNESS_MS) {
    log.info('auto-execute: scan-decide stale → exit', { ageMs, freshnessMs: FRESHNESS_MS });
    const out = { error: 'scan stale', ageMs, records: [] };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(out, null, 2));
    appendHistory({ ts: new Date().toISOString(), ...out });
    return;
  }

  const actionable = (scan.decisions ?? []).filter(
    (d: any) => d.action === 'enter' && d.riskCheck?.allowed === true
  );

  if (actionable.length === 0) {
    log.info('auto-execute: 0 actionable signals → exit');
    const out = { cycle: scan.cycle, records: [], summary: 'no actionable' };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(out, null, 2));
    appendHistory({ ts: new Date().toISOString(), ...out });
    return;
  }

  const records: ExecutionRecord[] = [];
  for (const d of actionable) {
    const rrTp2 = d.enrichment?.setupQuality?.rrTp2 ?? 0;
    const rec: ExecutionRecord = {
      symbol: d.symbol,
      side: d.side,
      rrTp2,
      executed: false,
    };

    const sideForExecute = d.side === 'long' ? 'buy' : 'sell';
    const rationale = `[auto] ${d.symbol} ${d.side?.toUpperCase()} cron-direct: ${d.rationale ?? ''}`;
    fs.writeFileSync(RATIONALE_PATH, rationale);

    const args = [
      '--symbol', d.symbol,
      '--side', sideForExecute,
      // MARKET entry for ALL orders (2026-06-04). This line previously hardcoded
      // `scaledIn ? 'market' : 'limit'` — which IGNORED cg-fade's orderType and left
      // single-entry as a resting LIMIT that often never filled → db_without_bybit
      // phantom 'open' rows + missed moves (BTC @66097 / @64318 incidents 2026-06-03/04).
      // Scaled-in slot-1 was already market (slots 2/3 stay Limit via execute.ts
      // placeScaledIn). Market = immediate fill, matches the cron-realistic backtest's
      // fill-at-signal semantics.
      '--order-type', 'market',
      '--entry-price', String(d.entryPrice),
      '--sl', String(d.sl),
      '--risk-pct', String(d.sizePct ?? 0.375),
      '--rationale-file', RATIONALE_PATH,
    ];
    if (d.tp1 != null) args.push('--tp1', String(d.tp1));
    if (d.tp2 != null) args.push('--tp2', String(d.tp2));
    if (d.strategy) args.push('--strategy', String(d.strategy));
    // S5 scaled-in: serialize config as JSON arg so execute.ts can place 3 limit orders.
    if (d.scaledIn) args.push('--scaled-in', JSON.stringify(d.scaledIn));

    log.info('auto-execute: TAKE → spawning execute.ts', { symbol: d.symbol, side: d.side, sizePct: d.sizePct, rrTp2 });

    const { code, stdout, stderr } = await execAndCapture(args);
    rec.executed = code === 0;
    rec.exitCode = code;
    // Always preserve stderr — execute.ts logs TP submit errors here even on exit 0.
    // We need this to detect silent TP fails (entry OK but TP1/TP2 rejected by Bybit).
    if (stderr) rec.error = stderr.slice(0, 2000);
    if (code !== 0) {
      log.error('auto-execute: execute.ts failed', { symbol: d.symbol, code, stderr: stderr.slice(0, 500) });
    } else {
      // Check for TP submit errors in stderr (silent fails that don't fail process)
      const tpFail = /TP[12] SUBMIT (REJECTED|THREW)|naked.tp/i.test(stderr);
      if (tpFail) {
        log.error('auto-execute: TP submit silent fail', { symbol: d.symbol, stderr: stderr.slice(-500) });
      } else {
        log.info('auto-execute: execute.ts ok', { symbol: d.symbol, stdoutTail: stdout.slice(-200) });
      }
    }
    records.push(rec);
  }

  const summary = {
    cycle: scan.cycle,
    actionable: actionable.length,
    executed: records.filter((r) => r.executed).length,
    failed: records.filter((r) => !r.executed).length,
    records,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  appendHistory({ ts: new Date().toISOString(), ...summary });
  console.log(`auto-execute: actionable=${summary.actionable} executed=${summary.executed} failed=${summary.failed}`);
}

main().catch((e) => {
  log.error('auto-execute crashed', { err: e?.message ?? String(e) });
  process.exit(1);
});
