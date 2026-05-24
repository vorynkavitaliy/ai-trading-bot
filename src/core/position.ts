/**
 * Position — single object representing a trade through its entire lifecycle.
 *
 * Before this class the lifecycle was scattered:
 *   - execute.ts          — entry + TP submit
 *   - position-watcher.ts — TP1 detect + SL-to-BE move + naked-TP recovery
 *   - reconcile.ts        — gap-fill close, exit reason inference
 * Each module read state by recomputing implicit flags (tp1_filled_at IS NOT
 * NULL, pos.size / initialQty < 0.6, realized_r < 0). The 2026-05-23
 * `reconcile.ts:188 t.qty vs initial_qty` bug was exactly the cost of having
 * three implicit views of the same state.
 *
 * Now: one class, four explicit states, transitions guarded.
 *
 * State machine:
 *   Pending  → Open       (Bybit position size becomes > 0)
 *   Pending  → Closed     (limit order cancelled before any fill)
 *   Open     → Tp1Filled  (partial fill on tp1 detected via bybit_size drop)
 *   Open     → Closed     (full close — SL, single TP, or manual)
 *   Tp1Filled → Closed    (final TP2 fill, SL on remainder, or manual)
 */

import { OpenTrade } from '../data/trade-repo';

export type PositionState = 'Pending' | 'Open' | 'Tp1Filled' | 'Closed';

/**
 * Threshold below which a position size drop from initial_qty is treated as a
 * TP1 partial fill (rather than a full close). 60% of initial means 40% has
 * been taken out by TP1 — matches our 50/50 TP1/TP2 split with a tolerance
 * margin for rounding/slippage.
 */
const TP1_PARTIAL_THRESHOLD = 0.6;

const VALID_TRANSITIONS: Record<PositionState, PositionState[]> = {
  Pending:   ['Open', 'Closed'],
  Open:      ['Tp1Filled', 'Closed'],
  Tp1Filled: ['Closed'],
  Closed:    [],
};

export class Position {
  readonly id: number;
  readonly symbol: string;
  readonly side: string;
  readonly accountBucket: string;
  readonly accountKey: string;
  readonly initialQty: number;
  readonly entryPrice: number | null;
  readonly sl: number | null;
  readonly tp1: number | null;
  readonly tp2: number | null;
  readonly openedAt: string;

  /** Current remaining qty in the DB row (mutates on TP1 partial fill). */
  currentQty: number;

  private _state: PositionState;
  /** Bybit-reported size (0 = order pending; > 0 = position live). null = not yet observed. */
  private _bybitSize: number | null = null;

  private constructor(init: {
    id: number; symbol: string; side: string;
    accountBucket: string; accountKey: string;
    initialQty: number; currentQty: number;
    entryPrice: number | null; sl: number | null;
    tp1: number | null; tp2: number | null;
    openedAt: string; state: PositionState;
  }) {
    this.id = init.id;
    this.symbol = init.symbol;
    this.side = init.side;
    this.accountBucket = init.accountBucket;
    this.accountKey = init.accountKey;
    this.initialQty = init.initialQty;
    this.currentQty = init.currentQty;
    this.entryPrice = init.entryPrice;
    this.sl = init.sl;
    this.tp1 = init.tp1;
    this.tp2 = init.tp2;
    this.openedAt = init.openedAt;
    this._state = init.state;
  }

  /**
   * Lift an open DB row into a Position. The initial state derives from the
   * trade row alone — bybit_size attaches later via `attachBybitSize()` if
   * needed to detect Pending or Tp1Filled fresh.
   */
  static fromOpenTrade(t: OpenTrade): Position {
    return new Position({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      accountBucket: t.account_bucket,
      accountKey: t.account_key,
      initialQty: t.initial_qty,
      currentQty: t.qty,
      entryPrice: t.entry_price,
      sl: t.sl,
      tp1: t.tp1,
      tp2: t.tp2,
      openedAt: t.opened_at,
      state: t.tp1_filled ? 'Tp1Filled' : 'Open',
    });
  }

  state(): PositionState {
    return this._state;
  }

  /**
   * Attach the current Bybit position size. Promotes Pending → Open when size
   * crosses to positive, or detects Open → Tp1Filled when size drops below
   * initialQty × TP1_PARTIAL_THRESHOLD without crossing to zero.
   *
   * Returns the transitions that fired (most callers only care about the new
   * state, but watcher needs to notify on each one).
   */
  attachBybitSize(size: number): PositionState[] {
    this._bybitSize = size;
    const fired: PositionState[] = [];

    if (this._state === 'Pending' && size > 0) {
      this.transitionTo('Open');
      fired.push('Open');
    }

    if (this._state === 'Open' && size > 0 && size < this.initialQty * TP1_PARTIAL_THRESHOLD) {
      this.transitionTo('Tp1Filled');
      this.currentQty = size;
      fired.push('Tp1Filled');
    }

    if ((this._state === 'Open' || this._state === 'Tp1Filled') && size === 0) {
      this.transitionTo('Closed');
      fired.push('Closed');
    }

    return fired;
  }

  /** Move to a new state. Throws on invalid transition (state-machine integrity). */
  transitionTo(next: PositionState): void {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid position transition ${this._state} → ${next} (id=${this.id} ${this.symbol})`);
    }
    this._state = next;
  }

  /**
   * Dollar risk based on initial qty × stop distance. Always uses initial_qty —
   * never current_qty. This is the field whose abuse caused realized_r inflation
   * on TP1-partial trades; encapsulating it here means no caller can recreate
   * the bug.
   */
  riskedUsd(): number {
    if (this.entryPrice === null || this.sl === null) return 0;
    return Math.abs(this.entryPrice - this.sl) * this.initialQty;
  }

  /** True if the strategy used a single-target TP plan (tp1 == tp2). */
  isSingleTpPlan(): boolean {
    if (this.tp1 === null || this.tp2 === null) return true;
    if (this.entryPrice === null) return false;
    return Math.abs(this.tp1 - this.tp2) / this.entryPrice < 0.0001;
  }

  /** True if a TP1 partial fill has already been processed (state Tp1Filled). */
  isTp1Filled(): boolean {
    return this._state === 'Tp1Filled';
  }

  /** True if the position is live on the exchange (Open or Tp1Filled). */
  isLive(): boolean {
    return this._state === 'Open' || this._state === 'Tp1Filled';
  }

  /** Bybit position size at last observation; null if attachBybitSize never called. */
  bybitSize(): number | null {
    return this._bybitSize;
  }
}
