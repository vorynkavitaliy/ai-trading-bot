import { InstrumentInfo, roundQtyToStep } from './bybit';

export interface NormalizedQty {
  qtyStr: string;
  qtyNum: number;
  valid: boolean;
}

export function normalizeQty(rawQty: number, info: InstrumentInfo): NormalizedQty {
  const qtyStr = roundQtyToStep(rawQty, info);
  const qtyNum = parseFloat(qtyStr);
  const valid = qtyNum > 0 && qtyNum >= info.minOrderQty;
  return { qtyStr, qtyNum, valid };
}

export interface SplitQty {
  first: NormalizedQty;
  rest: NormalizedQty;
  valid: boolean;
}

export function splitQtyHalves(total: number, info: InstrumentInfo): SplitQty {
  const halfRaw = total / 2;
  const first = normalizeQty(halfRaw, info);
  const rest = normalizeQty(total - first.qtyNum, info);
  return { first, rest, valid: first.valid && rest.valid };
}
