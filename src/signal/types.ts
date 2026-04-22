/**
 * Minimal signal types — kept for backward compatibility with executor/planner/db.
 *
 * ARCHITECTURAL NOTE (2026-04-18 refactor):
 * Since Claude became the primary decision-maker, confluence scoring in TypeScript
 * has been removed. Legacy files `confluence.ts` and `generator.ts` are deleted.
 * These types remain to avoid breaking DB schema (confluence int) and Signal-shaped
 * audit logs. Claude passes `confluence` as a plain number via execute.ts CLI.
 */

/** Legacy 4H regime label — kept for DB schema compat (Signal.regime field). */
export type Regime = 'Bull' | 'Bear' | 'Range' | 'Transitional';

export type Direction = 'Long' | 'Short';

export interface DirectionScores {
  factors: any[];
  total: number;
  details: Record<string, string>;
}

export interface Signal {
  symbol: string;
  regime: Regime;
  regimeReason: string;
  long: DirectionScores;
  short: DirectionScores;
  direction: Direction | 'None';
  confluence: number;
  rejectReason?: string;
}
