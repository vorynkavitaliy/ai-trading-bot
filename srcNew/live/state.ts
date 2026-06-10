import fs from 'node:fs';
import path from 'node:path';

import { Side } from '../backtest/types';

export interface PaperOrder {
  pair: string;
  side: Side;
  limitPrice: number;
  slPrice: number;
  tpPrice: number;
  placedTs: number;
  expiresTs: number;
  maxHoldUntilTs: number;
  riskPctPerTrade: number;
  tag: string;
}

export interface PaperPosition {
  pair: string;
  side: Side;
  entryTs: number;
  entryPrice: number;
  entryIsTaker: boolean;
  limitPrice: number;
  slPrice: number;
  tpPrice: number;
  placedTs: number;
  maxHoldUntilTs: number;
  riskPctPerTrade: number;
  tag: string;
}

export interface ClosedPaperTrade extends PaperPosition {
  exitTs: number;
  exitPrice: number;
  exitReason: string;
  netR: number;
  pnlPct: number;
}

export interface PaperState {
  equity: number;
  startedAtTs: number;
  lastMonitorTs: number;
  lastDecisionBarTs: Record<string, number>;
  cooldownUntilTs: Record<string, number>;
  orders: PaperOrder[];
  positions: PaperPosition[];
  closedTrades: ClosedPaperTrade[];
}

const STATE_DIR = path.resolve(__dirname, 'state');
const STATE_PATH = path.join(STATE_DIR, 'paper-state.json');

export function statePath(): string {
  return STATE_PATH;
}

export function loadState(nowTs: number): PaperState {
  if (!fs.existsSync(STATE_PATH)) {
    return {
      equity: 1,
      startedAtTs: nowTs,
      lastMonitorTs: nowTs,
      lastDecisionBarTs: {},
      cooldownUntilTs: {},
      orders: [],
      positions: [],
      closedTrades: [],
    };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as PaperState;
}

export function saveState(state: PaperState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmpPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, STATE_PATH);
}
