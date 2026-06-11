// Per-pair decision X-ray (v5 cgSlowFade edition, rewritten 2026-06-11 — the v4
// version showed NaN thresholds after the migration). For every enabled pair,
// surfaces the FULL internal state the live scan-decide path computes:
//   - the EXACT percentiles the strategy sees (lag-1 CG read, excluding-current
//     percentile, BTC source for btc-signal pairs) + distance to each trigger
//   - BTC EMA20/50 gate state for btc-trend pairs, shortsOnly marker
//   - the limit-entry geometry that WOULD be placed (entry ∓0.3·ATR, SL, TP)
//   - once-per-anchor latch state, risk-guard block reason
//   - the authoritative strategy.decide() result + the precise gate that held
//
// Reuses the EXACT live objects: buildContext from scan-decide (same anchor, same
// cgReadLagBars), the strategy instances from TIER1_PORTFOLIO, and the same
// indicator primitives — the numbers shown are the numbers the strategy decides on.
//
// Read-only. Writes /tmp/per-pair-state.json and prints a table.
//   npx tsx src/tools/diagnostics/per-pair-state.ts

import fs from 'node:fs';
import { close as closePg } from '../../core/db';
import { buildContext } from '../../runtime/scan-decide';
import { getStrategyForPair, tier1Pairs } from '../../runtime/pair-strategies';
import { CgSlowFade } from '../../strategies/cg-slow-fade';
import { CoinglassFeatures } from '../../data/coinglass-features';
import { atr, trendUp } from '../../core/indicators';
import { RiskManager } from '../../runtime/risk-guard';
import { getLiveTickers } from '../../core/bybit';
import { loadAccounts } from '../../core/accounts';
import { refreshForScan } from '../../data/backfill';
import { loadAll as loadCooldowns } from '../../core/strategy-cooldowns';
import { loadDecidedAnchors } from '../../core/decided-anchors';
import { loadBars as loadBarsCanonical } from '../../data/candles';
import { Bar } from '../../backtest/types';

interface SignalView {
  name: string;                  // e.g. 'ls_top_position (BTC)' for btc-signal pairs
  current: number | null;
  currentPct: number | null;     // percentile [0,1] — EXACT strategy semantics
  trigger: string;               // 'short@95 / long@5', 'short@95', 'liq-short@97'
  distToFirePp: number | null;   // pp to the NEAREST firing threshold of this signal
  histLen: number;
}

interface PairView {
  pair: string;
  mode: string;                  // none / trend / signal (+S-only)
  strategyName: string;
  price4hAnchor: number | null;
  livePrice: number | null;
  atr14: number | null;
  signals: SignalView[];
  impliedSide: 'long' | 'short' | null;
  btcTrendUp: boolean | null | 'n/a';
  trendBlocks: boolean;
  entryIfEnter: number | null;   // limit price (base ∓ offset·ATR)
  slIfEnter: number | null;
  tpIfEnter: number | null;
  anchorTs: number | null;
  anchorDecided: boolean;        // once-per-4H latch already consumed this anchor
  riskGuardBlock: string | null;
  decide: 'hold' | 'enter';
  holdReason: string;
  cgMissing: boolean;
}

