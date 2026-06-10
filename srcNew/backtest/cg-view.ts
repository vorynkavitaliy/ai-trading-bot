import { SeriesPoint } from '../data/types';

export interface CgSeriesInput {
  name: string;
  intervalMs: number;
  points: readonly SeriesPoint[];
}

interface IndexedSeries {
  intervalMs: number;
  points: readonly SeriesPoint[];
  availableAt: readonly number[];
}

export class CgView {
  private readonly series = new Map<string, IndexedSeries>();
  private readonly publishLagMs: number;
  private cursorTs = 0;

  constructor(inputs: readonly CgSeriesInput[], publishLagMs: number) {
    this.publishLagMs = publishLagMs;
    for (const input of inputs) {
      const sorted = [...input.points].sort((a, b) => a.ts - b.ts);
      this.series.set(input.name, {
        intervalMs: input.intervalMs,
        points: sorted,
        availableAt: sorted.map(p => p.ts + input.intervalMs + publishLagMs),
      });
    }
  }

  setCursor(decisionTs: number): void {
    this.cursorTs = decisionTs;
  }

  history(name: string, count: number): SeriesPoint[] {
    const s = this.requireSeries(name);
    const end = upperBound(s.availableAt, this.cursorTs);
    const start = Math.max(0, end - count);
    return s.points.slice(start, end) as SeriesPoint[];
  }

  latest(name: string): SeriesPoint | null {
    const s = this.requireSeries(name);
    const end = upperBound(s.availableAt, this.cursorTs);
    return end > 0 ? s.points[end - 1] : null;
  }

  valueHistory(name: string, field: string, count: number): number[] {
    return this.history(name, count).map(p => {
      const v = p.values[field];
      if (v === undefined) throw new Error(`field ${field} missing in series ${name}`);
      return v;
    });
  }

  private requireSeries(name: string): IndexedSeries {
    const s = this.series.get(name);
    if (!s) throw new Error(`unknown CG series: ${name}`);
    return s;
  }
}

function upperBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
