/**
 * Cycle counter — tracks /trade-scan cycles to nudge /clear at threshold.
 *
 * Anti-hallucination measure (2026-04-21): /loop context compresses over time.
 * Every 24 cycles (~2h at /loop 5m), recommend operator run /clear to flush
 * stale compressed context. Threshold updated 2026-04-22 (3m → 5m cadence).
 *
 * State: vault/state/cycle-counter.json
 *   {
 *     "total": 127,                          // all-time cycle count
 *     "since_clear": 42,                     // since last /clear
 *     "last_clear_at": "2026-04-21T12:00Z",  // ISO timestamp
 *     "last_tick_at": "2026-04-21T14:00Z",
 *     "nudge_threshold": 40
 *   }
 *
 * CLI:
 *   tick    — increment counters, return state (called each cycle from scan-summary)
 *   reset   — mark /clear just happened, reset since_clear to 0
 *   status  — print state without modifying
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_PATH = path.join(process.cwd(), 'vault/state/cycle-counter.json');
const DEFAULT_THRESHOLD = 24;

export interface CycleState {
  total: number;
  since_clear: number;
  last_clear_at: string | null;
  last_tick_at: string;
  nudge_threshold: number;
}

function load(): CycleState {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      total: 0,
      since_clear: 0,
      last_clear_at: null,
      last_tick_at: new Date().toISOString(),
      nudge_threshold: DEFAULT_THRESHOLD,
    };
  }
}

function save(state: CycleState): void {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function tick(): CycleState {
  const state = load();
  state.total += 1;
  state.since_clear += 1;
  state.last_tick_at = new Date().toISOString();
  save(state);
  return state;
}

export function reset(): CycleState {
  const state = load();
  state.since_clear = 0;
  state.last_clear_at = new Date().toISOString();
  save(state);
  return state;
}

export function status(): CycleState {
  return load();
}

export function nudgeDue(state?: CycleState): boolean {
  const s = state ?? load();
  return s.since_clear >= s.nudge_threshold;
}

// CLI entry point
if (require.main === module) {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'tick':
      console.log(JSON.stringify(tick(), null, 2));
      break;
    case 'reset': {
      const s = reset();
      console.log(JSON.stringify({ ok: true, ...s }, null, 2));
      break;
    }
    case 'status':
      console.log(JSON.stringify(status(), null, 2));
      break;
    default:
      console.error('Usage: cycle-counter.ts <tick|reset|status>');
      process.exit(1);
  }
}
