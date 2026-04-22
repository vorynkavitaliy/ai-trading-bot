---
name: Strategy v2 — Regime-Aware Range/Trend
description: Core operational strategy — BB/Z-score range fade (Playbook A) + EMA pullback trend-follow (Playbook B), regime-gated by ADX. Backed by 365d backtest on BTC/ETH/SOL.
type: playbook
priority: 1
version: 2.0
created: 2026-04-22
validated_by: src/backtest.ts (walk-forward 273d/92d)
---

# Strategy v2 — Regime-Aware Range + Trend

> Каждая буква этого файла получена из бэктеста. Не менять правила без нового бэктеста.
> Backtest: `npx tsx src/backtest.ts --combined` / `--walkforward` / `--gridB`.

---

## Три аксиомы

1. **Режим важнее сетапа.** ADX определяет, какой playbook активен. Неправильный playbook в неправильном режиме — главный источник убытков (подтверждено SMB Training, SSRN 2025, и 22-trade диагностикой Apr 18-22).
2. **Не торговать важнее торговать.** Target 1-2 сделки/пара/день, hard cap 5 сделок/день на все пары. Overtrading разрушает edge.
3. **SL внутри ATR = казино.** Минимум 0.5×ATR(1H) buffer за структурным уровнем. Никогда tight SL <0.3×ATR.

---

## Universe + таймфреймы

### Активные пары

**BTCUSDT, ETHUSDT, SOLUSDT** — только они. Из backtest walk-forward:

| Пара | Test edge | Роль |
|---|---|---|
| ETHUSDT | +12.81R / 92d, PF 1.43 | **Primary** — самая чистая range/trend механика |
| BTCUSDT | +1.92R / 92d, PF 1.17 | Secondary — ограниченный edge OOS |
| SOLUSDT | +1.68R / 92d, PF 1.09 | Secondary — B не работает, A компенсирует |

Добавление новых пар — **только после** 180d+ backtest данных и совпадающих OOS метрик.

### Таймфреймы

- **4H** — макро-bias (для confirmation на тренде).
- **1H** — основной TF: regime detection, BB bands, EMA stack, entry scoring.
- **15M** — entry timing, re-score pending orders.
- **3M** — trigger engine only (zone tap, sweep). НЕ для scoring.

---

## Regime Detection — главный свитч

Проверяется **на каждом 1H close**. Между 1H close режим не переключается.

| Режим | Условие | Активный playbook |
|---|---|---|
| **RANGE** | ADX(1H) < 22 | **Playbook A** (fade BB границ) |
| **TRANSITION** | ADX 22-25 | **Skip** — ни A, ни B |
| **TREND** | ADX ≥ 25 AND EMA(8)>EMA(21)>EMA(55)>EMA(200) или инверсия | **Playbook B** (pullback trend-follow) |

**Почему skip в 22-25:** стыковой режим даёт whipsaw на обоих playbooks. Лучше сидеть в cash.

---

## Playbook A — Range Fade

### Когда активен

`regime == RANGE` (ADX < 22).

### Entry LONG

**Одновременно все условия:**
1. `close ≤ BB(20, 2.0).lower` на 1H close (Z-score ≤ −2 от SMA20)
2. `RSI(14, 1H) < 35`
3. `volume(last bar) ≥ 1.3 × SMA(20, volume)`
4. `ADX(14, 1H) < 22`

**Entry price:** market at 1H candle close внутрь BB, ИЛИ limit at BB lower.

### Entry SHORT

Симметрично:
1. `close ≥ BB(20, 2.0).upper`
2. `RSI > 65`
3. Volume spike как выше
4. ADX < 22

### Stop-Loss

```
SL_long  = BB.lower − 0.5 × ATR(14, 1H)
SL_short = BB.upper + 0.5 × ATR(14, 1H)
```

**Минимум stop distance:** 0.3 × ATR. Если меньше — skip сетап (не двигать SL ближе, это казино).

### Take-Profit

- **TP1 = SMA(20, 1H)** — закрыть **50% позиции**
- **TP2 = opposite BB band** — закрыть **оставшиеся 50%**
- **После TP1: move SL to breakeven** (entry price).

### Abort

- `ADX(14, 1H) ≥ 28` до TP1 → closed market
- 1H close за границу BB + ADX expanding — режим сломался, exit.

### Бэктест-статистика (365d, 3 пары)

- 214 сделок. WR 72%. +101R total. PF 2.4. MaxDD 2-3% per pair.
- Out-of-sample (92d test): все 3 пары положительные.

---

## Playbook B — Trend Pullback

### Когда активен

`regime == TREND` (ADX ≥ 25 AND EMA stack aligned).

### Entry LONG

**Все условия:**
1. `ADX(14, 1H) ≥ 25`
2. `EMA(8) > EMA(21) > EMA(55) > EMA(200)` на 1H
3. `+DI > −DI`
4. Price touches EMA(55) ± 0.5% (pullback в тренде, НЕ EMA21 — подтверждено бэктестом)
5. Current candle close > EMA(55) (отбой от pullback)
6. `RSI(14, 1H) > 45` (не oversold — это trend, не reversal)

### Entry SHORT

Симметрично: EMA8<21<55<200, −DI>+DI, pullback с high к EMA55, RSI<55.

### Stop-Loss

