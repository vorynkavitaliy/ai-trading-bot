import { Candle } from '../analysis/indicators';
import { Regime, detectRegime } from './regime';
import { scoreConfluence, FactorScore, evaluateConfluence } from './confluence';

export type Direction = 'Long' | 'Short';

export interface DirectionScores {
  factors: FactorScore[];
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

export interface SignalInput {
  symbol: string;
  c4h: Candle[];
  c1h: Candle[];
  c15m: Candle[];
  c3m?: Candle[];
  newsBias?: 'risk-on' | 'risk-off' | 'neutral';
  /** BTC context for altcoin correlation. Omit for BTCUSDT itself. */
  btc?: {
    regime: import('./regime').Regime;
    trend1h: 'up' | 'down' | 'range';
    rsiSlope: number;
  };
}

/**
 * 8-factor confluence model.
 *
 * Entry threshold: 5/8 (was 3/4 in old 4-factor model).
 * Counter-trend: needs 6/8.
 *
 * Factors: SMC, Technical, Volume, Multi-TF, Regime, News, Momentum, Volatility
 */
export function generateSignal(i: SignalInput): Signal {
  const { regime, reason: regimeReason } = detectRegime(i.c4h);

  const confluenceInput = {
    c4h: i.c4h, c1h: i.c1h, c15m: i.c15m, c3m: i.c3m,
    regime, newsBias: i.newsBias, btc: i.btc,
  };

  const longFactors = scoreConfluence('Long', confluenceInput);
  const shortFactors = scoreConfluence('Short', confluenceInput);

  const longTotal = longFactors.reduce((s, f) => s + f.score, 0);
  const shortTotal = shortFactors.reduce((s, f) => s + f.score, 0);

  const long: DirectionScores = {
    factors: longFactors,
    total: longTotal,
    details: Object.fromEntries(longFactors.map((f) => [f.name.toLowerCase(), f.detail])),
  };
  const short: DirectionScores = {
    factors: shortFactors,
    total: shortTotal,
    details: Object.fromEntries(shortFactors.map((f) => [f.name.toLowerCase(), f.detail])),
  };

  const better = longTotal >= shortTotal ? long : short;
  const direction: Direction | 'None' = better === long
    ? (longTotal > shortTotal ? 'Long' : 'None')
    : 'Short';

  // Determine threshold based on SMC quality
  // Strong SMC (sweep+OB tap) + Multi-TF → pro entry, only need 4/8
  // Standard: 5/8. Counter-trend: 6/8.
  const smcFactor = better.factors[0]; // SMC is always first
  const multiTfFactor = better.factors[3]; // Multi-TF is 4th
  const smcStrong = smcFactor.rawScore >= 2;
  const structuralEntry = smcStrong && multiTfFactor.score === 1;

  const baseThreshold = structuralEntry ? 4 : 5;

  let rejectReason: string | undefined;
  if (better.total < baseThreshold) {
    rejectReason = structuralEntry
      ? `Structural entry ${better.total}/8 < 4 (sweep+OB but missing support)`
      : `Confluence ${better.total}/8 < 5`;
  }
  // Counter-trend always needs 6/8, even with structural entry
  if (regime === 'Bull' && direction === 'Short' && better.total < 6) rejectReason = `Counter-trend short in Bull needs 6/8 (got ${better.total})`;
  if (regime === 'Bear' && direction === 'Long' && better.total < 6) rejectReason = `Counter-trend long in Bear needs 6/8 (got ${better.total})`;
  // News counter-direction needs 6/8
  if (i.newsBias === 'risk-off' && direction === 'Long' && better.total < 6) rejectReason = 'risk-off bias: Long needs 6/8';
  if (i.newsBias === 'risk-on' && direction === 'Short' && better.total < 6) rejectReason = 'risk-on bias: Short needs 6/8';

  return {
    symbol: i.symbol,
    regime,
    regimeReason,
    long, short,
    direction: rejectReason ? 'None' : direction,
    confluence: better.total,
    rejectReason,
  };
}
