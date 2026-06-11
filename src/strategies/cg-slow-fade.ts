/**
 * v5 cgSlowFade portfolio strategies (migrated from srcNew research, 2026-06-10).
 *
 * Validated on the honest minute-level engine (srcNew/backtest): 360d BTC+ETH+SOL+XRP,
 * permutation p=0.000 (0/150 random >= strategy), bootstrap P(loss)=0.19%, parameter
 * cube 27/27 positive, bidirectional walk-forward OOS +18.1%/+18.5% per half,
 * portfolio +64.1%/yr @ BTC 1% / alts 0.5%, MTM maxDD -8.17%, worst day -1.85%.
 *
 * Signal core (4H cadence, 180-bar = 30d percentile window):
 *   - fade L/S Top Position extremes: pct >= 0.95 -> SHORT, pct <= 0.05 -> LONG
 *   - fade funding extremes:          pct >= 0.95 -> SHORT
 *   - long-liquidation cascade p>=0.97 -> momentum SHORT (continuation, NOT reversion)
 *
 * btcMode (the operator's lead-lag insight — alts follow Bitcoin):
 *   - 'none'  : pair's own signals (BTC itself)
 *   - 'trend' : pair's own signals, gated by BTC 4H EMA20/50 direction (ETH)
 *   - 'signal': trade the ALT off BTC's positioning extremes (SOL, XRP) — BTC's
 *               crowd predicts alts better than their own crowd does
 *
 * Exits: SL 2.0 ATR(14), TP 3.5 ATR (single target, tp1=tp2), max hold 12 x 4H
 * from SIGNAL time — the 48h time-stop is enforced live by src/runtime/max-hold.ts
 * (5-min cron, placedTs parity via pending_orders.requested_at).
 *
 * Entry (Phase 2, 2026-06-11 — operator GO): resting LIMIT at base ∓ 0.3·ATR on the
 * passive side (long below / short above the current price), SL/TP anchored to the
 * LIMIT price (riskPerUnit = exactly 2.0·ATR), TTL 230 min (dies 10 min before the
 * next 4H boundary; src/runtime/entry-ttl.ts cancels). Base = live ticker at scan
 * time (srcNew lastPrice = 1m close at boundary+60s). Marketable-at-placement
 * limits fill immediately as taker — exactly the engine's first-bar rule. The
 * trades row + maker TP are deferred to the FILL (pendingOnly → promotion paths);
 * SL rides the entry order and arms server-side at fill. The 2026-06-04 incident
 * class (phantom rows for unfilled limits) is closed by a triple guard: entry-ttl
 * canceller + status-driven risk-guard occupancy (TTL+grace) + cancel-before-place
 * in execute. entryOffsetAtr=0 falls back to market entry (the +52.5% variant that
 * ran live 2026-06-10..11).
 * Cooldowns live in risk-guard (12h after SL exit / 4h after any close) — exactly
 * the values and semantics the portfolio backtest was validated with. No
 * in-strategy cooldown. An expired unfilled limit triggers NO cooldown (engine
 * parity: the pair simply re-signals at the next boundary if conditions hold).
 *
 * Live-policy decisions (2026-06-10/11, srcNew/backtest/cli/live-policy-experiments.ts):
 *   - decideOncePerAnchor: scan-decide latches one decision per closed 4H bar
 *     (srcNew consumes a decision bar even when blocked; hourly retries forbidden).
 *   - Funding window is ASYMMETRIC (operator decision 2026-06-10): blocked only the
 *     10 min BEFORE settlement at 00/08/16 UTC, so boundary entries at HH:01-04
 *     proceed immediately — the validated 'take' policy.
 *   - cgReadLagBars=1: CG read lags the anchor one bucket — the validated info set
 *     (srcNew publishLag 120s > gap 60s) and revision-settled (CG retro-revises
 *     fresh liq buckets). Reading the just-closed bucket doubled MTM maxDD
 *     (−12.25% vs −6.92%) at equal return.
 *   - Target envelope (limit entries, lag-1, take — the 'validated' headline):
 *     +64.1%/yr, PF 1.68, WR 56.3%, maxDD −8.17%, worst day −2.36%, both WF halves
 *     positive (older ann +63.6%/PF 1.80, recent ann +81.7%/PF 1.90), permutation
 *     p=0.000. Unfilled-signal cost is inside these numbers (placed vs filled
 *     tracked by the engine).
 */
