/**
 * DailyDdGuard — pure per-account intraday drawdown tracker.
 *
 * Operator spec (2026-06-03): keep a running max EQUITY (balance + floating PnL)
 * per UTC day; daily_drawdown = max_peak_per_day − current_equity; when it exceeds
 * `thresholdPct`% of the account BASE balance (starting bucket), the account must
 * be flattened. This class only TRACKS + decides the trigger; the caller performs
 * the close + halt so this stays side-effect-free and unit-testable.
 *
 * Backtest-validated (live-cron-true-mirror, cap-6, 1-min grid): threshold 4.3%
 * of base cut Hyro −5% breaches from 16/yr to ~2/yr while keeping +53%/yr (the
 * remaining breaches are sub-minute moves a tick-level live feed catches earlier).
 */
export interface DailyDdGuardStatus {
  dayKey: string;
  peakEquity: number;
  currentEquity: number;
  drawdownUsd: number;
  drawdownPctOfBase: number;
  triggeredToday: boolean;
}

export class DailyDdGuard {
  private dayKey = '';
  private peakEquity = 0;
  private lastEquity = 0;
  private triggeredToday = false;

  constructor(
    private readonly baseBalance: number,
    private readonly thresholdPct: number, // e.g. 4.3
  ) {}

  /**
   * Feed the latest account equity. Returns `{ breach: true }` exactly once per UTC
   * day — the first tick where (peak − equity) ≥ thresholdPct% of base. Ignores
   * non-finite / non-positive equity (warmup before first wallet/position fill).
   * Daily peak + trigger reset automatically at UTC-day rollover.
   */
  update(equity: number, now: Date = new Date()): { breach: boolean; status: DailyDdGuardStatus } {
    if (!Number.isFinite(equity) || equity <= 0) {
      return { breach: false, status: this.status() };
    }
    const day = now.toISOString().slice(0, 10);
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.peakEquity = equity;
      this.triggeredToday = false;
    } else if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    this.lastEquity = equity;

    const drawdownUsd = this.peakEquity - equity;
    const triggerUsd = (this.thresholdPct / 100) * this.baseBalance;
    let breach = false;
    if (this.baseBalance > 0 && drawdownUsd >= triggerUsd && !this.triggeredToday) {
      this.triggeredToday = true;
      breach = true;
    }
    return { breach, status: this.status() };
  }

  get isHaltedToday(): boolean {
    return this.triggeredToday;
  }

  status(): DailyDdGuardStatus {
    const drawdownUsd = Math.max(0, this.peakEquity - this.lastEquity);
    return {
      dayKey: this.dayKey,
      peakEquity: this.peakEquity,
      currentEquity: this.lastEquity,
      drawdownUsd,
      drawdownPctOfBase: this.baseBalance > 0 ? (drawdownUsd / this.baseBalance) * 100 : 0,
      triggeredToday: this.triggeredToday,
    };
  }
}
