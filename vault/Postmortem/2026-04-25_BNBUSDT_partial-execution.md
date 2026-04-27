---
trade_file: "[[Trades/2026-04-25_BNBUSDT_LONG]]"
symbol: BNBUSDT
direction: long
outcome: loss
r_multiple: -1.0
duration_minutes: 9
closed_reason: sl
process_grade: D
lesson_tag: [partial-execution, max-qty-limit, asymmetric-risk]
generalizable: true
written: 2026-04-26T18:00:00Z
---

# Postmortem — BNBUSDT LONG — 2026-04-25

> **Не классический трейд-постмортем — операционный.** Главный урок не про сетап (он был валидный), а про инфраструктурный баг: ордер исполнился на одном sub-account из двух, оставив portfolio в asymmetric direction state.

---

## Что произошло (chronological)

- **15:34 UTC C∼2310** — Playbook A LONG trigger fired на BNB:
  - Close 631.0 ≤ BB lower 631.27 ✓
  - RSI1h 32.09 < 35 ✓
  - Volume 1h ≥ 1.3 × SMA20 ✓
  - ADX1h 16.6 < 22 (RANGE) ✓
  - SL distance 0.113% > min 0.094% ✓
  
  Все 5 условий v2-strict выполнены. `execute.ts` вызван.

- **15:34 UTC** — `executeAcrossAccounts` отправил ордера параллельно:
  - **50k account:** qty 154.92 BNB (notional $97,803), success ✓
  - **200k account:** sizing рассчитал qty 619.71 BNB (notional ~$390k для 0.5% риска × 0.113% SL), Bybit reject **`max_qty 370 BNB`** ❌

- **15:34 UTC** — `execute.ts` reported `ok: true` потому что `succeeded.length > 0`. Бот считал что трейд открыт.

- **15:43 UTC** — BNB закрытие 1H bar дало price <630.30 (SL). 50k положение закрылось −$110 (1R loss).

- **15:48 UTC** — Operator manually opened на 200k со своим SL 624 (1.01% — намного шире strategy 0.113%) и qty 126.9 BNB (помещается в max_qty 370).

- **2026-04-26 ∼14:00 UTC** — Postmortem написан после операторской заметки в чате.

---

## The Delta — что было против ожидания

**Что я ожидал:** обе sub-account (50k + 200k) открывают позицию параллельно. Если одна fail — обе fail. Если одна success — обе success. Atomic execution.

**Что произошло:** **partial execution**. 50k открылся, 200k не смог из-за per-symbol exchange max_qty limit. **Никакого rollback** на 50k. **Никакого retry** на 200k. **Никакого alert**, что состояние asymmetric.

**Причина gap:** **`getInstrumentSpec()` в `src/execute.ts` не считывал `maxOrderQty`/`maxMktOrderQty`** из Bybit. `sizing.ts` имел поле `maxQty?: number` но оно никогда не передавалось. Sizing для 200k посчитал raw qty 619.71 без exchange ceiling — Bybit отказал.

**Bybit limits per symbol** (для market orders, наш case):
- BTC: 150
- ETH: 2000
- SOL: 12000
- **BNB: 370** ← binding constraint here
- OP: 84130
- NEAR: 66470
- AVAX: 22000
- SUI: 66000

Только BNB имеет такой узкий лимит — потому именно BNB поймал баг первым.

---

## Process Review

- [x] **Did I follow Entry Rules?** Yes — все 5 v2-strict conditions met.
- [x] **Was SL structurally placed?** Yes — bb_lower − 0.5×ATR.
- [ ] **Did I size correctly?** Partially — sizing формула правильная, но exchange ceiling не учтён.
- [x] **Did I update Trades/ file?** Yes, after-the-fact.
- [x] **Did I close for the right reason?** Server-side SL hit — automatic.
- [ ] **Did I detect partial execution?** **NO** — `ok: true` reported, no alert.

**Process grade: D** — entry was clean, но infrastructure не атомарна. Operator должен был руками открывать вторую сторону. Это потеря доверия к `ok: true` отчёту.

---

## The Fix (deployed 2026-04-26)

Three-line plumbing fix через цепочку:

1. **`src/trade/types.ts`** — добавлено `maxQty?: number` в `InstrumentSpec` interface + комментарий с инцидентом.
2. **`src/execute.ts:getInstrumentSpec()`** — читаем `maxOrderQty` и `maxMktOrderQty` из Bybit, берём `min` (safe ceiling для market+limit orders).
3. **`src/trade/executor.ts`** — передаём `maxQty: ctx.instrument.maxQty` в `sizePosition()`. `sizing.ts` уже имел clamp logic (line 50) — был "молча отключён" из-за непереданного параметра.

**Эффект для будущих BNB-сетапов с tight SL:**
- 50k: qty 154 (не меняется, fits within 370)
- 200k: qty **clamps to 370** (вместо 619), success ✓
- Asymmetric **size**, симметричный **direction** ✓
- 200k risk drops to ~0.15% (вместо 0.5%) на этом trade — приемлемо

Verified live: Bybit API возвращает `maxOrderQty + maxMktOrderQty` для всех 8 пар universe — fix работает на реальных лимитах.

---

## Lesson

**Lesson statement:** Multi-account execution **must be atomic-or-pre-validated** — partial fills create asymmetric portfolio risk that operator must manually correct.

**Why it generalizes:** Любая asymmetric exposure нарушает strategy thesis. Если BNB через 12h hit TP вместо SL — 50k бы заработал, 200k — нет. Sharpe distribution sided portfolio становится shifted.

**Tags:** `[partial-execution]` `[max-qty-limit]` `[asymmetric-risk]`

**Action:**
- [x] Fixed via maxQty plumbing (commit pending)
- [x] Added operator-opened policy to CLAUDE.md (handles symmetric case where operator manually fills the missing leg)
- [ ] Future: добавить partial-execution Telegram alert когда `succeeded.length < reports.length`

---

## Outcome Attribution

- **Process contribution:** 70% — entry mechanics были clean, sizing формула правильная.
- **Infrastructure contribution:** 30% — `getInstrumentSpec` гэп. Bug existed since v2 birth (2026-04-22), surfaced first time на BNB (single pair с max_qty < typical strategy qty for 200k).
- **Luck contribution:** 0% — это deterministic infrastructure bug, не market noise.

---

## What I'd Do Differently

- [x] **Same entry, different infrastructure.** Если завтра тот же сетап — войду так же; теперь `executeAcrossAccounts` помещает оба ордера благодаря max_qty plumbing.
- [ ] Future hardening: pre-flight validation для всех accounts ДО первого `submitOrder` (predict reject before sending). Plus partial-execution Telegram alert.

Trade сам по себе был валиден per strategy.md. Infrastructure has been hardened. **No new strategy lesson — only operational lesson.**
