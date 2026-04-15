# Execution Algorithms and Optimal Limit Order Placement

**Research based on:**
- Barry Johnson, *Algorithmic Trading and DMA: An Introduction to Direct Access Trading Strategies* (4myeloma Press, 2010)
- Robert Kissell, *The Science of Algorithmic Trading and Portfolio Management* (Elsevier/Academic Press, 2013)
- Supporting academic literature (Almgren-Chriss 2001, Cont-Kukanov 2012, Moallemi 2016, Albers et al. 2024)

**Date:** 2026-04-06
**Relevance:** Our bot uses limit orders exclusively on Bybit USDT Perpetual. This document extracts actionable insights for improving fill rates, reducing adverse selection, and measuring execution quality.

---

## 1. Direct Market Access (DMA) — что это и почему важно

DMA означает, что ордера уходят напрямую в стакан биржи без вмешательства брокера. Для нашего бота через Bybit API — мы всегда работаем в режиме DMA.

**Johnson** выделяет ключевые характеристики DMA-исполнения:

- **Price-time priority:** стакан обрабатывает ордера по принципу "лучшая цена → первое время." Лимитный ордер с лучшей ценой выполняется первым; при одинаковой цене — тот, кто пришёл раньше.
- **Queue position имеет реальную ценность.** Ордер, стоящий первым в очереди на bid, имеет принципиально иные шансы на исполнение, чем ордер в хвосте очереди.
- **Maker vs. Taker разделение:** лимитный ордер, добавляющий ликвидность (maker), платит меньший fee. На Bybit это 0.020% maker против 0.055% taker. Разница 0.035% на каждую сделку — значительна в масштабе сотен сделок в год.

**Практический вывод для бота:** лимитный ордер на вход не только обеспечивает нужную цену — он экономит на fees и не создаёт market impact. Но fill не гарантирован.

---

## 2. TWAP (Time-Weighted Average Price)

TWAP-алгоритм делит крупный ордер на равные части и исполняет их через равные временные интервалы независимо от объёма торгов.

**Johnson** описывает применимость TWAP:

- Подходит для очень ликвидных инструментов (SPY, AAPL), где участие в объёме менее 0.5% ежедневного оборота
- Простота: минимальная сложность реализации, удобен для compliance
- **Слабость:** TWAP игнорирует объём. В периоды низкого объёма продолжает торговать по расписанию, создавая непропорциональный impact

**Для криптобота:** TWAP не применим напрямую — мы не разбиваем позицию по времени. Но концепция равномерного распределения исполнения во времени полезна как **anti-spike правило**: не выставлять ордер сразу после открытия 15M свечи (первые секунды свечи — аномальная волатильность).

---

## 3. VWAP (Volume-Weighted Average Price)

VWAP — взвешенная по объёму средняя цена. Алгоритм участвует в рынке пропорционально объёму: когда объём растёт — ускоряется, когда падает — замедляется.

**Johnson** описывает структуру VWAP-алгоритма:

```
VWAP = Σ(price_i × volume_i) / Σ(volume_i)

VWAP schedule:
  Предсказать дневной профиль объёма (U-shape в equity)
  Определить долю объёма на каждый интервал
  Участвовать в рынке с той же долей
```

**Kissell** добавляет ограничения:

- VWAP хорош как бенчмарк, но **не минимизирует Implementation Shortfall**
- Пассивный VWAP может отставать от рынка при направленном движении
- В крипте профиль объёма непредсказуем (нет закрытия торговой сессии), поэтому VWAP-scheduling ненадёжен

**Для криптобота:** VWAP используем как **сигнальный индикатор** (цена выше/ниже VWAP дня = bias), но не как алгоритм исполнения. Наш вход — единичный лимитный ордер на основе SMC-сигнала.

---

## 4. Implementation Shortfall — ключевая метрика качества исполнения

**Kissell** определяет Implementation Shortfall (IS) как:

```
IS = (Цена исполнения − Цена решения) × Позиция

Компоненты:
  1. Timing cost (delay cost) — цена сдвинулась пока ждали сигнала
  2. Market impact — наш ордер сдвинул цену против нас
  3. Opportunity cost — часть ордера не исполнилась
  4. Fees & commissions — явные затраты
```

**Johnson** добавляет: для лимитных ордеров IS имеет асимметрию — ордер либо исполняется по лучшей цене (negative IS = прибыль от терпения), либо не исполняется вообще (opportunity cost).

**Практическая формула для нашего бота:**