import { Action, Strategy, StrategyContext, Side, Bar } from '../backtest/types';
import { CoinglassFeatures } from '../data/coinglass-features';
import { atr, trendUp } from '../core/indicators';

export type BtcMode = 'none' | 'trend' | 'signal';

export interface CgSlowFadeParams {
  btcMode: BtcMode;
  shortsOnly: boolean;
  lsPctHi: number;
  lsPctLo: number;
  fundingPctHi: number;
  liqSpikePct: number;
  windowBars: number;
  atrPeriod: number;
  slAtrMult: number;
  tpAtrMult: number;
  maxHoldBars: number;
  riskPct: number;
  emaFast: number;
  emaSlow: number;
  // Phase 2 (2026-06-11): resting limit entry at price ∓ entryOffsetAtr × ATR
  // (passive side: long below, short above), cancelled after entryTtlMinutes.
  // srcNew-validated 0.3 / 230 on every leg (+64.1%/yr headline). Set
  // entryOffsetAtr=0 to fall back to market entry (the +52.5% offset-0 variant).
  entryOffsetAtr: number;
  entryTtlMinutes: number;
}

const DEFAULTS: CgSlowFadeParams = {
  btcMode: 'none',
  shortsOnly: false,
  lsPctHi: 0.95,
  lsPctLo: 0.05,
  fundingPctHi: 0.95,
  liqSpikePct: 0.97,
  windowBars: 180,
  atrPeriod: 14,
  slAtrMult: 2.0,
  tpAtrMult: 3.5,
  maxHoldBars: 12,
  riskPct: 0.5,
  emaFast: 20,
  emaSlow: 50,
  entryOffsetAtr: 0.3,
  entryTtlMinutes: 230,
};

interface SideSignal {
  side: Side;
  rationale: string;
}

// Percentile of the CURRENT value against the trailing window EXCLUDING itself —
// exact match with the validated srcNew engine (lookback slice(0,-1)).
function percentileExcludingCurrent(history: number[], current: number, windowBars: number): number | null {
  if (history.length < windowBars + 1) return null;
  const window = history.slice(-(windowBars + 1), -1);
  let below = 0;
  for (const value of window) if (value <= current) below++;
  return below / window.length;
}

export class CgSlowFade implements Strategy {
  readonly name: string;
  readonly needsCoinglass = true;
  readonly decideOncePerAnchor = true;
  readonly cgReadLagBars = 1;
  readonly p: CgSlowFadeParams;

  constructor(params: Partial<CgSlowFadeParams> = {}) {
    this.p = { ...DEFAULTS, ...params };
    const p = this.p;
    this.name = `cg-slow-fade-v5(${p.btcMode}${p.shortsOnly ? ',S-only' : ''}, ls${p.lsPctHi}/${p.lsPctLo}, f${p.fundingPctHi}, liq${p.liqSpikePct}, sl${p.slAtrMult}/tp${p.tpAtrMult}, off${p.entryOffsetAtr}, hold${p.maxHoldBars})`;
  }

  get needsBtcContext(): boolean {
    return this.p.btcMode !== 'none';
  }

  decide(ctx: StrategyContext): Action {
    if (ctx.position) return { kind: 'hold' };

    const own = ctx.coinglass as CoinglassFeatures | undefined;
    if (!own) return { kind: 'hold' };

    const signal = this.extractSignal(ctx, own);
    if (!signal) return { kind: 'hold' };
    if (this.p.shortsOnly && signal.side === 'long') return { kind: 'hold' };

    const bars = ctx.recentBars ?? [];
    const atrValue = atr(bars, this.p.atrPeriod);
    if (atrValue == null || atrValue <= 0) return { kind: 'hold' };

    // srcNew geometry (cg-slow-fade.ts:63-72): limit rests on the PASSIVE side of
    // the current price (long below, short above) and SL/TP anchor to the LIMIT
    // price — riskPerUnit is exactly slAtrMult × ATR by construction. Base price =
    // live ticker at decision time when available (srcNew lastPrice = 1m close at
    // boundary + 60s), else the 4H anchor close. offset 0 degrades to market entry.
    const dir = signal.side === 'long' ? 1 : -1;
    const offset = this.p.entryOffsetAtr * atrValue;
    const basePrice = ctx.livePrice ?? ctx.price;
    const entry = basePrice - dir * offset;
    const sl = entry - dir * this.p.slAtrMult * atrValue;
    const tp = entry + dir * this.p.tpAtrMult * atrValue;
    const useLimit = this.p.entryOffsetAtr > 0;

    return {
      kind: 'enter',
      side: signal.side,
      orderType: useLimit ? 'limit' : 'market',
      entryPrice: entry,
      sl,
      tp1: tp,
      tp2: tp,
      sizePct: this.p.riskPct,
      rationale: signal.rationale,
      ttlMinutes: useLimit ? this.p.entryTtlMinutes : undefined,
    };
  }

