/**
 * DivergenceDetector — classifies size mismatches between a Bybit position
 * and its matching DB trade row.
 *
 * Possible classifications:
 *   - 'aligned'      — sizes match within 1% of the DB qty.
 *   - 'tp1_partial'  — Bybit size ~40-60% of initial_qty and tp1 not yet
 *                      logged in DB. Watcher's TP1-fill processor will handle
 *                      the DB update; not a real divergence.
 *   - 'dust'         — Bybit size < 1% of initial after a logged TP1. Position
 *                      is effectively closed; caller should market-close it so
 *                      the gap-fill loop can complete the close cycle.
 *   - 'mismatch'     — true divergence that needs operator attention.
 *
 * Pure: no side effects, no IO. Caller decides what to do with the verdict.
 */

import type { OpenTrade } from '../data/trade-repo';

export type DivergenceVerdict = 'aligned' | 'tp1_partial' | 'dust' | 'mismatch';

/** What the Bybit-side view of a position looks like (subset reconcile needs). */
export interface BybitPosView {
  symbol: string;
  side: string;
  size: number;
}

const QTY_TOLERANCE_FRAC = 0.01;
const TP1_PARTIAL_LO = 0.40;
const TP1_PARTIAL_HI = 0.60;
const DUST_FRAC = 0.01;

export class DivergenceDetector {
  /**
   * Compare Bybit position size against the matching DB trade qty.
   * Returns 'aligned' when sizes match within tolerance.
   */
  classify(pos: BybitPosView, match: OpenTrade): DivergenceVerdict {
    const diff = Math.abs(match.qty - pos.size);
    const tolerance = match.qty * QTY_TOLERANCE_FRAC;
    if (diff <= tolerance) return 'aligned';

    const ratioVsInitial = pos.size / Math.max(match.initial_qty, 1);

    // Expected TP1 partial fill — watcher will sync the DB.
    if (!match.tp1_filled && ratioVsInitial > TP1_PARTIAL_LO && ratioVsInitial < TP1_PARTIAL_HI) {
      return 'tp1_partial';
    }

    const isAbsoluteDust = pos.size > 0 && pos.size < match.initial_qty * DUST_FRAC;
    if (isAbsoluteDust) return 'dust';

    return 'mismatch';
  }
}

export const divergenceDetector = new DivergenceDetector();
