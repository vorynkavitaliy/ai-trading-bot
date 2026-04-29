import fs from 'node:fs';
import path from 'node:path';
import { query } from '../../lib/db';
import { log } from '../../lib/logger';
import { Decision, DecisionRecord, Outcome, QueueEntry } from './types';

const VAULT_BACKTEST = path.resolve(__dirname, '../../../vault/Backtest');
const TAKER = 0.00055;
const MAKER = 0.0002;
const SLIP = 0.05;
const RISK_USD_FOR_R = 100; // dummy: pnlR is computed against the trade's own stop distance; the dollar sizing for visualization assumes $100 risk

interface BarMin { ts: number; high: number; low: number; close: number; }

async function load1m(symbol: string, fromTs: number, toTs: number): Promise<BarMin[]> {
  const sql = `SELECT ts::text, high, low, close FROM candles
               WHERE symbol = $1 AND tf = '1m' AND ts >= $2 AND ts <= $3
               ORDER BY ts ASC`;
  const r = await query<any>(sql, [symbol, fromTs, toTs]);
  return r.rows.map((row) => ({
    ts: parseInt(row.ts, 10),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
  }));
}

async function loadFunding(symbol: string, fromTs: number, toTs: number): Promise<Map<number, number>> {
  const r = await query<any>(
    `SELECT ts::text, rate::text FROM funding_history WHERE symbol = $1 AND ts >= $2 AND ts <= $3`,
    [symbol, fromTs, toTs]
  );
  const m = new Map<number, number>();
  for (const row of r.rows) m.set(parseInt(row.ts, 10), parseFloat(row.rate));
  return m;
}

function applySlippage(price: number, side: 'long' | 'short', kind: 'entry' | 'exit', slipPct: number) {
  const f = slipPct / 100;
  if (side === 'long') return kind === 'entry' ? price * (1 + f) : price * (1 - f);
  return kind === 'entry' ? price * (1 - f) : price * (1 + f);
}

interface SimResult {
  exit: number;
  exitTs: number;
  pnlR: number;
  pnlUsd: number;
  feesUsd: number;
  fundingUsd: number;
  exitReason: string;
}

function simulate(
  decision: Extract<Decision, { kind: 'enter' }>,
  decisionTs: number,
  bars: BarMin[],
  funding: Map<number, number>
): SimResult {
  const side = decision.side;
  const entry = applySlippage(decision.entryPrice, side, 'entry', SLIP);
  // qty calibrated to risk $RISK_USD_FOR_R for visualization; pnlR uses stop distance.
  const stopDist = Math.abs(entry - decision.sl);
  const qty = stopDist > 0 ? RISK_USD_FOR_R / stopDist : 0;
  const entryFee = qty * entry * TAKER;
  let banked = 0;
  let tp1Hit = false;
  let sl = decision.sl;
  let curQty = qty;
  let fundingPaid = 0;

  // Walk forward up to maxHoldMs after decisionTs (cap 5 days)
  const maxHoldMs = 5 * 24 * 60 * 60_000;
  for (const b of bars) {
    if (b.ts <= decisionTs) continue;
    if (b.ts > decisionTs + maxHoldMs) {
      // time stop
      const fillPrice = applySlippage(b.close, side, 'exit', SLIP);
      const exitFee = curQty * fillPrice * TAKER;
      const tail = side === 'long' ? (fillPrice - entry) * curQty : (entry - fillPrice) * curQty;
      const grossPnl = banked + tail;
      const totalFees = entryFee + exitFee;
      return {
        exit: fillPrice, exitTs: b.ts,
        pnlR: (grossPnl - totalFees - fundingPaid) / RISK_USD_FOR_R,
        pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
        exitReason: 'time_stop',
      };
    }
    const fr = funding.get(b.ts);
    if (fr !== undefined) {
      const sign = side === 'long' ? 1 : -1;
      fundingPaid += curQty * b.close * fr * sign;
    }
    if (side === 'long') {
      if (b.low <= sl) {
        const fillPrice = applySlippage(sl, side, 'exit', SLIP);
        const exitFee = curQty * fillPrice * TAKER;
        const tail = (fillPrice - entry) * curQty;
        const grossPnl = banked + tail;
        const totalFees = entryFee + exitFee;
        return {
          exit: fillPrice, exitTs: b.ts,
          pnlR: (grossPnl - totalFees - fundingPaid) / RISK_USD_FOR_R,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          exitReason: tp1Hit ? 'tp1_then_be' : 'sl',
        };
      }
      if (!tp1Hit && b.high >= decision.tp1) {
        const fillPrice = applySlippage(decision.tp1, side, 'exit', SLIP);
        const half = curQty / 2;
        const halfFee = half * fillPrice * MAKER;
        banked += (fillPrice - entry) * half - halfFee;
        curQty -= half;
        tp1Hit = true;
        sl = entry;
      }
      if (decision.tp2 && b.high >= decision.tp2) {
        const fillPrice = applySlippage(decision.tp2, side, 'exit', SLIP);
        const tailFee = curQty * fillPrice * MAKER;
        const tail = (fillPrice - entry) * curQty;
        const grossPnl = banked + tail;
        const totalFees = entryFee + tailFee;
        return {
          exit: fillPrice, exitTs: b.ts,
          pnlR: (grossPnl - totalFees - fundingPaid) / RISK_USD_FOR_R,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          exitReason: 'tp2',
        };
      }
    } else {
      if (b.high >= sl) {
        const fillPrice = applySlippage(sl, side, 'exit', SLIP);
        const exitFee = curQty * fillPrice * TAKER;
        const tail = (entry - fillPrice) * curQty;
        const grossPnl = banked + tail;
        const totalFees = entryFee + exitFee;
        return {
          exit: fillPrice, exitTs: b.ts,
          pnlR: (grossPnl - totalFees - fundingPaid) / RISK_USD_FOR_R,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          exitReason: tp1Hit ? 'tp1_then_be' : 'sl',
        };
      }
      if (!tp1Hit && b.low <= decision.tp1) {
        const fillPrice = applySlippage(decision.tp1, side, 'exit', SLIP);
        const half = curQty / 2;
        const halfFee = half * fillPrice * MAKER;
        banked += (entry - fillPrice) * half - halfFee;
        curQty -= half;
        tp1Hit = true;
        sl = entry;
      }
      if (decision.tp2 && b.low <= decision.tp2) {
        const fillPrice = applySlippage(decision.tp2, side, 'exit', SLIP);
        const tailFee = curQty * fillPrice * MAKER;
        const tail = (entry - fillPrice) * curQty;
        const grossPnl = banked + tail;
        const totalFees = entryFee + tailFee;
        return {
          exit: fillPrice, exitTs: b.ts,
          pnlR: (grossPnl - totalFees - fundingPaid) / RISK_USD_FOR_R,
          pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
          exitReason: 'tp2',
        };
      }
    }
  }
  // Ran out of data
  const last = bars[bars.length - 1];
  const fillPrice = applySlippage(last.close, side, 'exit', SLIP);
  const exitFee = curQty * fillPrice * TAKER;
  const tail = side === 'long' ? (fillPrice - entry) * curQty : (entry - fillPrice) * curQty;
  const grossPnl = banked + tail;
  const totalFees = entryFee + exitFee;
  return {
    exit: fillPrice, exitTs: last.ts,
    pnlR: (grossPnl - totalFees - fundingPaid) / RISK_USD_FOR_R,
    pnlUsd: grossPnl, feesUsd: totalFees, fundingUsd: fundingPaid,
    exitReason: 'no_data',
  };
}

