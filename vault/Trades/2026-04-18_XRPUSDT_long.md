---
symbol: XRPUSDT
direction: long
status: closed
opened: 2026-04-18T07:03:18Z
closed: 2026-04-18T07:06:17Z
entry: 1.4724
sl: 1.4601
tp: 1.4909
exit: 1.4688
size_usd: 149644
leverage: 10
risk_r: 0.5
confluence_score: 6
confluence_type: structural
regime: bull
session: london
btc_state_at_entry: transitional
news_multiplier: 1.0
trade_category: structural-entry
thesis_snapshot: "XRP L:6/8 S:4/8 в Bull regime на London open, structural-entry threshold. R:R 1.5 trigger. DOGE уже открыт параллельно — корреляция high."
expected_duration: intraday
closed_reason: proactive-exit
r_multiple: -0.30
fees_usd: ~60
pnl_usd: -376.02
note: "CORRECTION: оба аккаунта заполнились (50k + 200k). Предыдущий тезис 'silent fail' был ошибочен — я неверно прочитал reconcile output. Proactive-exit TypeScript layer закрыл через 2m 59s на signal collapse."
---

# XRPUSDT LONG — 2026-04-18 (London open +3min)

## Why This Trade (at entry)

Второй trade дня. На следующем цикле после DOGE fill scanner выдал XRP L:6/8 S:4/8. 6/8 = structural-entry threshold (выше стандартного 5/8), R:R 1.5 triggered механически. Вчера XRP торговал 2 раза (оба breakeven-scratch) — сегодня scanner снова дал сигнал на том же pair в Bull regime.

- **Setup type:** structural-entry — 6/8 threshold = более сильный setup чем DOGE's 5/8
- **Primary factor:** R:R 1.5 + 6/8 score в Bull regime
- **Confluence breakdown (L:6/8 S:4/8):**
  - SMC/Structure: 1-2 (possibly sweep+OB)
  - Technical: 1
  - Volume: 1
  - Multi-TF + BTC: 0 или 1 (BTC Transitional)
  - Regime + BTC: 1
  - News/Macro: 1
  - Momentum: 1
  - Volatility: 0 или 1
- **CAUTION:** SHORT также 4/8 — это ТОЧНО threshold для early-exit. Позиция на грани противоречивого сигнала. Наблюдать агрессивно.
- **Why this R:R:** TP 1.4909 — структурный 1H уровень, SL 1.4601 — 1.0×ATR ниже + структурный buffer. R:R = 1.5.

## Entry Context

- **Time:** 2026-04-18 07:03 UTC
- **Session:** London (07:00-13:00 UTC), multiplier 1.0
- **BTC state:** Transitional (Thesis stable)
- **Regime on this pair:** Bull
- **Relevant news:** Без high-impact flags. Risk-on carry continues.

## Plan at Entry

- **Entry price:** 1.4725 (market fill)
- **SL price:** 1.4601 (ATR-based + structural)
- **TP price:** 1.4909 (1H resistance)
- **Size:** 20325.2 XRP on 50k account (~$29,929 notional @ 10x lev → ~$2,993 margin, risk ~$252 = 0.5% of 50k)
- **Accounts filled:** 50k ONLY. 200k silent fail — THIRD TIME (XRP #2 yesterday, DOGE 3 min ago, now XRP). Pattern confirmed.
- **Risk USD:** ~$252 on 50k
- **Expected profit at TP:** 1.5R ≈ $378
- **Max hold:** intraday. London-NY window: 6-15h of liquid trading.

## Portfolio view

- DOGE LONG (5/8, R:R 1.5) + XRP LONG (6/8, R:R 1.5) = 2 positions, both alt longs, both Bull regime. Correlation risk HIGH (alt-leading pack).
- Total heat: ~$507 (DOGE 255 + XRP 252) = ~1% of 50k. Under 5% cap. ✅
- Directional: 100% long in Bull regime = fine.
- If BTC flips Bear or either position hits SHORT 4/8 AND opposite — early-exit protocol.

## Life of Trade (updates during hold)

### [2026-04-18 07:03 UTC] — Opened
- R current: 0R (entry fill)
- Structural health: intact but S:4/8 already elevated — watch for 5/8 escalation
- Action taken: none
- Note: Second trade London open. Scanner fired 6/8 structural on XRP 3 min after DOGE. Correlation exposure high but heat still low.

### [2026-04-18 07:06 UTC] — ⚠ Signal collapse 6→4 + TypeScript proactive-exit fired
- Mark: 1.4688
- R current: ~-0.3R (~-$376 на двух аккаунтах)
- **Structural: DEGRADED. L:6/8 → 4/8. S:3/8 → 4/8. dir=None.** Signal collapsed in 1 cycle after entry.
- TypeScript layer proactive-exit triggered at 07:06:17 — закрыл market ДО того как я дочитал scan output.
- Claude (я) был в процессе анализа applying own 2-cycle rule → не успел среагировать.
- Action: closed by system. ✅ Correct decision — code was faster than me.

---

## Close Summary

- **Closed at:** 2026-04-18 07:06:17 UTC
- **Exit price:** 1.4688 (market close by system proactive-exit)
- **Reason:** proactive-exit (mechanical layer detected signal collapse 6/8 → 4/8 + opposite direction reaching threshold)
- **R multiple:** -0.30R
- **Gross PnL USD:** -376.02 (oба аккаунта 50k + 200k)
- **Fees USD:** ~60 (estimated 0.04% round-trip on $149k notional)
- **Net PnL USD:** -376.02 total
- **Duration:** 2m 59s

## Immediate Takeaway

**Process outcome: mixed.** Entry was mechanically correct (6/8 + R:R 1.5 = valid fire), but timing was atrocious — signal peaked AT entry, collapsed in 1 cycle. TypeScript proactive-exit saved us from full -1R SL hit (would've been ~$1,250 loss instead of $376). **Claude-layer failure:** did not pause between consecutive mechanical fires on correlated alts (DOGE fired at 07:00, XRP fired at 07:03 — I accepted back-to-back without thinking about peak-score trap on second fire). **System-layer save:** code proactive-exit executed faster than I could think. Net: losses contained, but avoidable if I had applied a pause-between-mechanical-fires filter.

→ Full Postmortem: [[Postmortem/2026-04-18_XRPUSDT_long]]

---

## Close Summary (filled on close)

*TBD*