```
IS = (fill_price - signal_mid_price) / signal_mid_price × 100 bps

Для Long лимитного ордера:
  fill_price < signal_mid_price → IS отрицательный → хорошо (купили дешевле)
  fill_price > signal_mid_price → IS положительный → плохо (цена убежала)
  Нет fill → Opportunity cost = (high - limit_price) / limit_price
```

**Измерение по сделкам:** после каждого исполнения логировать arrival_price (цена mid в момент выставления ордера) и actual_fill_price. Накопленная статистика IS показывает реальное качество execution.

---

## 5. Almgren-Chriss Model — оптимальное исполнение

Almgren и Chriss (2001) сформулировали задачу оптимального исполнения как **mean-variance оптимизацию**:

```
Задача: ликвидировать X акций за время T
Минимизировать: E[cost] + λ × Var[cost]

где λ = risk aversion parameter

Market impact состоит из:
  Permanent impact: g(v) = γ × v  (постоянный сдвиг цены равновесия)
  Temporary impact: h(v) = η × v  (временное давление от нашей торговли)

v = скорость торговли (shares per unit time)
```

**Оптимальная стратегия** при линейных функциях impact:

- При высоком λ (risk-averse) — торговать быстро, чтобы избежать рыночного риска
- При низком λ (impact-averse) — торговать медленно, чтобы минимизировать impact
- **Optimal trajectory** — экспоненциально затухающая активность

**Для нашего бота:** Almgren-Chriss применим не к входу (один ордер), а к **выходу** из позиции. При закрытии по Stop команде или trailing stop — не использовать market order, а выставлять агрессивный лимит с коротким timeout.

**Ключевой инсайт модели:** market impact при нашем размере позиции ($11,250 notional на BTCUSDT с дневным объёмом $2B+) пренебрежимо мал. Участие < 0.001% ADV. **Поэтому наш ограничивающий фактор — не impact, а fill rate лимитного ордера.**

---

## 6. Market Impact Models — как наши ордера двигают цену

**Johnson** разделяет market impact на три уровня в зависимости от размера:

| Размер относительно ADV | Impact | Механизм |
|--------------------------|--------|-----------|
| < 0.1% ADV | Negligible | Нет значимого сдвига |
| 0.1% – 1% ADV | Small | Temporary impact, быстро восстанавливается |
| > 1% ADV | Significant | Permanent impact, information leakage |

**Наш размер:** $11,250 на BTCUSDT ADV ~$2,000,000,000 = **0.00056% ADV**.

Вывод: мы **не двигаем рынок**. Market impact для нас — академическая концепция, не практическая проблема. Наша проблема — противоположная: как получить fill по нашей цене, если рынок уходит не туда.

**Однако**: для альткоинов с меньшим ADV (например PEPE с ADV ~$100M на Bybit) наш размер становится 0.01% ADV — всё ещё мал, но уже требует аккуратности с временным impact при лимитном ордере.

---

## 7. Limit Order Strategies — размещение, тайминг, отмена

Это **самый релевантный раздел** для нашего бота.

### 7.1 Trade-off: fill rate vs. price improvement

**Johnson** формулирует фундаментальный trade-off лимитного ордера:

```
Агрессивнее лимит (ближе к mid или за mid):
  + Выше вероятность исполнения
  - Хуже цена (платим больше spread)
  - Рискуем стать taker (если цена достигнет лимита сразу)

Пассивнее лимит (дальше от mid):
  + Лучшая цена
  + Точно maker fee
  - Ниже вероятность исполнения
  - Выше opportunity cost
```

### 7.2 Оптимальное расстояние от mid

**Kissell** предлагает framework для выбора offset от mid:

```
Optimal offset = f(signal_strength, time_horizon, spread, volatility)

Для сильного сигнала (confluence ≥ 80):
  Offset = 0.0 × spread (выставлять на mid или на bid/ask)
  Rationale: сигнал мощный, opportunity cost высок

Для умеренного сигнала (confluence 70-79):
  Offset = 0.5 × spread (между mid и best bid)
  Rationale: балансируем fill rate и цену

Для слабого сигнала (confluence 70 ровно):
  Рассмотреть пропуск сигнала вместо выставления с ухудшенной ценой
```

**Практическая реализация для нашего бота:**