// EXACT replica of the strategy's percentile: current vs trailing window
// EXCLUDING itself (cg-slow-fade.ts percentileExcludingCurrent).
function pctExcl(history: number[] | undefined, current: number | null | undefined, windowBars: number): { pct: number | null; histLen: number } {
  const histLen = history?.length ?? 0;
  if (!history || histLen < windowBars + 1 || current == null) return { pct: null, histLen };
  const window = history.slice(-(windowBars + 1), -1);
  let below = 0;
  for (const v of window) if (v <= current) below++;
  return { pct: below / window.length, histLen };
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
  const decidedAnchors = await loadDecidedAnchors();
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
    const strategy = getStrategyForPair(pair);
    if (!(strategy instanceof CgSlowFade)) {
      console.error(`${pair}: strategy is not CgSlowFade — skipping (tool supports v5 only)`);
      continue;
    }
    const p = strategy.p;
    const mode = `${p.btcMode}${p.shortsOnly ? '+S-only' : ''}`;
    const live = livePrices.get(pair) ?? null;
    const r = await buildContext(pair, nowTs, live, btcBars4h, cooldownState, strategy.cgReadLagBars ?? 0);

    if (!r.ctx) {
      views.push({
        pair, mode, strategyName: strategy.name,
        price4hAnchor: null, livePrice: live, atr14: null, signals: [], impliedSide: null,
        btcTrendUp: p.btcMode === 'trend' ? null : 'n/a', trendBlocks: false,
        entryIfEnter: null, slIfEnter: null, tpIfEnter: null,
        anchorTs: null, anchorDecided: false,
        riskGuardBlock: risk.pairBlocked[pair] ?? null,
        decide: 'hold', holdReason: `no-context: ${r.reason ?? 'unknown'}`, cgMissing: !!r.cgMissing,
      });
      continue;
    }

    const ctx = r.ctx;
    const own = ctx.coinglass as CoinglassFeatures | undefined;
    const btcCg = ctx.btcCoinglass as CoinglassFeatures | undefined;
    const a = atr(ctx.recentBars ?? [], p.atrPeriod);

    // Signal views — EXACT v5 sources: fade from BTC for btc-signal pairs, liq
    // always from the pair's OWN series. OR-triggers → nearest distance fires.
    const sentiment = p.btcMode === 'signal' ? btcCg : own;
    const srcTag = p.btcMode === 'signal' ? ' (BTC)' : '';
    const signals: SignalView[] = [];
    let impliedSide: 'long' | 'short' | null = null;

    if (sentiment) {
      const ls = pctExcl(sentiment.ls_top_position_history, sentiment.ls_top_position, p.windowBars);
      const f = pctExcl(sentiment.funding_oi_weighted_history, sentiment.funding_oi_weighted, p.windowBars);
      if (ls.pct != null && f.pct != null) {
        if (ls.pct >= p.lsPctHi || f.pct >= p.fundingPctHi) impliedSide = 'short';
        else if (ls.pct <= p.lsPctLo && !p.shortsOnly) impliedSide = 'long';
      }
      const lsDistShort = ls.pct != null ? Math.max(0, p.lsPctHi - ls.pct) * 100 : null;
      const lsDistLong = ls.pct != null && !p.shortsOnly ? Math.max(0, ls.pct - p.lsPctLo) * 100 : null;
      signals.push({
        name: `ls_top_position${srcTag}`,
        current: sentiment.ls_top_position, currentPct: ls.pct,
        trigger: p.shortsOnly ? `short@${p.lsPctHi * 100}` : `short@${p.lsPctHi * 100} / long@${p.lsPctLo * 100}`,
        distToFirePp: lsDistShort == null ? null : lsDistLong == null ? lsDistShort : Math.min(lsDistShort, lsDistLong),
        histLen: ls.histLen,
      });
      signals.push({
        name: `funding${srcTag}`,
        current: sentiment.funding_oi_weighted, currentPct: f.pct,
        trigger: `short@${p.fundingPctHi * 100}`,
        distToFirePp: f.pct != null ? Math.max(0, p.fundingPctHi - f.pct) * 100 : null,
        histLen: f.histLen,
      });
    }
    if (own) {
      const lq = pctExcl(own.liq_long_history, own.liq_long_history?.[own.liq_long_history.length - 1] ?? null, p.windowBars);
      signals.push({
        name: 'liq_long (own)',
        current: own.liq_long_history?.[own.liq_long_history.length - 1] ?? null, currentPct: lq.pct,
        trigger: `liq-short@${p.liqSpikePct * 100}`,
        distToFirePp: lq.pct != null ? Math.max(0, p.liqSpikePct - lq.pct) * 100 : null,
        histLen: lq.histLen,
      });
    }

    // BTC trend gate (ETH): EMA20/50 over closed BTC 4H bars — fade only; the liq
    // fallback bypasses it (v5 semantics).
    const btcCloses = (ctx.btcBars4hRecent ?? []).map(b => b.close);
    const btcEnough = (ctx.btcBars4hRecent ?? []).length >= p.emaSlow + 5;
    const btcUp = p.btcMode === 'trend' ? (btcEnough ? trendUp(btcCloses, p.emaFast, p.emaSlow) : null) : null;
    let trendBlocks = false;
    if (impliedSide && p.btcMode === 'trend') {
      if (btcUp == null) trendBlocks = true;
      else if (impliedSide === 'short' && btcUp) trendBlocks = true;
      else if (impliedSide === 'long' && !btcUp) trendBlocks = true;
    }

    // Limit-entry geometry that WOULD be placed (mirror of decide()).
    let entryIfEnter: number | null = null;
    let slIfEnter: number | null = null;
    let tpIfEnter: number | null = null;
    if (impliedSide && a != null && a > 0) {
      const dir = impliedSide === 'long' ? 1 : -1;
      const base = ctx.livePrice ?? ctx.price;
      entryIfEnter = base - dir * p.entryOffsetAtr * a;
      slIfEnter = entryIfEnter - dir * p.slAtrMult * a;
      tpIfEnter = entryIfEnter + dir * p.tpAtrMult * a;
    }

    const anchorTs = r.anchorTs ?? null;
    const anchorDecided = anchorTs != null && decidedAnchors.get(pair) === anchorTs;

    // Authoritative decision + precise hold reason.
    const action = strategy.decide(ctx);
    let holdReason: string;
    let riskGuardBlock: string | null = risk.pairBlocked[pair] ?? null;
    if (action.kind === 'enter') {
      const rc = await riskManager.precheck(pair, action.sizePct);
      riskGuardBlock = rc.allowed ? null : (rc.reason ?? 'blocked');
      const latchNote = anchorDecided ? ' [латч: якорь уже решён — cron повторно НЕ войдёт до новой границы]' : '';
      holdReason = rc.allowed
        ? `🟢 ENTER ${action.side?.toUpperCase()} — risk-guard ALLOWED${latchNote}`
        : `ENTER ${action.side?.toUpperCase()} signal — BLOCKED by risk-guard: ${rc.reason}${latchNote}`;
    } else if (!own) {
      holdReason = 'no-coinglass';
    } else if (!impliedSide) {
      const dists = signals.map(s => s.distToFirePp).filter((d): d is number => d != null);
      holdReason = dists.length > 0
        ? `percentile-neutral (ближайший триггер в ${Math.min(...dists).toFixed(1)}pp)`
        : 'percentile-neutral (signal data short)';
    } else if (trendBlocks) {
      holdReason = `btc-trend gate blocks ${impliedSide} (BTC EMA ${btcUp == null ? 'n/a' : btcUp ? 'up' : 'down'}); liq-нога гейт обходит`;
    } else if (p.shortsOnly && impliedSide === 'long') {
      holdReason = 'shortsOnly — покупка отброшена';
    } else if (a == null || a <= 0) {
      holdReason = 'no-atr';
    } else {
      holdReason = 'hold (unexpected — signal passes but decide=hold)';
    }

    views.push({
      pair, mode, strategyName: strategy.name,
      price4hAnchor: ctx.price, livePrice: live, atr14: a,
      signals, impliedSide,
      btcTrendUp: p.btcMode === 'trend' ? btcUp : 'n/a',
      trendBlocks,
      entryIfEnter, slIfEnter, tpIfEnter,
      anchorTs, anchorDecided,
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
  console.log(`\n==== per-pair X-ray (v5) @ ${out.cycle.iso}  (btcTrend ${btcStale ? 'STALE→disabled' : 'fresh'}) ====`);
  console.log(`equity $${risk.totalEquityUsd.toFixed(0)}  dayPnL ${risk.dailyPnlPct.toFixed(2)}%  open ${risk.openPositionsCount}/4  entriesInWindow ${(risk as any).entriesInWindow}\n`);
  for (const v of views) {
    const anchorStr = v.anchorTs ? new Date(v.anchorTs).toISOString().slice(5, 16).replace('T', ' ') : '—';
    console.log(`${v.pair.padEnd(9)} [${v.mode}]  anchor ${anchorStr} ${v.anchorDecided ? '(решён)' : '(новый)'}  price ${v.price4hAnchor?.toFixed(4) ?? '—'}  live ${v.livePrice?.toFixed(4) ?? '—'}  ATR ${v.atr14?.toFixed(4) ?? '—'}`);
    for (const s of v.signals) {
      if (s.currentPct == null) {
        console.log(`   ${s.name.padEnd(22)} cur ${s.current ?? '—'}  pct n/a (hist ${s.histLen})`);
      } else {
        const pctStr = (s.currentPct * 100).toFixed(1).padStart(5);
        console.log(`   ${s.name.padEnd(22)} cur ${String(s.current).slice(0, 10).padStart(10)}  pct ${pctStr}%  ${s.trigger}  (до огня ${s.distToFirePp!.toFixed(1)}pp)`);
      }
    }
    if (v.entryIfEnter != null) {
      console.log(`   would-place LIMIT ${v.impliedSide?.toUpperCase()}: entry ${v.entryIfEnter.toFixed(4)}  SL ${v.slIfEnter!.toFixed(4)}  TP ${v.tpIfEnter!.toFixed(4)}  TTL 230м`);
    }
    const rg = v.riskGuardBlock ? `RG-BLOCK: ${v.riskGuardBlock}` : 'RG ok';
    const btcT = v.btcTrendUp === 'n/a' ? '' : `  btcEMA ${v.btcTrendUp == null ? 'n/a' : v.btcTrendUp ? 'up' : 'down'}`;
    console.log(`   ${rg}${btcT}`);
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
