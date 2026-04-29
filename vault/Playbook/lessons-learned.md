---
name: Lessons Learned v2
description: Paid-in-P&L wisdom since strategy-v2. Quarantined pre-v2 lessons in archive/lessons-v1.md. Read before every /trade-scan cycle.
type: playbook
priority: 2
version: 2.0
created: 2026-04-22
---

# Lessons Learned v2

> Каждая запись здесь оплачена real P&L в период strategy-v2 (2026-04-22+).
> **Pre-v2 уроки** в `archive/lessons-v1.md` — применимы только к archived постмортемам.
> Re-читать этот файл после каждого losing trade и перед любым исключением из правил.

---

## How this file works

После каждой закрытой сделки — особенно убытков, но и характерных побед — извлекается lesson. Добавляется сюда только если:

**Lesson принадлежит сюда если:**
- Противоречит моему первому импульсу (импульс ненадёжен)
- Я нарушил правило больше одного раза
- Она сохранила или могла сохранить реальный P&L
- Обобщается за пределы конкретной сделки

**Lesson НЕ сюда если:**
- Специфична одному сетапу, уже зафиксирована в strategy.md entry/exit rules
- Переоткрытие того что уже есть здесь — в этом случае добавить date-stamp к существующей
- Неотделима от удачи/невезения (не учиться на шуме)

### Entry format

```markdown
## [YYYY-MM-DD] — Short rule statement

**Context:** одно предложение про ситуацию.
**What I did:** что реально сделал (обычно неправильно).
**What I should have done:** что говорит правило.
**Why it matters:** обобщаемый принцип.
**Tags:** `[категория]` `[категория]`
```

### Tag vocabulary

- `[ego-hold]` — держал убыток past the rule
- `[fomo]` — вошёл потому что не смог сидеть вне
- `[oversize]` — размер больше правила
- `[news-react]` — торговал заголовок без структуры
- `[regime-misread]` — неправильный playbook в неправильном режиме
- `[transition-skip-violation]` — взял сделку в ADX 22-25
- `[bb-tight-sl]` — SL внутри ATR noise на A
- `[b-low-wr-panic]` — закрыл B-сделку после серии losses (нормальная variance)
- `[pair-pick]` — выбрал слабую пару когда ETH давал сигнал
- `[counter-regime]` — A в trend, B в range
- `[post-loss-rage]` — вошёл сразу после SL на той же паре
- `[weekend-trade]` — торговал в пятницу 22 — воскресенье 22 UTC
- `[funding-clip]` — вошёл в funding window
- `[dead-zone]` — вошёл в 22-00 UTC
- `[peak-giveback]` — не снизил планку при day P&L ≥ +0.5%
- `[win-learned]` — выигрыш с обобщаемым правилом

---

## Lessons

<!-- Новые записи добавлять СВЕРХУ (reverse chronological) -->

### [2026-04-29] — Cross-pair "EFFECTIVE" filter for Playbook A is empirically backwards

**Context:** После ETH SHORT loss (combined −$1313, два operator-opened шорта в FOMC blackout + TRANSITION) я предложил гипотезу H2: «skip A-LONG если cross-pair EFFECTIVE bearish (≥7/10 BOS_15m bearish), skip A-SHORT если bullish». Интуиция: counter-trend trade при universe-wide adverse direction = adverse selection, как было на NEAR 04-27 (8/8 BOS_15m bearish при входе LONG → −2.37R).
**Backtest result (365d in-sample, 10 pairs):** Filter удалил 601 из 749 сделок (80%), и из них **449 winners / 185 losers**. sumR обрушился 327.40 → 19.54 (−307R, в 17× хуже). PF 2.15 → 1.22. Даже с порогом 8 of 10 (sumR ~5R), 9 of 10 (sumR ~21R) — все хуже baseline.
**Why empirical reverses intuition:** Playbook A — это **mean-reversion fade**. Edge возникает именно когда вселенная stretched в одну сторону → oversold/overbought signal. Фильтрация «когда все против нас» = удаление настоящего setup quality. Контр-интуиция работает на momentum-following стратегии, но не на range-fade.
**What I should have done:** До предложения filter в strategy.md — прогнать backtest. Спасло бы день time + сохранило $327 sumR/year edge.
**Why it matters:** Plausible hypotheses on filters могут быть **противоположны** реальности. ВСЕ filter-кандидаты ОБЯЗАТЕЛЬНО проходят backtest validation на 365d + walk-forward OOS до приёма в strategy.md. Single-trade observations (NEAR 04-27 8/8 bearish) — это noise, не signal. N=1 ≠ pattern.
**Tags:** `[backtest-discipline]` `[counter-intuitive]` `[filter-validation]`