```typescript
function calcLimitPrice(signal: Signal, orderBook: OrderBook): Big {
  const mid = orderBook.bestBid.add(orderBook.bestAsk).div(2);
  const spread = orderBook.bestAsk.minus(orderBook.bestBid);

  if (signal.confluenceScore >= 80) {
    // Агрессивный вход — на mid
    return signal.side === 'buy'
      ? mid.minus(spread.times(0.1))   // чуть ниже mid
      : mid.plus(spread.times(0.1));   // чуть выше mid
  } else {
    // Стандартный вход — внутри spread
    return signal.side === 'buy'
      ? orderBook.bestBid.plus(spread.times(0.2))
      : orderBook.bestAsk.minus(spread.times(0.2));
  }
}
```

### 7.3 Тайминг выставления ордера

**Johnson** описывает оптимальный момент для лимитного ордера:

- **Избегать начало свечи (первые 30-60 сек):** выход крупных участников создаёт временные спреды
- **Избегать период публикации funding rate (каждые 8 часов):** аномальные движения
- **Предпочтительно:** середина свечи при стабилизировавшемся spread

**Для нашего бота:** ждать закрытия 15M свечи и подождать 15-30 секунд после открытия новой перед выставлением ордера.

### 7.4 Стратегия отмены ордера

Это критически важная область, которую **Johnson** разбирает детально под названием "order freshness."

**Проблема stale order (устаревший ордер):**

```
Сценарий "adverse fill":
  1. Сигнал: Long BTCUSDT @ 95,000 (OB уровень)
  2. Выставляем лимитный ордер buy @ 95,000
  3. Цена уходит вниз: 94,800 → 94,500 → fill @ 94,400 (проскользили к SL)
  4. Через секунду после fill цена продолжает падать → SL срабатывает

Это "adverse selection": наш fill произошёл именно потому, что рынок агрессивно
движется против нас. Продавцы знали что-то, чего мы не знали.
```

**Признаки stale order (когда отменять):**

```
1. Время истекло: ордер висит > N минут, сигнал "протух"
   → Рекомендация: timeout = 2-3 свечи = 30-45 минут для 15M

2. Цена ушла за OB зону: если цена пробила OB.low (для long) —
   OB аннулирован, ордер нужно отменить немедленно

3. Structure invalidation: BOS в противоположную сторону на 15M
   → Сигнал устарел, отменяем

4. Volume dry-up: объём 3 последних свечей < 50% avg20 — рынок
   замер, вероятность fill падает, ждём следующий сигнал

5. Order book imbalance flip: OBI перевернулся (было buy pressure,
   стало sell pressure) → отменяем, заново оцениваем
```

**Правило отмены:**

```typescript
const ORDER_TIMEOUT_CANDLES = 3; // 3 × 15 min = 45 min
const ORDER_TIMEOUT_MS = ORDER_TIMEOUT_CANDLES * 15 * 60 * 1000;

function shouldCancelOrder(order: Order, signal: Signal, currentBar: Candle): boolean {
  // Timeout
  if (Date.now() - order.createdAt > ORDER_TIMEOUT_MS) return true;

  // Structure invalidation
  if (signal.side === 'buy' && currentBar.close < signal.obZone.low) return true;
  if (signal.side === 'sell' && currentBar.close > signal.obZone.high) return true;

  return false;
}
```

---

## 8. Order Book Imbalance как сигнал

**Johnson** (раздел Market Microstructure) и академическая литература (Cont, Kukanov 2012) документируют:

**Order Book Imbalance (OBI):**

```
OBI = (BidVolume_L1 - AskVolume_L1) / (BidVolume_L1 + AskVolume_L1)

Диапазон: [-1, +1]
  +1 = только bid volume (покупатели доминируют)
  -1 = только ask volume (продавцы доминируют)
  0 = равновесие
```

**Эмпирические факты:**

- OBI предсказывает краткосрочное (< 1 минуты) движение цены с статистически значимой точностью
- OBI > +0.3 коррелирует с ростом цены в следующие 10-30 секунд
- OBI < -0.3 коррелирует с падением

**Применение в лимитном ордере:**

```
Для Long ордера:
  OBI > 0 (buy pressure): хороший момент для выставления — вероятность
  что цена дойдёт до нашего bid снизилась, но если дойдёт — рынок
  развернётся вверх быстрее

  OBI < -0.3 (сильное sell pressure): не выставлять лимит сейчас —
  высокий риск adverse fill. Подождать восстановления OBI.

Для Short ордера — зеркально.
```

**Multi-level OBI** (Top-5 levels) даёт более надёжный сигнал, чем только L1:

