import { Bar } from '../backtest/types';

export interface VolumeProfile {
  poc: number;
  val: number;
  vah: number;
  binSize: number;
  totalVol: number;
}

export function buildVolumeProfile(bars: Bar[], binCount: number, valuePct: number): VolumeProfile | null {
  if (bars.length < 6) return null;
  const lo = Math.min(...bars.map((b) => b.low));
  const hi = Math.max(...bars.map((b) => b.high));
  if (hi <= lo) return null;
  const binSize = (hi - lo) / binCount;
  const bins = new Array<number>(binCount).fill(0);
  for (const b of bars) {
    const startIdx = Math.max(0, Math.floor((b.low - lo) / binSize));
    const endIdx = Math.min(binCount - 1, Math.floor((b.high - lo) / binSize));
    const span = endIdx - startIdx + 1;
    if (span <= 0) continue;
    const volPerBin = b.volume / span;
    for (let i = startIdx; i <= endIdx; i++) bins[i] += volPerBin;
  }
  const totalVol = bins.reduce((s, v) => s + v, 0);
  if (totalVol <= 0) return null;
  let pocIdx = 0;
  for (let i = 1; i < binCount; i++) if (bins[i] > bins[pocIdx]) pocIdx = i;
  let lower = pocIdx;
  let upper = pocIdx;
  let acc = bins[pocIdx];
  const target = totalVol * valuePct;
  while (acc < target && (lower > 0 || upper < binCount - 1)) {
    const canDown = lower > 0;
    const canUp = upper < binCount - 1;
    const downVol = canDown ? bins[lower - 1] : -1;
    const upVol = canUp ? bins[upper + 1] : -1;
    if (downVol >= upVol && canDown) {
      lower--;
      acc += bins[lower];
    } else if (canUp) {
      upper++;
      acc += bins[upper];
    } else {
      break;
    }
  }
  const binMid = (idx: number) => lo + binSize * (idx + 0.5);
  return {
    poc: binMid(pocIdx),
    val: lo + binSize * lower,
    vah: lo + binSize * (upper + 1),
    binSize,
    totalVol,
  };
}
