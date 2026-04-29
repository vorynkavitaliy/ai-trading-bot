import { Action, Strategy, StrategyContext } from '../types';

// Sanity-check strategy: always go long at 1H close with SL=-2%, TP=+1%.
// On a bullish year (BTC 2025), this should give WR > 30% and totalR roughly
// matching buy-and-hold drift. If WR is around 0-5%, the engine has a bug.

export function sanityAlwaysLong(): Strategy {
  return {
    name: 'sanity-always-long(SL=-2%, TP=+1%)',
    decide(ctx: StrategyContext): Action {
      // Only enter once per ~24 bars to keep trade count manageable
      // (engine still re-evaluates each 1H bar, so position keeps blocking).
      // We rely on engine's "no new entry while position open" rule.
      const sl = ctx.price * 0.98;
      const tp = ctx.price * 1.01;
      return {
        kind: 'enter', side: 'long', orderType: 'market',
        entryPrice: ctx.price, sl,
        tp1: tp, tp2: ctx.price * 1.02,
        sizePct: 0.6,
        rationale: 'sanity always-long',
      };
    },
  };
}
