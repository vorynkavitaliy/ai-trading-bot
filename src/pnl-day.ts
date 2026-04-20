#!/usr/bin/env npx tsx
/**
 * pnl-day.ts — single source of truth for daily P&L.
 *
 * Queries Bybit wallet balance for ALL sub-accounts, compares to a snapshot
 * taken at 00:00 UTC. Persisted snapshot lives in vault/state/balance-snapshots.json.
 *
 * Usage:
 *   npx tsx src/pnl-day.ts              — print current P&L vs today's 00:00 snapshot
 *   npx tsx src/pnl-day.ts --snapshot   — take a new snapshot (run once per day at 00:00 UTC)
 *   npx tsx src/pnl-day.ts --json       — machine-readable output
 *
 * Why this exists: my internal trade-file PnL math (entry-vs-exit × qty) ignores
 * fees (~$15-30 per round-trip across 2 subs), funding clips, slippage. Bybit
 * equity is the single source of truth. Use this, never back-of-envelope math.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { AccountManager } from "./core/account-manager.js";
import { BybitClient } from "./core/bybit-client.js";

const SNAPSHOT_PATH = "/root/Projects/ai-trading-bot/vault/state/balance-snapshots.json";

type Snapshot = {
  date: string;
  taken_at: string;
  balances: Record<string, { equity: number; wallet: number; upl: number }>;
};

type SnapshotFile = Record<string, Snapshot>;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadSnapshots(): SnapshotFile {
  if (!existsSync(SNAPSHOT_PATH)) return {};
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
}

function saveSnapshots(data: SnapshotFile) {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(data, null, 2));
}

async function getLiveBalances() {
  const mgr = new AccountManager();
  const client = new BybitClient(mgr);
  const wallets = await client.getAllWallets();
  const balances: Record<string, { equity: number; wallet: number; upl: number }> = {};
  for (const { sub, wallet } of wallets) {
    balances[sub.label] = {
      equity: parseFloat(wallet.equity),
      wallet: parseFloat(wallet.totalWalletBalance),
      upl: parseFloat(wallet.unrealisedPnl),
    };
  }
  return balances;
}

async function main() {
  const mode = process.argv[2] || "";
  const json = process.argv.includes("--json");
  const today = todayUTC();
  const all = loadSnapshots();

  const live = await getLiveBalances();

  if (mode === "--snapshot") {
    all[today] = {
      date: today,
      taken_at: new Date().toISOString(),
      balances: live,
    };
    saveSnapshots(all);
    if (json) {
      console.log(JSON.stringify(all[today], null, 2));
    } else {
      console.log(`✅ Snapshot taken for ${today}:`);
      for (const [label, b] of Object.entries(live)) {
        console.log(`  ${label}: equity=$${b.equity.toFixed(2)} wallet=$${b.wallet.toFixed(2)} upl=$${b.upl.toFixed(2)}`);
      }
    }
    return;
  }

  const start = all[today];
  if (!start) {
    console.log(`⚠️  No snapshot for ${today}. Take one:\n  npx tsx src/pnl-day.ts --snapshot`);
    console.log(`\nCurrent balances (no baseline):`);
    for (const [label, b] of Object.entries(live)) {
      console.log(`  ${label}: equity=$${b.equity.toFixed(2)}`);
    }
    return;
  }

  type Row = { label: string; start: number; now: number; pnl: number; pnl_pct: number };
  const rows: Row[] = [];
  let total_start = 0;
  let total_now = 0;
  for (const label of Object.keys(live)) {
    const s = start.balances[label]?.equity ?? 0;
    const n = live[label].equity;
    rows.push({
      label,
      start: s,
      now: n,
      pnl: n - s,
      pnl_pct: s > 0 ? ((n - s) / s) * 100 : 0,
    });
    total_start += s;
    total_now += n;
  }

  const total_pnl = total_now - total_start;
  const total_pnl_pct = total_start > 0 ? (total_pnl / total_start) * 100 : 0;

  if (json) {
    console.log(
      JSON.stringify(
        { date: today, snapshot_at: start.taken_at, rows, total: { start: total_start, now: total_now, pnl: total_pnl, pnl_pct: total_pnl_pct } },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`=== P&L ${today} (since ${start.taken_at}) ===`);
  for (const r of rows) {
    const sign = r.pnl >= 0 ? "+" : "";
    console.log(`  ${r.label}: $${r.start.toFixed(2)} → $${r.now.toFixed(2)} = ${sign}$${r.pnl.toFixed(2)} (${sign}${r.pnl_pct.toFixed(2)}%)`);
  }
  const sign = total_pnl >= 0 ? "+" : "";
  console.log(`  TOTAL:  $${total_start.toFixed(2)} → $${total_now.toFixed(2)} = ${sign}$${total_pnl.toFixed(2)} (${sign}${total_pnl_pct.toFixed(2)}%)`);
}

main().catch((e) => {
  console.error("pnl-day failed:", e);
  process.exit(1);
});
