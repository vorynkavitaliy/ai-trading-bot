// Live audit: what data is the running cycle ACTUALLY using?
// Reads /tmp/scan-decide-latest.json and DB, reports what's populated vs null.
import fs from 'node:fs';
import { query, close as closePg } from '../lib/db';

async function main() {
  console.log('═'.repeat(72));
  console.log('LIVE AUDIT — what does the running cycle actually use?');
  console.log('═'.repeat(72));

  // 1) scan-decide latest output
  const j = JSON.parse(fs.readFileSync('/tmp/scan-decide-latest.json', 'utf-8'));
  console.log(`\n📊 LAST CYCLE: ${j.cycle.iso}`);
  console.log(`   actionable: ${j.enterCount}`);

  // BTC global context — used as enrichment for all alts
  console.log(`\n🅱 BTC CONTEXT (cycle-wide):`);
  if (j.btcContext) {
    const b = j.btcContext;
    console.log(`   price: $${b.price?.toFixed(0)}  RSI1h: ${b.rsi1h?.toFixed(1)}  ADX1h: ${b.adx1h?.toFixed(1)}`);
    console.log(`   EMA stack 1h: ${b.ema_stack_1h ?? 'null'}  4h: ${b.ema_stack_4h ?? 'null'}`);
    console.log(`   PWL: $${b.pwl?.toFixed(0)} (${b.distancePctToPWL?.toFixed(2)}%)  PWH: $${b.pwh?.toFixed(0)} (${b.distancePctToPWH?.toFixed(2)}%)`);
    console.log(`   funding-OI: ${b.fundingOiWeighted}  OI Δ24h: ${b.oiPctChg24h?.toFixed(2)}%`);
  } else {
    console.log('   ❌ NULL — BTC context not built');
  }

  // 2) per-pair: what features and Coinglass are populated
  console.log(`\n🔬 PER-PAIR FEATURES & COINGLASS (just first decision):`);
  const sample = j.decisions[0];
  if (sample) {
    console.log(`   ${sample.symbol} — action=${sample.action}, price=${sample.price}`);
    if (sample.enrichment) {
      const e = sample.enrichment;
      console.log(`   MTF features: ${e.mtf.length} timeframes`);
      for (const m of e.mtf) {
        const tag = m.rsi != null ? '✅' : '❌';
        console.log(`     ${tag} ${m.tf.padEnd(5)}  RSI=${m.rsi?.toFixed(1) ?? 'null'}  ADX=${m.adx?.toFixed(1) ?? 'null'}  EMA-stack=${m.ema_stack ?? 'null'}`);
      }
      console.log(`   Structural: POC=${e.structural.poc?.toFixed(2)}  VAL=${e.structural.val?.toFixed(2)}  VAH=${e.structural.vah?.toFixed(2)}`);
      console.log(`               PWL=${e.structural.pwl?.toFixed(2)}  PWH=${e.structural.pwh?.toFixed(2)}`);
      const c = e.coinglass;
      if (c) {
        console.log(`   Coinglass:  funding=${c.funding_oi_weighted}  LS-top=${c.ls_top_position}  taker-Δ=${c.taker_delta_24h_usd}`);
      } else {
        console.log(`   Coinglass: NULL (no data for this pair)`);
      }
    }
  } else {
    console.log('   no decisions in last cycle');
  }

  // 3) Coinglass freshness — what pairs have data, how stale
  console.log(`\n🪙 COINGLASS DB STATE:`);
  const cgTables = [
    'cg_oi_aggregated',
    'cg_funding_oi_weighted',
    'cg_funding_vol_weighted',
    'cg_ls_top_position',
    'cg_liq_pair',
    'cg_taker_pair',
  ];
  for (const tbl of cgTables) {
    // Tables ending in _pair use 'pair' column; coin-aggregated tables use 'symbol'.
    // Keys: cg_liq_pair, cg_taker_pair, cg_ls_*_pair use 'pair'.
    const isPair = tbl.includes('_pair') || tbl.includes('_ls_');
    const idCol = isPair ? 'pair' : 'symbol';
    const r = await query<any>(
      `SELECT ${idCol} AS sym, MAX(ts)::text AS last_ts, COUNT(*)::int AS rows
       FROM ${tbl} GROUP BY ${idCol} ORDER BY ${idCol}`
    ).catch((e: any) => { console.log(`     ❌ ${tbl} query error: ${e.message}`); return { rows: [] }; });
    if (r.rows.length === 0) {
      console.log(`   ${tbl.padEnd(28)} ❌ no data`);
      continue;
    }
    console.log(`   ${tbl}:`);
    for (const row of r.rows) {
      const lastTs = parseInt(row.last_ts, 10);
      const ageHours = (Date.now() - lastTs) / 3_600_000;
      const tag = ageHours < 6 ? '✅' : ageHours < 24 ? '⚠ ' : '❌';
      console.log(`     ${tag} ${row.sym.padEnd(10)}  rows=${String(row.rows).padStart(5)}  age=${ageHours.toFixed(1)}h`);
    }
  }

  // 4) Universe coverage — which pairs have what
  console.log(`\n🌐 UNIVERSE (13 pairs) — Coinglass coverage:`);
  const universe = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'LTCUSDT', 'LINKUSDT', 'ATOMUSDT', 'SUIUSDT', 'TONUSDT', 'DOGEUSDT', 'APTUSDT', 'ARBUSDT'];
  for (const sym of universe) {
    const coin = sym.replace(/USDT$/, '');
    const fr = await query<any>(`SELECT COUNT(*)::int AS c FROM cg_funding_oi_weighted WHERE symbol = $1`, [coin]);
    const oi = await query<any>(`SELECT COUNT(*)::int AS c FROM cg_oi_aggregated WHERE symbol = $1`, [coin]);
    const lsT = await query<any>(`SELECT COUNT(*)::int AS c FROM cg_ls_top_position WHERE pair = $1`, [sym]).catch(() => ({ rows: [{ c: 0 }] }));
    const has = (n: number) => n > 0 ? '✅' : '❌';
    console.log(`   ${sym.padEnd(10)}  funding=${has(fr.rows[0].c)}${String(fr.rows[0].c).padStart(5)}  OI=${has(oi.rows[0].c)}${String(oi.rows[0].c).padStart(5)}  LS-top=${has(lsT.rows[0].c)}${String(lsT.rows[0].c).padStart(5)}`);
  }

  await closePg();
}

main().catch(async (e) => {
  console.error(e);
  try { await closePg(); } catch {}
  process.exit(1);
});