```
SL_long  = min(swing_low_last_10_bars, EMA55) − 1.0 × ATR(14, 1H)
SL_short = max(swing_high_last_10_bars, EMA55) + 1.0 × ATR(14, 1H)
```

Минимум 0.5×ATR stop distance.

### Take-Profit

- **TP1 = entry ± 3.0 × risk** (3R target) — закрыть 50%
- **Trailing: Chandelier Exit 2.5 × ATR(22, 1H)** после TP1 на оставшиеся 50%
  - LONG: trail stop = highest_high_since_entry − 2.5×ATR
  - SHORT: trail stop = lowest_low_since_entry + 2.5×ATR
- **После TP1 move SL to breakeven**, Chandelier поверх — whichever tighter.

### Abort

- `ADX < 20` до TP1 → exit market (тренд сломался)
- EMA8 пересекает EMA21 против направления → exit
- Close за EMA200 → exit

### Бэктест-статистика (365d, 3 пары)

- BTC: 74 сделок, WR 42%, +16R, PF 1.50, maxDD 2.16%
- ETH: 37 сделок, WR 35%, +4R, PF 1.39
- SOL: 35 сделок, WR 29%, −8R (SOL трудная на trend — держать риск малым или skip SOL B)

**Важно:** B имеет низкий WR (30-45%), но R:R компенсирует. **Низкий WR — это нормально для trend-follow.** Не паниковать после серии losses.

---

## Position Sizing

### Base risk per trade

**0.5% от текущего equity** для всех сетапов. Fixed fractional.

Почему не масштабировать по confluence (как было в v1): backtest оптимизирован на 0.5% flat. Размер-tweaking был источником variance, не edge.

### Volatility scalar (опциональный overlay)

```
atrPct = ATR(14, 1H) / price × 100

if atrPct < 1.5  → size × 1.2  (low vol, fatter SL fits)
if atrPct 1.5-2.5 → size × 1.0  (normal)
if atrPct > 2.5  → size × 0.7  (crazy vol, tighten)
```

Hard cap: 1.0% risk per trade даже с scalar.

### Leverage

Минимум **8×**, recommended **10×**. Required чтобы max notional 2× initial_balance помещался в max margin 25% equity (HyroTrader rule).

---

## Когда НЕ торговать (hard blocks)

1. **Regime TRANSITION** (ADX 22-25) — skip и A, и B.
2. **Dead zone 22:00-00:00 UTC** — skip полностью. Thin books, liquidation cascades.
3. **Funding windows ±10 мин** (00:00 / 08:00 / 16:00 UTC) — HARD block на entry.
4. **После 2 SL подряд на одной паре** — пара disabled до следующего UTC-дня.
5. **Day equity ≤ −2.5%** — flat до следующего UTC-дня (soft kill switch на 50% daily limit).
6. **High-impact news через <30 мин** — skip всё.
7. **Day P&L ≥ +0.5%** — raise entry bar: только A+ setups (strict filter) OR switch to flat.
8. **Пятница 22:00 UTC — воскресенье 22:00 UTC:** weekend. 50% size или пропустить совсем (низкая ликвидность, гапы).

---

## Cadence (операционный ритм)

### 3m loop — TRIGGER ENGINE only

- Проверить: есть ли новый tap BB edge / sweep?
- Если да — поднять флаг, пустить scoring на следующем 15m close.
- **Не запускать rubric на 3m.** Noise layer.

### 15m close — ENTRY/EXIT timing

- Re-score open positions (proactive exit check).
- Re-check pending limit orders (cancel-if-stale rule: limit > 15 мин без fill → cancel).
- If trigger flag raised by 3m — выполнить entry check.

### 1H close — REGIME + zones refresh

- Re-eval ADX, EMA stack → обновить режим.
- Пересчитать BB bands → update zones.md.
- Пересчитать 4H bias.

### Daily (00:30 UTC)

- Take equity snapshot (`pnl-day.ts --snapshot`).
- Daily audit: L:S ratio, per-pair R distribution.
- Review lessons-learned если был убыточный день.

---

## Metrics & Validation

### Ожидания live (из walk-forward OOS)

- **WR: 45-55%** (не 58% как in-sample)
- **PF: 1.2-1.5**
- **MaxDD: до 5%** (в 2× раза больше чем train 2-3%)
- **Profit: +5-8% equity за 90 дней** на 3 парах

Если live метрики **ниже нижней границы** за 30 дней/50 сделок → **пауза**, re-backtest, не продолжать.

### Triggers for re-backtest

- 50 live сделок накопилось.
- Регим изменился устойчиво (BTC dominance <50%, или ADX mode switched для >30 дней).
- WR/PF ушли за −20% от backtest baseline.
- Новая пара кандидат для universe.

---

## Changelog

### 2026-04-22 — v2.0

- **Снесено:** 12-factor rubric, post-loss revenge entries, pre-committed zones, proactive-exit overfire, tight-SL trap.
- **Введено:** Regime-gated A+B playbooks, BB/Z-score fade, EMA55-pullback trend-follow, 3-pair universe.
- **Validated:** backtest 365d, walk-forward 273d/92d, all pairs positive OOS.

### Archive

Старые playbooks (entry-rules, exit-rules, regime-playbook, session-playbook, lessons-v1) → `archive/`.
Не читать для текущих решений. Только для исторического контекста при review постмортемов до 2026-04-22.
