#!/usr/bin/env npx tsx
/**
 * scan-summary.ts — runs scan-data.ts, parses JSON, prints concise per-pair summary.
 * Replaces inline `node -e` heredoc (which fires permission prompt every cycle).
 *
 * Usage: npx tsx src/scan-summary.ts            (all pairs)
 *        npx tsx src/scan-summary.ts BTCUSDT    (single pair)
 */
import { execSync } from "node:child_process";

const arg = process.argv[2] || "all";

const raw = execSync(`npx tsx src/scan-data.ts ${arg}`, {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});
const start = raw.indexOf("{");
const json = JSON.parse(raw.slice(start));

console.log("generated_at:", json.generated_at);

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

const sd = json.symbols || [];

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
  // Expanded BOS line: 1h / 15m / 3m + close_vs_swing_15m
  console.log(
    `  BOS 1h=${ms.bos_1h} 15m=${ms.bos_15m} 3m=${ms.bos_3m} | close_vs_swing_15m=${ms.close_vs_swing_15m}`,
  );
  console.log(
    `  sweep=${ms.sweep ? JSON.stringify(ms.sweep) : "none"} | nearR=${kl.nearest_resistance} nearS=${kl.nearest_support}`,
  );
  if (btc.regime)
    console.log(
      `  BTC: regime=${btc.regime} eff_regime=${btc.effective_regime} 1h=${btc.trend1h} rsi1h=${btc.rsi1h} slope3=${btc.rsi_slope_3bars} slope1h=${btc.slope1h} chg1h=${btc.chg_20_1h_pct}% chg5_15m=${btc.chg_5_15m_pct}%`,
    );
  console.log(`  OB imb=${ob.imbalance} spread_bps=${ob.spread_bps}`);
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