  private extractSignal(ctx: StrategyContext, own: CoinglassFeatures): SideSignal | null {
    const p = this.p;

    const sentimentSource =
      p.btcMode === 'signal' ? (ctx.btcCoinglass as CoinglassFeatures | undefined) : own;
    const sourceLabel = p.btcMode === 'signal' ? 'BTC' : 'пары';

    let signal: SideSignal | null = null;
    if (sentimentSource) {
      signal = this.fadeSignal(sentimentSource, sourceLabel);
    }

    if (signal && p.btcMode === 'trend' && !this.btcTrendAllows(ctx, signal.side)) {
      signal = null;
    }

    if (!signal) {
      signal = this.liqMomentumSignal(own);
    }

    return signal;
  }

  private fadeSignal(cg: CoinglassFeatures, sourceLabel: string): SideSignal | null {
    const p = this.p;

    const lsCur = cg.ls_top_position;
    const lsPct =
      lsCur != null ? percentileExcludingCurrent(cg.ls_top_position_history, lsCur, p.windowBars) : null;
    const fCur = cg.funding_oi_weighted;
    const fPct =
      fCur != null ? percentileExcludingCurrent(cg.funding_oi_weighted_history, fCur, p.windowBars) : null;
    if (lsPct == null || fPct == null) return null;

    if (lsPct >= p.lsPctHi || fPct >= p.fundingPctHi) {
      const trigger =
        lsPct >= p.lsPctHi
          ? `позиции крупных трейдеров ${sourceLabel} на ${(lsPct * 100).toFixed(0)}-м перцентиле`
          : `ставка финансирования ${sourceLabel} на ${(fPct * 100).toFixed(0)}-м перцентиле`;
      return { side: 'short', rationale: `Перегрев покупателей: ${trigger} за 30 дней. Вход против толпы.` };
    }
    if (lsPct <= p.lsPctLo) {
      return {
        side: 'long',
        rationale: `Перегрев продавцов: позиции крупных трейдеров ${sourceLabel} на ${(lsPct * 100).toFixed(0)}-м перцентиле за 30 дней. Вход против толпы.`,
      };
    }
    return null;
  }

  private liqMomentumSignal(own: CoinglassFeatures): SideSignal | null {
    const p = this.p;
    const hist = own.liq_long_history;
    if (!hist || hist.length < p.windowBars + 1) return null;

    const current = hist[hist.length - 1];
    const pct = percentileExcludingCurrent(hist, current, p.windowBars);
    if (pct == null || pct < p.liqSpikePct) return null;

    return {
      side: 'short',
      rationale: `Каскад ликвидаций покупателей (${(pct * 100).toFixed(0)}-й перцентиль за 30 дней) — вход по направлению каскада.`,
    };
  }

  private btcTrendAllows(ctx: StrategyContext, side: Side): boolean {
    const btcBars: Bar[] = ctx.btcBars4hRecent ?? [];
    if (btcBars.length < this.p.emaSlow + 5) return false;
    const up = trendUp(btcBars.map(b => b.close), this.p.emaFast, this.p.emaSlow);
    if (up == null) return false;
    return side === 'long' ? up : !up;
  }
}

export function cgSlowFadeV5(params: Partial<CgSlowFadeParams> = {}): Strategy {
  return new CgSlowFade(params);
}
