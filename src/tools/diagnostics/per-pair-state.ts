// Per-pair decision X-ray. For every enabled Tier-1 pair, surfaces the FULL
// internal state the live scan-decide path computes but throws away on a 'hold':
//   - assigned strategy + percentile thresholds
//   - current CG signal value(s) + their percentile over the 180×4H window
//   - distance (in percentile points) to the nearest entry threshold
//   - pair / BTC EMA20-50 trend filters and whether they'd block the implied side
//   - ATR(14) on 4H + the SL/TP that WOULD be placed
//   - strategy same-direction cooldown (DB) + risk-guard pairBlocked reason
//   - the authoritative strategy.decide() result + the precise gate that held
//
// Reuses the EXACT live objects: buildContext from scan-decide (same 4H anchor +
// CG read + bars), the strategy instances from TIER1_PORTFOLIO, and the same
// percentile/trendUp/atr primitives the strategy itself calls — so the numbers
// shown are the numbers the strategy decided on, not a re-derivation.
//
// Read-only. Writes /tmp/per-pair-state.json and prints a table.
//   npx tsx src/tools/diagnostics/per-pair-state.ts

import fs from 'node:fs';
import { close as closePg } from '../../core/db';
import { buildContext } from '../../runtime/scan-decide';
import { TIER1_PORTFOLIO, getStrategyForPair, tier1Pairs } from '../../runtime/pair-strategies';
import {
  CgFadeStrategy,
  LsTopPositionFade,
  FundingFade,
  FundingTaConfluence,
} from '../../strategies/cg-fade';
import { CoinglassFeatures } from '../../data/coinglass-features';
import { atr, percentile, trendUp } from '../../core/indicators';
import { RiskManager } from '../../runtime/risk-guard';
import { getLiveTickers } from '../../core/bybit';
import { loadAccounts } from '../../core/accounts';
import { refreshForScan } from '../../data/backfill';
import { loadAll as loadCooldowns } from '../../core/strategy-cooldowns';
import { loadBars as loadBarsCanonical } from '../../data/candles';
import { Bar } from '../../backtest/types';

interface SignalView {
  name: string;
  current: number | null;
  currentPct: number | null;     // percentile [0,1]
  shortAt: number;               // pctHi
  longAt: number;                // pctLo
  distToShortPp: number | null;  // percentile-points pct must RISE to reach short
  distToLongPp: number | null;   // percentile-points pct must FALL to reach long
  histLen: number;
}

interface PairView {
  pair: string;
  strategy: string;              // S1..S4
  strategyName: string;
  pctHi: number;
  pctLo: number;
  usePairTrend: boolean;
  useBtcTrend: boolean;
  price4hAnchor: number | null;
  atr14: number | null;
  signals: SignalView[];
  impliedSide: 'long' | 'short' | null;  // from signals alone (pre trend/cooldown)
  pairTrendUp: boolean | null | 'n/a';
  btcTrendUp: boolean | null | 'n/a';
  trendBlocks: boolean;
  slIfEnter: number | null;
  tpIfEnter: number | null;
  strategyCooldown: { active: boolean; side: 'long' | 'short' | null; remainingMin: number | null };
  riskGuardBlock: string | null;
  decide: 'hold' | 'enter';
  holdReason: string;
  cgMissing: boolean;
}

function sLabel(s: CgFadeStrategy): string {
  if (s instanceof FundingTaConfluence) return 'S4';
  if (s instanceof FundingFade) return 'S3';
  if (s instanceof LsTopPositionFade) return s.p.usePairTrend ? 'S1' : 'S2';
  return '?';
}

function pctView(name: string, hist: number[] | undefined, cur: number | null | undefined, pctHi: number, pctLo: number, windowBars: number): SignalView {
  const histLen = hist?.length ?? 0;
  if (!hist || histLen < windowBars || cur == null) {
    return { name, current: cur ?? null, currentPct: null, shortAt: pctHi, longAt: pctLo, distToShortPp: null, distToLongPp: null, histLen };
  }
  const pct = percentile(hist.slice(-windowBars), cur);
  return {
    name,
    current: cur,
    currentPct: pct,
    shortAt: pctHi,
    longAt: pctLo,
    distToShortPp: Math.max(0, pctHi - pct) * 100,
    distToLongPp: Math.max(0, pct - pctLo) * 100,
    histLen,
  };
}