```typescript
function calcMultiLevelOBI(orderBook: OrderBook, levels: number = 5): number {
  let bidVol = Big(0);
  let askVol = Big(0);

  for (let i = 0; i < Math.min(levels, orderBook.bids.length); i++) {
    bidVol = bidVol.plus(orderBook.bids[i].size);
    askVol = askVol.plus(orderBook.asks[i].size);
  }

  const total = bidVol.plus(askVol);
  if (total.eq(0)) return 0;

  return bidVol.minus(askVol).div(total).toNumber();
}
```

**Ограничения OBI:** OBI может быть "spoofed" — крупные участники выставляют видимые объёмы которые снимают до исполнения. Не полагаться на OBI как на единственный фильтр — использовать как дополнительный.

---

## 9. Aggressive vs. Passive Strategies

**Johnson** классифицирует execution strategies по агрессивности:

| Стратегия | Описание | Когда использовать |
|-----------|----------|--------------------|
| **Passive** | Лимит далеко от mid, ждём исполнения | Нет срочности, хотим лучшую цену |
| **Neutral** | Лимит на mid или внутри spread | Баланс fill rate и цены |
| **Aggressive** | Лимит за mid (немного хуже рынка) | Нужно исполнение, сигнал срочный |
| **Market** | Немедленное исполнение по рынку | Аварийные закрытия (SL, Stop Telegram) |

**Kissell** добавляет концепцию **adaptive aggressiveness**: алгоритм меняет агрессивность в зависимости от текущих условий.

```
Условие → Aggressiveness
────────────────────────────────────────
Высокая волатильность (ATR spike) → Пассивнее (шире ордер)
Низкая волатильность (tight range) → Агрессивнее (ближе к mid)
Сильный OBI в нашу сторону → Нейтрально (рынок придёт к нам)
Сильный OBI против нас → Агрессивнее или пропустить
Долго не исполняется (>15 min) → Агрессивнее (сдвинуть к mid)
```

**Для нашего бота — двухэтапная агрессивность:**

```
Этап 1 (0-15 мин): Passive
  Выставляем на OB уровне или чуть выше/ниже
  Ждём когда рынок придёт к нам

Этап 2 (15-30 мин): Neutral
  Если не исполнился — сдвигаем лимит ближе к mid на 0.5 × spread
  Один раз, без цикличного преследования цены

Этап 3 (30-45 мин): Cancel
  Если до сих пор не исполнился — отменяем
  Сигнал устарел, ждём следующего
```

---

## 10. Smart Order Routing (SOR) — применимость к крипто

SOR был разработан для equity рынков с множеством торговых площадок (NYSE, NASDAQ, dark pools). Алгоритм анализирует все доступные venues и маршрутизирует ордер туда, где лучшая цена и ликвидность.

**Для криптобота (один exchange — Bybit):**

SOR в классическом виде неприменим. Однако концепции SOR полезны:

1. **Best Execution across order types:** на Bybit доступны post-only limit, limit, stop-limit. Выбор типа ордера = форма внутреннего SOR.

2. **Post-Only protection:** использование post-only флага гарантирует maker fee и отмену ордера если он стал бы taker немедленно. Это защищает от случайного market fill.

3. **Time-in-Force выбор:**
   - GTC (Good Till Cancel) — для наших entry ордеров с ручной отменой по timeout
   - IOC (Immediate or Cancel) — для аварийных закрытий, когда нужно заполнить быстро
   - FOK (Fill or Kill) — не подходит (слишком строго)

```typescript
// Post-only limit order на вход
const entryOrder = {
  orderType: 'Limit',
  timeInForce: 'PostOnly',    // Гарантируем maker fee
  price: limitPrice.toString(),
  qty: positionSize.toString(),
};

// При timeout — сдвигаем лимит (не делаем market)
const adjustedOrder = {
  orderType: 'Limit',
  timeInForce: 'GTC',          // Снимаем PostOnly ограничение
  price: midPrice.toString(),   // Сдвигаем к mid
  qty: remainingQty.toString(),
};
```

---

## 11. Pre-Trade Analytics — оценка ожидаемых затрат

**Kissell** разрабатывает framework для pre-trade cost estimation:

```
Ожидаемые затраты лимитного ордера:

E[cost] = P(fill) × explicit_cost
        + P(fill) × expected_slippage
        + (1 - P(fill)) × opportunity_cost

где:
  P(fill) = вероятность исполнения
  explicit_cost = maker fee = 0.020%
  expected_slippage = E[fill_price - limit_price | fill]
  opportunity_cost = P(no fill) × alpha × position_value
  alpha = ожидаемая прибыль сигнала если бы исполнились
```

