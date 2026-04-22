#!/usr/bin/env npx tsx
/**
 * scan-summary.ts — runs scan-data.ts, parses JSON, prints concise per-pair summary.
 * Replaces inline `node -e` heredoc (which fires permission prompt every cycle).
 *
 * Usage: npx tsx src/scan-summary.ts            (all pairs)
 *        npx tsx src/scan-summary.ts BTCUSDT    (single pair)
 *
 * Phase 2 addition: parses vault/Watchlist/zones.md and emits a ZONES: line
 * per symbol with in_zone / swept_15m / nearby-zone info. This drives the
 * alert-driven cadence — /loop 3m fires the full rubric only when price is
 * inside a pre-committed zone or a zone was swept in the last 15m candles.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tick as cycleTick, nudgeDue } from "./cycle-counter";

const arg = process.argv[2] || "all";

// Tick cycle counter FIRST — anti-hallucination /clear nudge mechanism.
// See CLAUDE.md § Clear Protocol. Threshold 40 cycles (~2h at /loop 3m).
const cycle = cycleTick();

const raw = execSync(`npx tsx src/scan-data.ts ${arg}`, {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});
const start = raw.indexOf("{");
const json = JSON.parse(raw.slice(start));

console.log("generated_at:", json.generated_at);
if (nudgeDue(cycle)) {
  console.log(
    `CYCLE: ${cycle.total} (${cycle.since_clear} since last /clear) — 🧹 CLEAR RECOMMENDED (threshold ${cycle.nudge_threshold})`,
  );
} else {
  console.log(
    `CYCLE: ${cycle.total} (${cycle.since_clear}/${cycle.nudge_threshold} since last /clear)`,
  );
}

// === Cross-pair structure aggregator (Variant 2: implicit BOS) ===
const cps = json.cross_pair_structure;
if (cps) {
  console.log("\n=== cross_pair_structure ===");
  console.log(
    `  15M close<prior_low: ${cps.breakdown_count}/${cps.total_pairs} [${(cps.breakdown_pairs || []).join(",")}]`,
  );
  console.log(
    `  15M close>prior_high: ${cps.breakout_count}/${cps.total_pairs} [${(cps.breakout_pairs || []).join(",")}]`,
  );
  console.log(
    `  bos_15m bearish: ${cps.bos_15m_bearish_count}/${cps.total_pairs} [${(cps.bos_15m_bearish_pairs || []).join(",")}]`,
  );
  console.log(
    `  bos_15m bullish: ${cps.bos_15m_bullish_count}/${cps.total_pairs} [${(cps.bos_15m_bullish_pairs || []).join(",")}]`,
  );
  console.log(
    `  bos_1h  bearish/bullish: ${cps.bos_1h_bearish_count}/${cps.bos_1h_bullish_count}`,
  );
  console.log(
    `  EFFECTIVE: bearish=${cps.effective_bearish} bullish=${cps.effective_bullish}`,
  );
}

// === Zones loader — reads vault/Watchlist/zones.md tolerantly ===
type Zone = {
  type: string;
  level: number;
  side: string;
  created_at: string;
  invalidation: string;
  notes: string;
};

function loadZones(): Map<string, Zone[]> {
  const zonesBySymbol = new Map<string, Zone[]>();
  const zonesPath = path.join(
    process.cwd(),
    "vault",
    "Watchlist",
    "zones.md",
  );
  let text: string;
  try {
    text = fs.readFileSync(zonesPath, "utf8");
  } catch {
    return zonesBySymbol; // missing file → empty map, scan still runs
  }

  // Drop everything below "## Resolved zones" (only keep active zones).
  const activeCut = text.search(/^##\s+Resolved zones/im);
  const activeText = activeCut > 0 ? text.slice(0, activeCut) : text;

  // Split into "### SYMBOL" sections under "## Active zones".
  const activeStart = activeText.search(/^##\s+Active zones/im);
  const sectionText = activeStart >= 0 ? activeText.slice(activeStart) : activeText;

  const sectionRe = /^###\s+([A-Z0-9]+)\s*$/gm;
  const matches: Array<{ symbol: string; offset: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(sectionText)) !== null) {
    matches.push({ symbol: m[1], offset: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const { symbol, offset } = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].offset : sectionText.length;
    const block = sectionText.slice(offset, end);
    const zones: Zone[] = [];
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) continue;
      if (trimmed.startsWith("|---") || trimmed.startsWith("| ---")) continue;
      // Header row has "| type |"
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length < 5) continue;
      if (cells[0] === "type") continue; // header row
      const level = parseFloat(cells[1]);
      if (!isFinite(level)) continue;
      zones.push({
        type: cells[0],
        level,
        side: cells[2],
        created_at: cells[3] || "",
        invalidation: cells[4] || "",
        notes: cells[5] || "",
      });
    }
    if (zones.length) zonesBySymbol.set(symbol, zones);
  }
  return zonesBySymbol;
}

const zonesBySymbol = loadZones();

// Zone activity detection per symbol.
// in_zone  — any zone within 0.2% of current price (tight touch)
// near_zones — zones within 0.5% of price, sorted by proximity
// swept_15m — any zone was crossed + rejected (wick beyond, close back) in last 15m bars
function detectZoneActivity(
  symbol: string,
  price: number,
  klines15m: Array<[number, number, number, number, number, number]>,
): {
  in_zone: Array<Zone & { distance_pct: number }>;
  near: Array<Zone & { distance_pct: number }>;
  swept: Array<Zone & { swept_bars_ago: number }>;
  has_any: boolean;
} {
  const zones = zonesBySymbol.get(symbol) || [];
  if (!zones.length || !isFinite(price) || price <= 0) {
    return { in_zone: [], near: [], swept: [], has_any: false };
  }
  const in_zone: Array<Zone & { distance_pct: number }> = [];
  const near: Array<Zone & { distance_pct: number }> = [];
  const swept: Array<Zone & { swept_bars_ago: number }> = [];

  // Recent 15m bars for sweep check (use last up to 4 bars = ~1h window).
  const recent = (klines15m || []).slice(-4);

  for (const z of zones) {
    const distPct = Math.abs(price - z.level) / z.level * 100;
    const enriched = { ...z, distance_pct: Number(distPct.toFixed(3)) };
    if (distPct <= 0.2) in_zone.push(enriched);
    if (distPct <= 0.5) near.push(enriched);

    // Sweep: within last N 15m bars, wick crossed the level but close returned
    // to the pre-zone side. Bullish sweep of support: low < level, close > level.
    // Bearish sweep of resistance: high > level, close < level.
    for (let i = 0; i < recent.length; i++) {
      const bar = recent[i];
      if (!bar || bar.length < 5) continue;
      const high = bar[2];
      const low = bar[3];
      const close = bar[4];
      const sweptBullish = low < z.level && close > z.level;
      const sweptBearish = high > z.level && close < z.level;
      if (sweptBullish || sweptBearish) {
        swept.push({ ...z, swept_bars_ago: recent.length - 1 - i });
        break;
      }
    }
  }
  near.sort((a, b) => a.distance_pct - b.distance_pct);
  return {
    in_zone,
    near,
    swept,
    has_any: in_zone.length > 0 || swept.length > 0,
  };
}

const sd = json.symbols || [];
let anyZoneActivity = false;
const pairsWithActivity: string[] = [];

for (const d of sd) {
  if (!d || !d.indicators) continue;
  const ind = d.indicators;
  const r = ind.rsi || {};
  const macd = ind.macd1h || {};
  const adx = ind.adx1h || {};
  const obv = ind.obv1h || {};
  const ema = ind.ema || {};
  const ms = d.market_structure || {};
  const kl = ms.key_levels || {};
  const btc = d.btc_context || {};
  const ob = d.orderbook || {};

  console.log(`\n[${d.symbol}] px=${d.price}`);
  console.log(
    `  RSI 4h=${r["4h"]} 1h=${r["1h"]} 15m=${r["15m"]} 3m=${r["3m"]} | slope1h=${ind.rsi_slope_1h?.toFixed(2)}`,
  );
  console.log(
    `  EMA1h 21=${ema["1h_21"]?.toFixed(4)} 55=${ema["1h_55"]?.toFixed(4)}`,
  );
  console.log(
    `  ADX=${adx.adx?.toFixed(1)} PDI=${adx.pdi?.toFixed(1)} MDI=${adx.mdi?.toFixed(1)} | MACD1h hist=${macd.histogram} (tiebreaker)`,
  );
  console.log(`  OBV slope10=${obv.slope_10?.toFixed(0)}`);
  // Leading signals — less lag than RSI/MACD/OBV, fed by Phase 1 refactor
  const st = ind.stoch_15m || {};
  const foi = d.funding_oi || {};
  const fPct = foi.funding_rate !== null && foi.funding_rate !== undefined
    ? (foi.funding_rate * 100).toFixed(4) + "%"
    : "null";
  const fDelta = foi.funding_delta_1h !== null && foi.funding_delta_1h !== undefined
    ? (foi.funding_delta_1h > 0 ? "+" : "") + (foi.funding_delta_1h * 100).toFixed(4) + "%"
    : "null";
  const oiDelta = foi.oi_delta_1h_pct !== null && foi.oi_delta_1h_pct !== undefined
    ? (foi.oi_delta_1h_pct > 0 ? "+" : "") + foi.oi_delta_1h_pct.toFixed(2) + "%"
    : "null";
  const accel = ind.rsi_slope_accel_1h !== null && ind.rsi_slope_accel_1h !== undefined
    ? (ind.rsi_slope_accel_1h > 0 ? "+" : "") + ind.rsi_slope_accel_1h.toFixed(3)
    : "null";
  console.log(
    `  LEAD: funding=${fPct} Δ1h=${fDelta} | OI Δ1h=${oiDelta} | stoch15m k=${st.k ?? "null"}/d=${st.d ?? "null"} | rsi_accel1h=${accel}`,
  );

  // FLOW line — CVD + top-5 orderbook imbalance (Phase 3 leading signal).
  // CVD > 0 / divergence=bullish = net taker-buy absorption; leads price.
  const of = d.orderflow;
  if (!of) {
    console.log(`  FLOW: (unavailable)`);
  } else {
    // Signed USD formatter: "+$420k" / "-$1.80M". For unsigned (book depth), strip sign.
    const fmtSigned = (n: number) => {
      const abs = Math.abs(n);
      const sign = n >= 0 ? "+" : "-";
      if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
      if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
      return `${sign}$${abs.toFixed(0)}`;
    };
    const fmtAbs = (n: number) => fmtSigned(n).replace(/^[+-]/, "");
    const c1 = of.cvd_1m;
    const c5 = of.cvd_5m;
    const ob5 = of.obi_top5;
    const obStr = ob5
      ? `OBI5 ${ob5.obi >= 0 ? "+" : ""}${ob5.obi} (bid ${fmtAbs(ob5.bid_usd)} / ask ${fmtAbs(ob5.ask_usd)})`
      : "OBI5 n/a";
    console.log(
      `  FLOW: CVD1m ${fmtSigned(c1.cvd_usd)} (div: ${c1.divergence}, ${c1.trades}t) | CVD5m ${fmtSigned(c5.cvd_usd)} (div: ${c5.divergence}) | ${obStr}`,
    );
  }

  // Expanded BOS line: 1h / 15m / 3m + close_vs_swing_15m
  console.log(
    `  BOS 1h=${ms.bos_1h} 15m=${ms.bos_15m} 3m=${ms.bos_3m} | close_vs_swing_15m=${ms.close_vs_swing_15m}`,
  );
  console.log(
    `  sweep=${ms.sweep ? JSON.stringify(ms.sweep) : "none"} | nearR=${kl.nearest_resistance} nearS=${kl.nearest_support}`,
  );
  if (ms.prior_day_utc) {
    console.log(
      `  prior_day_utc(${ms.prior_day_utc.date}): H=${ms.prior_day_utc.high} L=${ms.prior_day_utc.low} (${ms.prior_day_utc.bar_count} bars)`,
    );
  } else {
    console.log(`  prior_day_utc: insufficient 1H history`);
  }
  if (btc.regime) {
    console.log(
      `  BTC: regime=${btc.regime} 1h=${btc.trend1h} rsi1h=${btc.rsi1h} slope3=${btc.rsi_slope_3bars} slope1h=${btc.slope1h} chg1h=${btc.chg_20_1h_pct}% chg5_15m=${btc.chg_5_15m_pct}%`,
    );
    if (btc.hmm_regime) {
      const hr = btc.hmm_regime;
      const probs = hr.probs || {};
      // Sort the three state labels by probability descending to show top + next.
      const entries = (['bull', 'range', 'bear'] as const)
        .map((s) => ({ s, p: Number(probs[s] ?? 0) }))
        .sort((a, b) => b.p - a.p);
      const top = entries[0];
      const nxt = entries[1];
      console.log(
        `  BTC HMM: ${top.s} (${Math.round(top.p * 100)}%) | next-highest: ${nxt.s} (${Math.round(nxt.p * 100)}%) | transitioning: ${hr.transitioning ? 'yes' : 'no'}`,
      );
    } else {
      console.log(
        `  BTC HMM: (unavailable — run \`npm run train-hmm\` to fit params)`,
      );
    }
  }
  console.log(`  OB imb=${ob.imbalance} spread_bps=${ob.spread_bps}`);

  // ZONES line — alert-driven cadence trigger.
  const price = Number(d.price);
  const klines15m = (d.klines && d.klines["15m"] && d.klines["15m"].last) || [];
  if (!zonesBySymbol.has(d.symbol)) {
    console.log(`  ZONES: (no zones defined)`);
  } else {
    const z = detectZoneActivity(d.symbol, price, klines15m);
    if (z.has_any) {
      anyZoneActivity = true;
      pairsWithActivity.push(d.symbol);
    }
    const inZoneStr = z.in_zone.length
      ? z.in_zone
          .map((x) => `${x.type} ${x.level} | ${x.distance_pct}% away | ${x.side}`)
          .join("; ")
      : "none";
    const sweptStr = z.swept.length
      ? z.swept
          .map((x) => `${x.type} ${x.level} (${x.swept_bars_ago}b ago)`)
          .join("; ")
      : "false";
    const nearStr = z.near.length
      ? z.near
          .slice(0, 3)
          .map((x) => {
            const sign = x.level >= price ? "+" : "-";
            return `${x.type} ${x.level} (${sign}${x.distance_pct}%)`;
          })
          .join(", ")
      : "none";
    console.log(
      `  ZONES: in_zone=${z.in_zone.length ? "true" : "false"}${z.in_zone.length ? ` (${inZoneStr})` : ""} | swept_15m=${z.swept.length ? "true" : "false"}${z.swept.length ? ` (${sweptStr})` : ""} | near: ${nearStr}`,
    );
  }

  const pos = d.open_positions || [];
  const pen = d.pending_orders || [];
  if (pos.length) console.log(`  POS:`, JSON.stringify(pos));
  if (pen.length) console.log(`  PEND:`, JSON.stringify(pen));
}

const first = sd[0];
if (first?.session)
  console.log("\n=== session ===", JSON.stringify(first.session));
if (first?.news)
  console.log(
    "=== news ===",
    JSON.stringify({
      bias: first.news.bias,
      impact: first.news.impact,
      mult: first.news.risk_multiplier,
      triggers: first.news.triggers,
    }),
  );
console.log("=== global_risk ===", JSON.stringify(json.global_risk));

// === Action hint — conditional on zone activity or open positions ===
const openPairs: string[] = [];
for (const d of sd) {
  if ((d.open_positions || []).length || (d.pending_orders || []).length) {
    openPairs.push(d.symbol);
  }
}
if (openPairs.length || anyZoneActivity) {
  const reasons: string[] = [];
  if (openPairs.length) reasons.push(`open positions/orders on [${openPairs.join(",")}]`);
  if (anyZoneActivity) reasons.push(`zone activity on [${pairsWithActivity.join(",")}]`);
  console.log(`\nACTION: run 12-factor rubric — ${reasons.join(" + ")}`);
} else {
  console.log(
    `\nACTION: no zone activity, no open positions — heartbeat only, skip rubric (log one-line journal entry).`,
  );
}
