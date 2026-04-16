/**
 * Position sizing — ATR-stop-distance based.
 *
 * Formula:
 *   risk_usd = initial_balance * (risk_pct / 100)
 *   qty      = risk_usd / |entry - sl|
 *
 * Then quantized to instrument's qty step.
 */

export interface SizingInput {
  initialBalance: number;
  riskPct: number;
  entry: number;
  stopLoss: number;
  qtyStep: number;
  minQty: number;
  maxQty?: number;
  contractValue?: number; // for inverse contracts; default 1 (linear USDT)
  /** Absolute hard cap on risk — no single trade may lose more than this % of balance */
  hardRiskCapPct?: number;
}

export interface SizingResult {
  qty: number;
  qtyString: string;
  riskUsd: number;
  notionalUsd: number;
  stopDistance: number;
  stopDistancePct: number;
}

export function sizePosition(i: SizingInput): SizingResult {
  if (i.entry <= 0 || i.stopLoss <= 0) throw new Error('entry/sl must be > 0');
  const stopDistance = Math.abs(i.entry - i.stopLoss);
  if (stopDistance === 0) throw new Error('stop distance is zero');

  // Enforce absolute hard cap — risk_pct is never allowed to exceed it
  const effectivePct = i.hardRiskCapPct !== undefined
    ? Math.min(i.riskPct, i.hardRiskCapPct)
    : i.riskPct;
  const riskUsd = i.initialBalance * (effectivePct / 100);
  const cv = i.contractValue ?? 1;
  let rawQty = riskUsd / (stopDistance * cv);

  // Quantize down to step
  const stepped = Math.floor(rawQty / i.qtyStep) * i.qtyStep;
  let qty = Math.max(stepped, 0);

  if (i.maxQty !== undefined && qty > i.maxQty) qty = quantize(i.maxQty, i.qtyStep, 'down');
  if (qty < i.minQty) qty = 0; // cannot meet min — caller should reject

  const decimals = decimalsOf(i.qtyStep);
  const qtyString = qty.toFixed(decimals);

  return {
    qty,
    qtyString,
    riskUsd: qty * stopDistance * cv,
    notionalUsd: qty * i.entry * cv,
    stopDistance,
    stopDistancePct: (stopDistance / i.entry) * 100,
  };
}

export function quantize(v: number, step: number, mode: 'down' | 'nearest' | 'up' = 'nearest'): number {
  if (step === 0) return v;
  const r = v / step;
  const q = mode === 'down' ? Math.floor(r) : mode === 'up' ? Math.ceil(r) : Math.round(r);
  const out = q * step;
  return Number(out.toFixed(decimalsOf(step)));
}

export function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  const s = step.toString();
  if (s.includes('e')) {
    const m = /e-(\d+)/.exec(s);
    return m ? Number(m[1]) : 8;
  }
  const idx = s.indexOf('.');
  return idx === -1 ? 0 : s.length - idx - 1;
}