function buildSignals(strategy: CgFadeStrategy, cg: CoinglassFeatures | undefined): { signals: SignalView[]; impliedSide: 'long' | 'short' | null } {
  const p = strategy.p;
  if (!cg) return { signals: [], impliedSide: null };

  if (strategy instanceof FundingTaConfluence) {
    const f = pctView('funding_oi_weighted', cg.funding_oi_weighted_history, cg.funding_oi_weighted, p.pctHi, p.pctLo, p.windowBars);
    const t = pctView('ls_top_account', cg.ls_top_account_history, cg.ls_top_account, p.pctHi, p.pctLo, p.windowBars);
    let side: 'long' | 'short' | null = null;
    if (f.currentPct != null && t.currentPct != null) {
      if (f.currentPct >= p.pctHi && t.currentPct >= p.pctHi) side = 'short';
      else if (f.currentPct <= p.pctLo && t.currentPct <= p.pctLo) side = 'long';
    }
    return { signals: [f, t], impliedSide: side };
  }

  if (strategy instanceof FundingFade) {
    const f = pctView('funding_oi_weighted', cg.funding_oi_weighted_history, cg.funding_oi_weighted, p.pctHi, p.pctLo, p.windowBars);
    let side: 'long' | 'short' | null = null;
    if (f.currentPct != null) {
      if (f.currentPct >= p.pctHi) side = 'short';
      else if (f.currentPct <= p.pctLo) side = 'long';
    }
    return { signals: [f], impliedSide: side };
  }

  // LsTopPositionFade (S1/S2)
  const l = pctView('ls_top_position', cg.ls_top_position_history, cg.ls_top_position, p.pctHi, p.pctLo, p.windowBars);
  let side: 'long' | 'short' | null = null;
  if (l.currentPct != null) {
    if (l.currentPct >= p.pctHi) side = 'short';
    else if (l.currentPct <= p.pctLo) side = 'long';
  }
  return { signals: [l], impliedSide: side };
}