**Оценка P(fill) для нашего бота:**

```
Факторы, влияющие на P(fill):
  1. Расстояние от mid (depth_offset): чем дальше от mid — тем ниже P(fill)
  2. Объём в очереди перед нашим ордером: чем длиннее очередь — тем ниже P(fill)
  3. Волатильность (ATR): при высоком ATR цена пройдёт больший диапазон → выше P(fill)
  4. Directional signal: если OBI подтверждает сигнал → ниже P(fill) (рынок не придёт)
     если OBI против нас → выше P(fill) но выше adverse selection риск

Эмпирическое правило (Johnson):
  Ордер на bid → P(fill) ≈ 50% за 15 минут при обычной волатильности
  Ордер 0.1% ниже mid → P(fill) ≈ 30% за 15 минут
  Ордер 0.3% ниже mid → P(fill) ≈ 10% за 15 минут
```

**Для стратегии входа:** выставлять лимит не глубже 0.1-0.2% от mid при нормальных условиях. Если OB зона дальше — пропускать сигнал или вставлять ордер на границе зоны, не в её середине.

---

## 12. Post-Trade Analytics — измерение качества исполнения

**Kissell** определяет обязательный набор метрик post-trade TCA (Transaction Cost Analysis):

### 12.1 Обязательные метрики

```
1. Arrival Price Slippage (IS):
   IS = (fill_price - arrival_mid) / arrival_mid × 10000 (в bps)
   Benchmark: arrival_mid в момент выставления ордера
   Цель: IS < 5 bps для liquid pairs (BTCUSDT, ETHUSDT)

2. Fill Rate:
   fill_rate = filled_orders / total_signals × 100%
   Цель: > 70% (если меньше — слишком пассивный лимит)

3. Average Time to Fill:
   avg_ttf = mean(fill_time - order_time) в минутах
   Цель: 5-20 минут (если < 2 мин — слишком агрессивный)

4. Adverse Fill Rate:
   adverse_fill = trades_where_price_continued_against_us / filled_orders
   (заполнились, но цена сразу пошла в неправильную сторону > 0.3%)
   Цель: < 25% (если выше — adverse selection проблема)

5. Opportunity Cost Rate:
   opp_cost_rate = signals_where_price_reached_tp_without_fill / total_signals
   (сигнал был правильный, но мы не заполнились)
   Цель: < 20%
```

### 12.2 Реализация логирования

```typescript
interface ExecutionRecord {
  signalId: string;
  symbol: string;
  side: 'buy' | 'sell';
  confluenceScore: number;

  // Pre-trade
  arrivalMid: string;          // mid в момент сигнала
  limitPrice: string;          // наш лимит
  orderBookOBI: number;        // OBI в момент выставления

  // Post-trade
  fillPrice?: string;          // null если не заполнились
  fillTime?: number;           // ms после выставления
  cancelled?: boolean;
  cancelReason?: string;       // 'timeout' | 'structure_invalidation' | 'obi_flip'

  // Calculated
  implShortfall?: number;      // fill_price - arrivalMid в bps
  adverseFill?: boolean;       // цена пошла против нас > 0.3% сразу после fill
}
```

### 12.3 Периодический анализ

Ежемесячно анализировать:

1. Распределение IS по парам: если BTCUSDT IS стабильно < 3 bps — отличное исполнение
2. Fill rate по часам суток: возможно, в 02:00-06:00 UTC слишком мало ликвидности
3. Adverse fill rate по OBI: если adverse fill > 30% при OBI < -0.2 — добавить фильтр
4. P(fill) vs. depth_offset: эмпирически откалибровать оптимальный offset для каждой пары

---

## 13. Практические рекомендации для бота

Синтез Johnson + Kissell применительно к нашей системе:

### Приоритет 1: Limit order placement logic

```
1. Использовать Post-Only лимиты на вход
2. Offset от mid: 0.1-0.2 × spread для нормального сигнала
3. Для сильного сигнала (≥ 80): 0.0-0.1 × spread
4. Выставлять через 15-30 секунд после открытия свечи (не в первые секунды)
```

### Приоритет 2: Adaptive cancellation

```
1. Timeout: 3 свечи = 45 минут для 15M
2. OB invalidation: отменить если цена пробила OB зону
3. OBI flip: отменить если OBI перевернулся существенно (> 0.4 в другую сторону)
4. При отмене: логировать причину для TCA анализа
```