---

### [2026-04-29] — TG-сигнал на blackout/transition setup НИКОГДА не должен включать готовый план сделки

**Context:** 04-28 в FOMC blackout сработали два strategy trigger'а (TAO A-SHORT в 15:14 UTC, ETH B-SHORT в 17:35 UTC). Бот корректно SKIP'нул оба per catalysts.md FOMC blackout 14:00-18:00. Но мои TG-сообщения формулировали setup как:
> "Все 4 strategy gates met: close выше BB upper, RSI 1h=66, ADX 17 RANGE, volume spike ✓"
> "🎯 Если бы взяли: Entry 2291, SL около 2318, TP1 около 2212, Risk 0.3% ≈ $590"
> "Если хочешь взять trigger вручную как с TAO — твой call. Я не открою до 18:00."
Operator интерпретировал как "стратегия даёт зелёный, единственный блок — календарь, можно overridе'ить" → открыл оба руками. Combined outcome: TAO −$796, ETH 200k+50k −$1313. **Total $2109 paid for сообщения которые я считал "neutral status".**
**What I did:** TG-сигнал на skipped-by-blackout setup структурирован как полный trade-plan (gates + entry + SL + TP + risk size + "your call" в конце). Это **invitation to action**, не нейтральный отчёт.
**What I should do:** На skipped setup TG = **исключительно SKIP-statement без actionable plan**. Format:
> 🚫 **{SYMBOL} {SETUP} — SKIP**
> Reason: [single bullet — blackout / regime / structure]
> [optional: visual concern — "structure says momentum, not range"]
> NO entry/SL/TP numbers. NO "your call". NO "если хочешь — твой выбор".

Полный trade-plan (gates + numbers) только в TG **когда бот собирается войти** или когда setup кристально чистый и единственный технический блок — это таймер (e.g., funding window, ждём 4 минуты).
**Why it matters:** Бот = source of authority в восприятии оператора. Если сигнал говорит "all gates met" — operator overrides блокировку и берёт trade. Это структурная проблема communication, не операторская psychology — fix лежит в TG-formatter, не в operator discipline.
**Why generalizes:** Применяется к каждому будущему blackout/transition skip. Не специфично TAO/ETH/FOMC — любой catalyst, любая пара, любое regime-mismatch.
**Tags:** `[tg-framing]` `[execution-discipline]` `[operator-override]` `[communication]`

---

### [2026-04-25] — Operator-override positions: defer-rule must be codified, not implicit

**Context:** BNBUSDT LONG 200k account был operator manual override (entry 630.40, SL 624 — 3.2× ATR vs strategy 0.5× ATR). В 20:07 UTC ADX1h hit 28.9 ≥ 28 (§A abort threshold). Previous Claude (C2360) flagged abort но deferred to operator: «жду решения, если молчание до 21:00 UTC — держу с SL 624». Через 18 мин silence /clear; fresh Claude session (20:25 UTC) прочитал journal только Asian session (offset=1 limit=200), пропустил deferral plan, применил §A abort строго → closed −0.34R / −$274.
**What I did (fresh session):** Применил strategy.md §A abort правило напрямую без чтения late-day deferral context. Outcome OK (−$274 vs probable −$907 SL hit), но операционно — split decision между двумя Claude-сессиями.
**What I should have done:** (a) Прочитать tail журнала после /clear перед любыми decisions on existing positions. (b) Иметь codified rule о handling operator overrides — нет правила в strategy.md, поэтому previous Claude импровизировала, fresh Claude интерпретировала по умолчанию. Operator должен помечать override в trade file frontmatter (`operator_override: true`, `defer_until: HH:MM UTC`), и Phase 1 vault-load должна это парсить.
**Why it matters:** /clear создаёт discontinuity. Strategy purity vs operator-respect — это конфликт без правила. Решение через память не работает (память не загружается без явного триггера). Только codification в strategy.md / trade frontmatter обеспечит consistent behavior across sessions. Также: всегда читать journal full когда есть open position (не truncate offset=200 если позиция активна).
**Tags:** `[process-discipline]` `[clear-discontinuity]` `[operator-override]`

---

### [2026-04-22] — Vault-sync discipline при приближении к TP