async function main() {
  const writeStart = Date.now();
  try {
    await refreshForScan();
  } catch (e: any) {
    console.error('refreshForScan failed (continuing on existing data):', e?.message ?? String(e));
  }

  const now = new Date();
  const nowTs = now.getTime();
  const riskManager = await RiskManager.createForTick(now);
  const risk = riskManager.state();
  const cooldownState = await loadCooldowns();
  const accounts = loadAccounts();
  const universe = tier1Pairs();

  let livePrices = new Map<string, number>();
  try {
    livePrices = await getLiveTickers(accounts[0], universe);
  } catch (e: any) {
    console.error('live tickers fetch failed:', e?.message ?? String(e));
  }

  // BTC 4H bars + staleness guard — mirror scan-decide exactly.
  const btcBars4hRaw: Bar[] = await loadBarsCanonical('BTCUSDT', '240m', { limit: 300 });
  const BTC_BARS_STALE_MS = 12 * 60 * 60_000;
  const btcLastTs = btcBars4hRaw.reduce((m, b) => Math.max(m, b.ts), 0);
  const btcStale = btcLastTs === 0 || (nowTs - btcLastTs) > BTC_BARS_STALE_MS;
  const btcBars4h = btcStale ? [] : btcBars4hRaw;

  const views: PairView[] = [];

  for (const pair of universe) {
    const strategy = getStrategyForPair(pair) as unknown as CgFadeStrategy;
    const p = strategy.p;
    const live = livePrices.get(pair) ?? null;
    const r = await buildContext(pair, nowTs, live, btcBars4h, cooldownState);

    if (!r.ctx) {
      views.push({
        pair, strategy: sLabel(strategy), strategyName: strategy.name,
        pctHi: p.pctHi, pctLo: p.pctLo, usePairTrend: p.usePairTrend, useBtcTrend: p.useBtcTrend,
        price4hAnchor: null, atr14: null, signals: [], impliedSide: null,
        pairTrendUp: p.usePairTrend ? null : 'n/a', btcTrendUp: p.useBtcTrend ? null : 'n/a',
        trendBlocks: false, slIfEnter: null, tpIfEnter: null,
        strategyCooldown: { active: false, side: null, remainingMin: null },
        riskGuardBlock: risk.pairBlocked[pair] ?? null,
        decide: 'hold', holdReason: `no-context: ${r.reason ?? 'unknown'}`, cgMissing: !!r.cgMissing,
      });
      continue;
    }

    const ctx = r.ctx;
    const cg = ctx.coinglass as CoinglassFeatures | undefined;
    const price = ctx.price;
    const a = atr(ctx.recentBars ?? [], p.atrPeriod);

    const { signals, impliedSide } = buildSignals(strategy, cg);

    // Trend filters (replicate trendFiltersAllow for display).
    const pairCloses = (ctx.recentBars ?? []).map(b => b.close);
    const pairUp = p.usePairTrend ? trendUp(pairCloses, p.emaFast, p.emaSlow) : null;
    const btcCloses = (ctx.btcBars4hRecent ?? []).map(b => b.close);
    const btcEnough = (ctx.btcBars4hRecent ?? []).length >= p.emaSlow + 5;
    const btcUp = p.useBtcTrend ? (btcEnough ? trendUp(btcCloses, p.emaFast, p.emaSlow) : null) : null;

    let trendBlocks = false;
    if (impliedSide) {
      if (p.usePairTrend) {
        if (pairUp == null) trendBlocks = true;
        else if (impliedSide === 'short' && pairUp) trendBlocks = true;
        else if (impliedSide === 'long' && !pairUp) trendBlocks = true;
      }
      if (p.useBtcTrend) {
        if (btcUp == null) trendBlocks = true;
        else if (impliedSide === 'short' && btcUp) trendBlocks = true;
        else if (impliedSide === 'long' && !btcUp) trendBlocks = true;
      }
    }

    // Strategy same-direction cooldown (DB snapshot).
    const cdEntry = cooldownState.get(pair);
    let cdActive = false;
    let cdRemainingMin: number | null = null;
    if (cdEntry && impliedSide && cdEntry.side === impliedSide) {
      const elapsed = nowTs - cdEntry.ts;
      const windowMs = p.cooldownHours * 3_600_000;
      if (elapsed < windowMs) {
        cdActive = true;
        cdRemainingMin = Math.round((windowMs - elapsed) / 60_000);
      }
    }

    let slIfEnter: number | null = null;
    let tpIfEnter: number | null = null;
    if (impliedSide && a != null && a > 0) {
      const tpMult = p.scaledIn?.tpAtrMult ?? p.tpAtrMult;
      slIfEnter = impliedSide === 'long' ? price - p.slAtrMult * a : price + p.slAtrMult * a;
      tpIfEnter = impliedSide === 'long' ? price + tpMult * a : price - tpMult * a;
    }

    // Authoritative decision + precise hold reason (replicate decide() gate order).
    const action = strategy.decide(ctx);
    let holdReason: string;
    let riskGuardBlock: string | null = risk.pairBlocked[pair] ?? null;
    if (action.kind === 'enter') {
      // Real risk-guard verdict — covers GLOBAL gates pairBlocked omits:
      // funding window (±10min around 00/08/16 UTC), entry-window cap,
      // max-parallel, kill switches. This is the authoritative live gate.
      const rc = await riskManager.precheck(pair, action.sizePct);
      riskGuardBlock = rc.allowed ? null : (rc.reason ?? 'blocked');
      holdReason = rc.allowed
        ? `🟢 ENTER ${action.side?.toUpperCase()} — risk-guard ALLOWED (would auto-execute)`
        : `ENTER ${action.side?.toUpperCase()} signal — BLOCKED by risk-guard: ${rc.reason}`;
    } else if (!cg) {
      holdReason = 'no-coinglass';
    } else if (!impliedSide) {
      // Distance-to-fire. For confluence (>1 signal) BOTH must cross, so the
      // binding constraint is the WORST signal (max distance), not the best.
      const haveAll = signals.length > 0 && signals.every(s => s.currentPct != null);
      let near: number | null = null;
      if (haveAll) {
        const distShort = Math.max(...signals.map(s => s.distToShortPp!));
        const distLong = Math.max(...signals.map(s => s.distToLongPp!));
        near = Math.min(distShort, distLong);
      }
      holdReason = near != null
        ? `percentile-neutral (${signals.length > 1 ? 'confluence ' : ''}nearest threshold ${near.toFixed(1)}pp away)`
        : 'percentile-neutral (signal data short)';
    } else if (cdActive) {
      holdReason = `strategy-cooldown ${impliedSide} (${cdRemainingMin}min left)`;
    } else if (trendBlocks) {
      const parts: string[] = [];
      if (p.usePairTrend) parts.push(`pair EMA ${pairUp == null ? 'n/a' : pairUp ? 'up' : 'down'}`);
      if (p.useBtcTrend) parts.push(`BTC EMA ${btcUp == null ? 'n/a' : btcUp ? 'up' : 'down'}`);
      holdReason = `trend-filter blocks ${impliedSide} (${parts.join(', ')})`;
    } else if (a == null || a <= 0) {
      holdReason = 'no-atr';
    } else {
      holdReason = 'hold (unexpected — signal+trend pass but decide=hold)';
    }

    views.push({
      pair, strategy: sLabel(strategy), strategyName: strategy.name,
      pctHi: p.pctHi, pctLo: p.pctLo, usePairTrend: p.usePairTrend, useBtcTrend: p.useBtcTrend,
      price4hAnchor: price, atr14: a,
      signals, impliedSide,
      pairTrendUp: p.usePairTrend ? pairUp : 'n/a',
      btcTrendUp: p.useBtcTrend ? btcUp : 'n/a',
      trendBlocks,
      slIfEnter, tpIfEnter,
      strategyCooldown: { active: cdActive, side: cdEntry?.side ?? null, remainingMin: cdRemainingMin },
      riskGuardBlock,
      decide: action.kind === 'enter' ? 'enter' : 'hold',
      holdReason,
      cgMissing: !!r.cgMissing,
    });
  }

  const out = {
    cycle: { ts: nowTs, iso: now.toISOString(), ms: Date.now() - writeStart },
    risk: {
      totalEquityUsd: risk.totalEquityUsd,
      dailyPnlPct: risk.dailyPnlPct,
      dailyDdFromPeakPct: risk.dailyDdFromPeakPct,
      openPositionsCount: risk.openPositionsCount,
      entriesInWindow: (risk as any).entriesInWindow,
      inFundingWindow: risk.inFundingWindow,
      btcStale,
    },
    pairs: views,
  };
  fs.writeFileSync('/tmp/per-pair-state.json', JSON.stringify(out, null, 2));

  // Human table
  console.log(`\n==== per-pair X-ray @ ${out.cycle.iso}  (btcTrend ${btcStale ? 'STALE→disabled' : 'fresh'}) ====`);
  console.log(`equity $${risk.totalEquityUsd.toFixed(0)}  dayPnL ${risk.dailyPnlPct.toFixed(2)}%  open ${risk.openPositionsCount}  entriesInWindow ${(risk as any).entriesInWindow}\n`);
  for (const v of views) {
    console.log(`${v.pair.padEnd(9)} [${v.strategy}] thr ${v.pctLo}/${v.pctHi}  price ${v.price4hAnchor?.toFixed(4) ?? '—'}  ATR ${v.atr14?.toFixed(4) ?? '—'}`);
    for (const s of v.signals) {
      if (s.currentPct == null) {
        console.log(`   ${s.name.padEnd(20)} cur ${s.current ?? '—'}  pct n/a (hist ${s.histLen})`);
      } else {
        const pctStr = (s.currentPct * 100).toFixed(1).padStart(5);
        console.log(`   ${s.name.padEnd(20)} cur ${String(s.current).padStart(10)}  pct ${pctStr}%  →short@${(s.shortAt*100).toFixed(0)}% (${s.distToShortPp!.toFixed(1)}pp)  →long@${(s.longAt*100).toFixed(0)}% (${s.distToLongPp!.toFixed(1)}pp)`);
      }
    }
    const trendStr = `pairEMA ${v.pairTrendUp === 'n/a' ? 'n/a' : v.pairTrendUp == null ? 'n/a' : v.pairTrendUp ? 'up' : 'down'}  btcEMA ${v.btcTrendUp === 'n/a' ? 'n/a' : v.btcTrendUp == null ? 'n/a' : v.btcTrendUp ? 'up' : 'down'}`;
    const cd = v.strategyCooldown.active ? `CD ${v.strategyCooldown.side} ${v.strategyCooldown.remainingMin}min` : 'CD none';
    const rg = v.riskGuardBlock ? `RG-BLOCK: ${v.riskGuardBlock}` : 'RG ok';
    console.log(`   trend[${trendStr}]  ${cd}  ${rg}`);
    console.log(`   => decide=${v.decide.toUpperCase()}  reason: ${v.holdReason}\n`);
  }

  await closePg();
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('per-pair-state failed:', e?.message ?? String(e), e?.stack);
    try { await closePg(); } catch {}
    process.exit(1);
  });