function parseDecisionMd(md: string): DecisionRecord | null {
  // Frontmatter YAML between --- markers; we only need the fields below.
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const lines = m[1].split('\n');
  const obj: any = {};
  for (const ln of lines) {
    const idx = ln.indexOf(':');
    if (idx < 0) continue;
    const k = ln.slice(0, idx).trim();
    const v = ln.slice(idx + 1).trim();
    obj[k] = v.replace(/^["']|["']$/g, '');
  }
  if (!obj.id || !obj.symbol || !obj.ts) return null;
  if (obj.decision === 'skip') {
    return {
      kind: 'skip',
      reason: obj.reason ?? '',
      id: obj.id, symbol: obj.symbol, ts: parseInt(obj.ts, 10),
      decidedAt: obj.decidedAt ?? new Date().toISOString(),
    };
  }
  if (obj.decision === 'enter_long' || obj.decision === 'enter_short') {
    return {
      kind: 'enter',
      side: obj.decision === 'enter_long' ? 'long' : 'short',
      entryPrice: parseFloat(obj.entryPrice),
      sl: parseFloat(obj.sl),
      tp1: parseFloat(obj.tp1),
      tp2: obj.tp2 ? parseFloat(obj.tp2) : undefined,
      sizePct: obj.sizePct ? parseFloat(obj.sizePct) : 0.6,
      rationale: obj.rationale ?? '',
      id: obj.id, symbol: obj.symbol, ts: parseInt(obj.ts, 10),
      decidedAt: obj.decidedAt ?? new Date().toISOString(),
    };
  }
  return null;
}

export async function resolveAll() {
  const queuePath = path.join(VAULT_BACKTEST, 'queue.json');
  if (!fs.existsSync(queuePath)) {
    log.error('queue.json not found — run prepare first', { path: queuePath });
    return;
  }
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as QueueEntry[];
  const decisionsDir = path.join(VAULT_BACKTEST, 'decisions');
  const outcomesDir = path.join(VAULT_BACKTEST, 'outcomes');
  fs.mkdirSync(outcomesDir, { recursive: true });

  let resolved = 0;
  for (const q of queue) {
    if (q.status === 'resolved') continue;
    const decisionPath = path.join(decisionsDir, `${q.id}.md`);
    if (!fs.existsSync(decisionPath)) continue;
    const md = fs.readFileSync(decisionPath, 'utf-8');
    const decision = parseDecisionMd(md);
    if (!decision) {
      log.warn('failed to parse decision', { id: q.id });
      continue;
    }
    const outcomePath = path.join(outcomesDir, `${q.id}.json`);
    if (fs.existsSync(outcomePath)) {
      q.status = 'resolved';
      continue;
    }
    let outcome: Outcome;
    if (decision.kind === 'skip') {
      outcome = { id: q.id, symbol: q.symbol, decision };
    } else {
      const fromTs = decision.ts;
      const toTs = decision.ts + 5 * 24 * 60 * 60_000;
      const bars = await load1m(decision.symbol, fromTs, toTs);
      const funding = await loadFunding(decision.symbol, fromTs, toTs);
      const sim = simulate(decision, decision.ts, bars, funding);
      outcome = {
        id: q.id, symbol: q.symbol, decision,
        trade: {
          entry: applySlippage(decision.entryPrice, decision.side, 'entry', SLIP),
          exit: sim.exit,
          exitTs: sim.exitTs,
          pnlR: sim.pnlR,
          pnlUsd: sim.pnlUsd,
          feesUsd: sim.feesUsd,
          fundingUsd: sim.fundingUsd,
          exitReason: sim.exitReason,
        },
      };
    }
    fs.writeFileSync(outcomePath, JSON.stringify(outcome, null, 2));
    q.status = 'resolved';
    resolved++;
  }
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  log.info('claude-walk resolve done', { resolved, total: queue.length });
}