**Context:** BTCUSDT LONG #3 (entry 78120, TP 78500) вышел на +1.58R через server-side fill в окне между C536 (12:13 mark 78351, +1.13R) и C537 (12:45 reconcile — позиция пропала). Vault не был обновлён в момент TP hit. Outcome +$2053.59 положительный, но reconcile поймал divergence `vault_without_bybit` — audit trail сломан, оператор не получил immediate alert о закрытии.
**What I did:** Продолжал cycle-by-cycle HOLD с mark-check, не планируя, как обнаружить server-side TP fire в межцикловой паузе. Phase 0 reconcile следующего cycle выявил gap постфактум.
**What I should have done:** В C536 при +1.13R и distance-to-TP = 149pt (≤0.5×ATR 1H) **pre-flag next cycle** как "audit-first": следующий /loop начинается с `npx tsx src/audit.ts` + `npx tsx src/pnl-day.ts`, а не со scan. Если позиция пропала — сразу закрыть vault, отправить TG, и только потом сканировать новые setup-ы.
**Why it matters:** Grade F не за outcome, а за audit trail. Оператор смотрит Journal/TG как ground truth; 30-минутный gap между реальным закрытием и vault-update = доверие-долг. Heuristic: `last_known_unrealized_R >= +1.0 AND distance_to_tp <= 0.5 × ATR_1h` → next cycle phase 0 = audit-first, не scan-first.
**Tags:** `[vault-sync-discipline]` `[process-discipline]`

---

### [2026-04-27] — Tight-SL setups MUST use `place-limit`, never `open` (market order)

**Context:** NEARUSDT A-LONG range fade C2859. Gates fired clean: RSI 34.68, BB lower 1.38, vol 2.04× SMA, ADX 16.83 RANGE. SL distance per spec 0.265% (just above 0.232% = 0.3×ATR floor). Combined risk planned $492 = 1R. Outcome: SL hit за 22 min, combined day P&L **−$1,168.18 = −2.37R hit**.
**What I did:** Used `execute.ts open` (market order). Filled at 1.3796 vs intended limit 1.3757 — slipped +0.28%. SL distance jumped from 0.27% к 0.55%. Entry slip alone съел весь planned R cushion. Then SL hit and likely slipped further on the stop-market fill.
**What I should have done:** Used `execute.ts place-limit --limit 1.3757 --max-age-min 15`. Would have either filled at intended price (preserving 0.27% SL distance + 4.4R reward) or expired без trade. Either outcome strictly better than 2.37R loss.
**Why it matters:** A-playbook SL distances are intentionally tight (0.3-0.5×ATR от BB edge). На alt-coins ATR 0.7-1% means SL cushion is just 30-50 ticks. Market order spread + immediate slippage on entry = single-tick worth of edge eats entire risk budget. Combined entry+exit slippage doubled the realized loss vs planned 1R. **Rule: A-LONG/A-SHORT (and any setup with planned SL distance < 0.5%) MUST use `place-limit`, не `open`.** B-playbook trades have wider SLs (1×ATR = 0.7-1.5%) so market order acceptable там. Applies even при clean strategy gates — execution mode is independent rule.
**Tags:** `[execution-discipline]` `[entry-slippage]` `[A-playbook]`

---

### [2026-04-22] — Strategy v2 started, fresh lessons counter

**Context:** Рефакторинг после 22-trade диагностики (WR 27%, −7.33R за 5 дней). Старые v1 lessons карантинированы в archive/lessons-v1.md.
**What I did:** Принял strategy.md v2 (Playbook A + B, regime-gated, 3 пары) после walk-forward validation.
**What I should have done:** То же.
**Why it matters:** Чистый старт — это обнуление mental debt. Старые lessons v1 полезны для понимания постмортемов 2026-04-17..22, но не для новых решений. Новые сделки — новые правила.
**Tags:** `[win-learned]`

---

## Archived wisdom (pre-v2)

Старые lessons v1 → [archive/lessons-v1.md](archive/lessons-v1.md).

Ключевые v1 темы, которые автоматически **уже отражены** в strategy.md v2 — не нужно копировать:

1. **Structural SL + ATR buffer** → strategy.md § Stop-Loss.
2. **No post-loss re-entry on same pair** → strategy.md § Hard blocks #4.
3. **News-bias 2-cycle confirm** → crypto-news-analyzer skill.
4. **Server-side SL within 5 min** → CLAUDE.md inviolable rules.
5. **Trust Bybit API over Telegram** → reconcile.ts + audit.ts.
6. **Pre-commit invalidation rules** → strategy.md § Abort clauses.
7. **Regime-mismatch в range** → whole point of strategy.md v2.