### Приоритет 3: Order book checks перед выставлением

```
1. Проверить OBI: не выставлять при OBI < -0.3 для long (сильное sell давление)
2. Проверить spread: не выставлять если spread > 0.05% (аномальная ликвидность)
3. Проверить depth L1: если bid L1 < $50K — ликвидность аномально низкая
```

### Приоритет 4: TCA logging

```
1. Логировать arrival_mid для каждого сигнала
2. Логировать OBI в момент выставления
3. После исполнения: рассчитать IS и adverse_fill
4. Ежемесячный отчёт по fill_rate, avg_IS, adverse_fill_rate
```

### Приоритет 5: Emergency execution

```
При Stop Telegram команде или SL breach:
  НЕ использовать market order если spread < 0.05%
  Использовать aggressive limit (лимит на 0.1% хуже mid)
  Timeout 30 секунд → если не fill → market order
  Это экономит ~0.02-0.03% vs немедленный market
```

---

## 14. Специфика крипто vs. equity (что меняет книжные концепции)

| Аспект | Equity (книги) | Crypto (наша реальность) |
|--------|---------------|--------------------------|
| Торговые часы | 6.5 ч/день | 24/7 |
| ADV профиль | U-shape (открытие/закрытие) | Менее предсказуем |
| Funding rate | Отсутствует | Каждые 8 часов — аномалии |
| Spoofing | Незаконен (SEC) | Распространён |
| Market impact | Рассчитан по акции | По стакану perpetual (разный от spot) |
| SOR | Множество venues | Один venue (Bybit) |
| Maker/Taker spread | ~1-3 bps | 3.5 bps (0.055% - 0.020%) |
| Overnight gap risk | Значителен | Минимален (24/7) |

**Главная адаптация:** книжные модели рассчитаны на институциональные размеры ($1M+). Для нашего размера (~$11K notional на BTC) — рынок нас "не видит." Оптимизировать нужно не market impact, а fill rate и adverse selection защиту.

---

## Источники

- [Barry Johnson — Algorithmic Trading and DMA (Amazon)](https://www.amazon.com/Algorithmic-Trading-DMA-introduction-strategies/dp/0956399207)
- [Robert Kissell — The Science of Algorithmic Trading (Elsevier)](https://www.sciencedirect.com/book/monograph/9780124016897/the-science-of-algorithmic-trading-and-portfolio-management)
- [Almgren & Chriss — Optimal Execution of Portfolio Transactions (PDF)](https://www.smallake.kr/wp-content/uploads/2016/03/optliq.pdf)
- [Cont & Kukanov — Optimal Order Placement in Limit Order Markets (arXiv)](https://arxiv.org/pdf/1210.1625)
- [Moallemi — A Model for Queue Position Valuation in a LOB](https://moallemi.com/ciamac/papers/queue-value-2016.pdf)
- [Albers et al. — The Market Maker's Dilemma (SSRN 2024)](https://papers.ssrn.com/sol3/Delivery.cfm/5074873.pdf?abstractid=5074873)
- [Order Flow Imbalance Signal Analysis — Dean Markwick](https://dm13450.github.io/2022/02/02/Order-Flow-Imbalance.html)
- [Order Book Imbalance Trading Research — Electronic Trading Hub](https://electronictradinghub.com/leveraging-limit-order-book-imbalances-for-profitable-trading-a-deep-dive-into-recent-research-and-practical-tools/)
- [VWAP vs TWAP in Crypto — TradingView/CoinTelegraph](https://www.tradingview.com/news/cointelegraph:4e659b29e094b:0-twap-vs-vwap-in-crypto-trading-what-s-the-difference/)
- [Bybit Post-Only Orders](https://www.bybit.com/en/help-center/article/What-Is-A-Post-Only-Order)
- [Bybit Maker/Taker Fees](https://www.bybit.com/en/help-center/article/Perpetual-Futures-Contract-Fees-Explained)
- [TCA — Talos Execution Insights](https://www.talos.com/insights/execution-insights-through-transaction-cost-analysis-tca-benchmarks-and-slippage)
- [Implementation Shortfall — CIS Penn (PDF)](https://www.cis.upenn.edu/~mkearns/finread/impshort.pdf)
- [Almgren-Chriss Explainer — SimTrade](https://www.simtrade.fr/blog_simtrade/understanding-almgren-chriss-model-for-optimal-trade-execution/)
