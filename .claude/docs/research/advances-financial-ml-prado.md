# Advances in Financial Machine Learning — Marcos López de Prado

**Источники:**
- "Advances in Financial Machine Learning" (Wiley, 2018)
- "Machine Learning for Asset Managers" (Cambridge University Press, 2020)
- Hudson & Thames mlfinlab library (open-source реализации)

**Дата:** 2026-04-06
**Релевантность для проекта:** CRITICAL — Triple Barrier, Meta-Labeling, CUSUM напрямую применимы

---

## Введение: Почему стандартный подход к бэктестам неверен

Большинство опубликованных алгоритмических стратегий — **ложные открытия** (false
discoveries). Исследование 452 аномальных индикаторов показало: 65% не проходят
базовый порог значимости (t > 1.96), а при поправке на множественное тестирование
(t > 2.78) провал достигает 82%.

Основные причины:
1. **Selection bias** — из сотен тестов публикуются только "успешные"
2. **Backtest overfitting** — стратегия подогнана под исторические данные
3. **Look-ahead bias** — утечка будущих данных в обучение
4. **Нестационарные признаки** — модель обучена на ценах, а не доходностях

López de Prado предлагает систематическое решение каждой проблемы. Ниже —
детальный разбор каждой концепции с применением к нашей системе.

---

## 1. Альтернативные типы баров (Data Structures)

### Проблема временных баров

Стандартные OHLCV свечи (1H, 15M, 1D) имеют серьёзные статистические проблемы:
- **Серийная корреляция доходностей** — в ночное время / выходные объём нулевой, но
  бар всё равно формируется
- **Гетероскедастичность** — волатильность сильно меняется во времени
- **Non-normality** — распределение доходностей далеко от нормального

### Dollar Bars (Долларовые бары)

**Принцип:** бар закрывается не по истечении времени, а после того, как через рынок
прошёл фиксированный объём в деньгах (например, $1B для BTCUSDT).

**Статистические преимущества:**
- Нижняя серийная корреляция (approx. 30% меньше, чем у временных баров)
- Распределение доходностей ближе к нормальному
- Более равномерная информационная насыщенность каждого бара
- Устойчивость к gaps и thin market periods

**Volume Bars** — аналог, но по количеству контрактов/монет.
**Tick Bars** — по количеству сделок.

**Оптимальная частота:** ~50 долларовых баров в сутки обеспечивает лучшие
статистические свойства (по эмпирическим данным López de Prado).

### Imbalance Bars (Информационно-ориентированные бары)

Бар закрывается, когда накопленный дисбаланс (buy vs sell тиков) превышает порог.
Автоматически формируют более плотные бары в периоды активности и редкие — в тихие
периоды. **Максимальная информационная эффективность.**

### Применение для нашего бота

Мы используем временные 15M свечи — это стандарт для SMC-анализа. Переход на
dollar bars **не рекомендуется** без полного переписывания логики идентификации
структуры. Однако понимание их свойств важно: при разработке ML-фичей на базе нашей
сигнальной системы (meta-labeling) стоит рассмотреть dollar bar features как
дополнительный слой подтверждения.

---

## 2. Triple Barrier Method (Метод Тройного Барьера)

### Проблема разметки (Labeling)

Классический подход к разметке: если цена выросла за N баров — метка +1 (buy),
упала — метка -1 (sell). Проблема: такая разметка игнорирует, был ли trade
прибыльным с учётом риска и времени удержания.

### Суть Triple Barrier

Для каждой точки входа устанавливается три барьера:

```
                  ┌─────────────────────────────┐
                  │ UPPER BARRIER (+profit_take) │  → метка +1
                  └─────────────────────────────┘

entry_price ────────────────────────────────────────► время
                  ┌─────────────────────────────┐
                  │ LOWER BARRIER (-stop_loss)  │  → метка -1
                  └─────────────────────────────┘

                  │←────── MAX HOLDING PERIOD ──→│  → метка 0 (нейтрально)
```

**Верхний барьер** (`pt`): profit-take уровень, обычно `entry × (1 + h × σ)`
**Нижний барьер** (`sl`): stop-loss уровень, обычно `entry × (1 - h × σ)`
**Вертикальный барьер** (`t1`): максимальный горизонт удержания (например, 100 баров)

**Метка = первый барьер, который был достигнут:**
- Верхний сначала → **+1** (прибыльная сделка)
- Нижний сначала → **-1** (убыточная сделка)
- Вертикальный (время вышло) → **0** (нейтрально, либо по знаку доходности)

### Параметр `h` (размер барьеров)

Барьеры обычно выражаются в ATR-кратных или в единицах волатильности:

```
upper_barrier = entry + h × ATR(t)
lower_barrier = entry - h × ATR(t)
```

Это делает разметку **адаптивной к текущей волатильности** — в волатильный рынок
барьеры шире, в тихий — уже. Для нашей системы `h` = `slAtrMultiplier` из
`BTCUSDT.json` (текущее значение: 1.5).

### Практическая реализация

```typescript
interface Barrier {
  upperMultiplier: number;   // ATR × X (profit take)
  lowerMultiplier: number;   // ATR × X (stop loss)
  maxHoldingBars: number;    // вертикальный барьер
}

interface TripleBarrierLabel {
  entryBar: number;          // индекс входа
  exitBar: number;           // индекс выхода
  label: 1 | -1 | 0;        // результат
  returnPct: number;         // фактическая доходность
  exitReason: 'upper' | 'lower' | 'vertical';
}

function labelWithTripleBarrier(
  candles: Candle[],
  entryIndex: number,
  entryPrice: number,
  atr: number,
  barrier: Barrier
): TripleBarrierLabel {
  const upper = entryPrice + barrier.upperMultiplier * atr;
  const lower = entryPrice - barrier.lowerMultiplier * atr;
  const maxExit = entryIndex + barrier.maxHoldingBars;

  for (let i = entryIndex + 1; i <= Math.min(maxExit, candles.length - 1); i++) {
    if (candles[i].high >= upper) {
      return { entryBar: entryIndex, exitBar: i, label: 1,
               returnPct: (upper - entryPrice) / entryPrice,
               exitReason: 'upper' };
    }
    if (candles[i].low <= lower) {
      return { entryBar: entryIndex, exitBar: i, label: -1,
               returnPct: (lower - entryPrice) / entryPrice,
               exitReason: 'lower' };
    }
  }
  // вертикальный барьер
  const exitReturn = (candles[maxExit].close - entryPrice) / entryPrice;
  return { entryBar: entryIndex, exitBar: maxExit,
           label: exitReturn > 0 ? 1 : -1,
           returnPct: exitReturn,
           exitReason: 'vertical' };
}
```

### Применение к нашей системе

Triple Barrier идеально подходит для **разметки бэктестных трейдов** при обучении
ML-модели второго уровня (Meta-Labeling). Каждый сигнал нашей SMC+Confluence системы
разметить через Triple Barrier — получим обучающую выборку с корректными метками,
учитывающими и направление, и управление рисками.

**Конкретная конфигурация для BTCUSDT:**
- Upper = SL × RR ratio (наш TP1 = 1.5R → `upperMultiplier = 1.5 × slAtrMultiplier`)
- Lower = ATR × slAtrMultiplier (наш SL)
- Vertical = 100 баров × 15M = 25 часов максимальный горизонт

---

## 3. Meta-Labeling (Мета-разметка)

### Концепция

Meta-Labeling — **двухуровневая архитектура предсказаний**, где:
1. **Первичная модель (M1)** предсказывает направление (long/short)
2. **Вторичная модель (M2)** предсказывает, **стоит ли торговать** по сигналу M1

M1 может быть любой: SMC-алгоритм, simple moving average crossover, ML-классификатор.
M2 принимает на вход:
- Предсказание M1 (направление)
- Контекстные фичи (волатильность, объём, время суток, режим рынка и т.д.)
- Выдаёт вероятность `p ∈ [0, 1]`, что сделка будет прибыльной

### Разделение задач

```
Без Meta-Labeling:
  Одна модель → предсказывает direction + magnitude + timing
  (одновременно три задачи — слишком сложно)

С Meta-Labeling:
  M1 (SMC algorithm) → предсказывает SIDE (long/short)
  M2 (Random Forest) → предсказывает CONFIDENCE (trade or skip)
  Позиция = M1.side × M2.probability (bet sizing)
```

### Преимущества

1. **Separation of concerns** — каждая модель решает одну задачу
2. **Precision improvement** — M2 фильтрует слабые сигналы M1
3. **Recall trade-off** — настраиваемый баланс (порог p > 0.6 → меньше сделок, выше WR)
4. **Bet sizing** — вероятность M2 = размер позиции (Kelly-based)
5. **Интерпретируемость** — M1 объясняет вход, M2 объясняет размер

### Процесс обучения M2

```
1. Собрать все сигналы M1 за исторический период (наш confluence ≥ 70)
2. Разметить через Triple Barrier (метка = 1 если прибыль, 0 если убыток)
3. Составить feature matrix X для каждого сигнала:
   - confluence score breakdown (каждый компонент отдельно)
   - ATR в момент сигнала / ATR_20_avg
   - funding rate
   - объём аномалия (volume ratio)
   - час дня, день недели
   - spread
   - время с последней mitigation OB
   - количество сигналов за последние N баров (избегать кластеризации)
4. Целевая переменная y = triple barrier label (0 или 1)
5. Обучить Random Forest / Gradient Boosting
6. Оценить через CPCV (не обычный train/test split!)
```

### Практическая схема для нашей системы

```
Наша SMC+Confluence система (M1) — уже существует, генерирует сигналы.

M2 (Meta-Labeler) — добавить поверх:
  Input:  все 8 компонентов confluence score + market context features
  Output: p (вероятность успеха сделки)
  
  if p >= threshold:
    execute trade with size = f(p)  // Kelly-based sizing
  else:
    skip signal                     // M1 был неправ
```

**Эффект на метрики (по исследованию Hudson & Thames 2022):**
- Precision (WR) вырастает на 5-15% при правильной реализации
- Recall снижается (меньше сделок) — это trade-off
- Общий Sharpe Ratio улучшается, потому что убираются наихудшие сделки

---

## 4. Fractionally Differentiated Features

### Дилемма: Стационарность vs Память

ML-модели требуют **стационарных** признаков (иначе нельзя обобщить из прошлого на
будущее). Цены нестационарны. Стандартное решение: логарифмические доходности
`r_t = ln(P_t / P_{t-1})`.

Проблема: **целочисленное дифференцирование убивает память ряда.** Цены имеют
долгую память (каждая точка зависит от всей истории). После дифференцирования память
обрывается — теряется информация о долгосрочных трендах, уровнях поддержки и т.д.

### Решение: Дробное дифференцирование

**Оператор дробного дифференцирования** с параметром `d ∈ (0, 1)`:

```
(1 - L)^d × x_t = Σ_{k=0}^{∞} w_k × x_{t-k}

где L — lag оператор, w_k — веса:
  w_0 = 1
  w_k = w_{k-1} × (k - 1 - d) / k

При d = 0: x_t без изменений (нестационарный)
При d = 1: Δx_t = x_t - x_{t-1} (стационарный, без памяти)
При d = 0.3: частично дифференцированный (стационарный, сохраняет ~90% памяти)
```

### Ключевой результат

При `d ≈ 0.1-0.4` для большинства финансовых рядов:
- ADF-тест (стационарность) проходится на 95% уровне значимости
- Корреляция с исходным ценовым рядом > 90%

То есть мы получаем **стационарный признак, который всё ещё "помнит" историю цен.**

### Применение к нашей системе

Для ML Meta-Labeler вместо "цены последние 20 баров" использовать
"фракционно-дифференцированная цена (d=0.3) последние 20 баров". Это даёт:
1. Стационарный вход для модели
2. Сохранение информации о долгосрочных уровнях (OB, FVG levels)

```typescript
function fracDiff(prices: number[], d: number, threshold = 1e-5): number[] {
  // Вычисляем веса (усекаем по threshold)
  const weights: number[] = [1];
  let k = 1;
  while (Math.abs(weights[weights.length - 1]) > threshold) {
    weights.push(weights[weights.length - 1] * (k - 1 - d) / k);
    k++;
  }
  weights.reverse();

  const result: number[] = new Array(prices.length).fill(NaN);
  const w = weights.length;
  for (let i = w - 1; i < prices.length; i++) {
    result[i] = weights.reduce((sum, wk, j) =>
      sum + wk * prices[i - (w - 1 - j)], 0);
  }
  return result;
}
```

**Практический совет:** минимальное d для прохождения ADF-теста по BTCUSDT обычно
лежит в диапазоне 0.2-0.4. Найти конкретное значение:

```typescript
// Бинарный поиск минимального d, при котором ADF p-value < 0.05
function findMinimumD(prices: number[]): number {
  let low = 0, high = 1;
  while (high - low > 0.01) {
    const mid = (low + high) / 2;
    const diffed = fracDiff(prices, mid);
    if (adfTest(diffed).pValue < 0.05) high = mid;
    else low = mid;
  }
  return high;
}
```

---

## 5. CUSUM Filter — Детекция структурных изменений

### Что такое CUSUM

Cumulative Sum (CUSUM) — статистический метод обнаружения изменений среднего
в временном ряду. В финансах используется для двух задач:

**1. Event sampling (отбор событий для разметки)**

Вместо того чтобы создавать метку на каждом баре, отбирать только те бары, где
произошло **значимое движение цены**:

```typescript
function cusumFilter(prices: number[], threshold: number): number[] {
  // threshold обычно = ATR или фиксированный % (0.5%)
  const events: number[] = [];
  let s_pos = 0, s_neg = 0;
  let prev = prices[0];

  for (let i = 1; i < prices.length; i++) {
    const ret = prices[i] - prev;
    s_pos = Math.max(0, s_pos + ret);
    s_neg = Math.min(0, s_neg + ret);

    if (s_pos >= threshold) {
      events.push(i);   // upside event
      s_pos = 0;
    } else if (s_neg <= -threshold) {
      events.push(i);   // downside event
      s_neg = 0;
    }
    prev = prices[i];
  }
  return events;
}
```

**2. Structural break detection (смена режима)**

Более продвинутая версия — **Chow-type structural break test** — обнаруживает
момент, когда распределение доходностей изменилось (смена тренда, режима
волатильности).

Виды тестов на структурные изменения:
- **CUSUM on recursive residuals** (Brown-Durbin-Evans): мониторинг нарастающих
  остатков регрессии
- **Supremum ADF (SADF)**: детекция пузырей и моментов их лопания
- **CUSUM of squares**: изменения в волатильности (не в среднем)

### Применение для нашего бота

**Event sampling через CUSUM** позволяет:
- Обучать Meta-Labeler только на "интересных" рыночных событиях
- Убрать oversampling тихих периодов (ночь, выходные)
- Получить более сбалансированную обучающую выборку

**Threshold рекомендация:** использовать ATR_14 в моменте как adaptive threshold.

**Structural break detection** для нашей системы:
- Обнаружение смены рыночного режима (trend → range → trend)
- Автоматическое "обесценивание" старых весов при обнаружении break
- Триггер для перекалибровки стратегии

```typescript
// Упрощённая детекция режима через CUSUM на волатильности
function detectVolatilityRegime(atrHistory: number[], lookback = 50): 'high' | 'normal' | 'low' {
  const recent = atrHistory.slice(-lookback);
  const mean = recent.reduce((a, b) => a + b) / recent.length;
  const std = Math.sqrt(recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length);
  const current = atrHistory[atrHistory.length - 1];
  const zScore = (current - mean) / std;
  if (zScore > 1.5) return 'high';
  if (zScore < -1.5) return 'low';
  return 'normal';
}
```

---

## 6. Combinatorial Purged Cross-Validation (CPCV)

### Проблема стандартного train/test split для временных рядов

При обычном k-fold CV происходит **утечка данных** из-за:
1. **Serial correlation** — обучающие и тестовые выборки имеют перекрывающиеся метки
2. **Пересечение горизонтов** — Triple Barrier labels могут "смотреть вперёд" через
   границу train/test

Даже walk-forward validation имеет ограничение: один путь (одна последовательность),
что недостаточно для статистической оценки риска переобучения.

### Purged K-Fold

**Первый шаг:** Purging — удалить из обучающей выборки все наблюдения, **горизонт**
которых перекрывается с тестовым периодом.

```
Train 1 | [PURGE ZONE] | Test 1 | [EMBARGO] | Train 2 | Test 2 | ...
```

**Embargo** — дополнительный буфер после test период (обычно 5-10 баров), чтобы
исключить автокорреляцию.

### Combinatorial — несколько путей

CPCV генерирует `C(N, k)` комбинаций train/test splits (вместо одного пути):

```
N = 6 фолдов, k = 2 тестовых фолда одновременно

Пути (paths):
  Тест на [1,2], обучение на [3,4,5,6]
  Тест на [1,3], обучение на [2,4,5,6]
  Тест на [1,4], обучение на [2,3,5,6]
  ... всего C(6,2) = 15 комбинаций
```

Результат: **15 независимых equity curves** — можно построить распределение
out-of-sample Sharpe Ratio и вычислить вероятность переобучения.

### Deflated Sharpe Ratio (DSR)

Учитывает, что мы протестировали множество стратегий:

```
DSR = (SR_obs - E[maxSR]) / std[SR]

где:
  SR_obs = наблюдаемый Sharpe Ratio
  E[maxSR] = ожидаемый максимальный SR при случайном поиске
  E[maxSR] ≈ sqrt(2 × ln(N)) × std[SR] / SR_obs   (при N испытаниях)
```

Если `DSR < 0` — стратегия **статистически незначима** после поправки на множественное
тестирование. Большинство опубликованных стратегий с t-stat < 2.78 не выживают
под DSR при учёте реального числа испытаний.

### Probability of Backtest Overfitting (PBO)

По результатам CPCV вычисляется PBO — вероятность, что IS-оптимальные параметры
покажут худший результат OOS, чем медианная стратегия:

```
PBO = P(rank(OOS_performance | IS_optimal) < 0.5)
```

**PBO < 0.1** (< 10%) — хороший знак, стратегия, вероятно, не переобучена.
**PBO > 0.5** — сигнал о серьёзном переобучении.

### Применение для нашей системы

При калибровке весов и порогов в нашем бэктесте мы по факту делаем множественное
тестирование (пробуем разные параметры). Минимальные требования:

1. **Purging:** при разбивке на периоды оставлять "мёртвую зону" в несколько баров
   после каждого тестового окна
2. **Embargo:** не использовать данные, следующие непосредственно за тестовым
   периодом, в train (наш отчёт должен считать это)
3. **Multiple testing correction:** если мы прогнали M вариантов параметров, требовать
   `t-stat > sqrt(2 × ln(M))` вместо стандартного 1.96

**Практическое правило для нашего бэктеста:**
```
Если мы протестировали 20 комбинаций параметров:
  Minimum t-stat = sqrt(2 × ln(20)) ≈ 2.45  (вместо 1.96)

Если 100 комбинаций:
  Minimum t-stat = sqrt(2 × ln(100)) ≈ 3.03
```

---

## 7. Feature Importance

### Три метода оценки важности признаков

**MDI (Mean Decrease Impurity)**
- In-sample метрика (внутри дерева решений/Random Forest)
- Быстро, но подвержен substitution effects: два коррелированных признака делят
  важность между собой, хотя оба важны
- Рекомендуется для первичного screening

**MDA (Mean Decrease Accuracy)**
- Out-of-sample метрика: обучить → оценить OOS → permute feature → оценить снова
- Важность = снижение accuracy при permutation
- Медленно, но более надёжно
- Тоже подвержен substitution effects

**SFI (Single Feature Importance)**
- Обучить отдельную модель на каждом признаке
- Не страдает от substitution effects
- Самый медленный, но самый честный

**Clustered Feature Importance (CFI)** — best practice:
1. Сгруппировать признаки в кластеры по корреляции
2. Применить MDI/MDA к кластерам
3. Избежать substitution effects при сохранении интерпретируемости

### Какие признаки наиболее важны для нашей системы

На основе академической литературы и эмпирики:

| Признак | Ожидаемая важность | Примечание |
|---|---|---|
| BOS/CHoCH confluence | HIGH | структурный сигнал |
| Order Block quality | HIGH | ключевой SMC компонент |
| ATR ratio (текущий / средний) | HIGH | режим волатильности |
| Volume anomaly | MEDIUM | подтверждение движения |
| FVG presence | MEDIUM | ликвидность в зоне |
| RSI | LOW | запаздывающий при SMC |
| EMA direction | LOW | захватывается структурой |
| Hour of day | MEDIUM | Азия/Европа/Америка сессии |
| Funding rate | MEDIUM | рыночный сентимент |

**Рекомендация:** реализовать SFI на бэктестных данных BTCUSDT, получить реальное
ранжирование, затем убрать признаки с importance ≈ 0 или отрицательной важностью.

---

## 8. Entropy Features — измерение эффективности рынка

### Концепция

Shannon Entropy информационного содержания ценового ряда:

```
H(X) = -Σ p_j × log₂(p_j)

где p_j = вероятность j-го символа в закодированном ценовом ряду
```

**Plug-in entropy estimator (простой)**:
1. Закодировать доходности как символы: `-1` (вниз), `0` (flat), `+1` (вверх)
2. Посчитать частоты n-gram последовательностей
3. Вычислить entropy

**Интерпретация:**
- **Высокая entropy** → рынок близок к случайному блужданию → торговать трудно
- **Низкая entropy** → предсказуемые паттерны → торговать выгодно

### Практическое применение

```typescript
function shannonEntropy(sequence: (-1|0|1)[], n: number = 2): number {
  const ngrams = new Map<string, number>();
  let total = 0;

  for (let i = 0; i <= sequence.length - n; i++) {
    const gram = sequence.slice(i, i + n).join(',');
    ngrams.set(gram, (ngrams.get(gram) || 0) + 1);
    total++;
  }

  let entropy = 0;
  for (const count of ngrams.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Нормализованная entropy: 0 (полностью предсказуемо) → 1 (случайно)
function normalizedEntropy(sequence: (-1|0|1)[], n: number = 2): number {
  return shannonEntropy(sequence, n) / Math.log2(Math.pow(3, n));
}
```

**Использование как фильтр:** если rolling entropy (последние 50 баров) > 0.85 —
рынок случаен, пропустить сигнал. Это дополнительный фильтр к нашему ATR-фильтру.

---

## 9. Bet Sizing — оптимальный размер позиции

### От бинарного к непрерывному

Стандартный подход: сигнал есть → открываем фиксированный размер. López de Prado
предлагает **непрерывное bet sizing** на основе вероятности успеха.

### Kelly-based bet sizing

Дробный Kelly criterion (fraction `f` от максимума для снижения риска):

```
f* = (p × b - q) / b

где:
  p = вероятность выигрыша (output Meta-Labeler)
  q = 1 - p (вероятность проигрыша)
  b = соотношение выигрыш/проигрыш (наш RR ratio = TP/SL)

Для нашего случая (RR = 1.5):
  f* при p = 0.6: (0.6×1.5 - 0.4) / 1.5 = (0.9 - 0.4) / 1.5 = 0.333 (33% Kelly)

Fractional Kelly = f* × 0.5  (половина Kelly, стандартная практика)
```

### Sigmoid-based scaling (практически)

```typescript
function betSize(probability: number, maxSize: number, halfKellyFraction = 0.5): number {
  // probability от Meta-Labeler (0 = точно проигрыш, 1 = точно выигрыш)
  // Нормализуем относительно 0.5 (нейтральная позиция)
  if (probability <= 0.5) return 0;  // не торгуем если < 50%

  // Kelly-based
  const b = 1.5;  // наш RR ratio
  const p = probability;
  const q = 1 - p;
  const kelly = (p * b - q) / b;
  const fractionalKelly = kelly * halfKellyFraction;

  // Размер = baseSize × fractionalKelly / fullKelly
  // Масштабируем так, чтобы при kelly = maxKelly → maxSize
  return Math.min(maxSize, maxSize * fractionalKelly / 0.5);
}
```

### Применение для нашей системы

Текущий подход: фиксированные 22.5% баланса на каждую сделку.
С Meta-Labeler + bet sizing:
- p > 0.7 → 22.5% (полный размер)
- p = 0.6 → 15% (reduced size)
- p < 0.55 → skip (не торгуем)

Это сохраняет HyroTrader compliance (не превышаем 25%) и улучшает risk-adjusted returns.

---

## 10. Hierarchical Risk Parity (HRP)

### Проблема Markowitz (Mean-Variance Optimization)

Классическая MVO ищет:
```
min w^T × Σ × w   subject to   w^T × μ = target_return
```

Проблема: **матрица ковариаций нестабильна** — небольшие ошибки в оценке Σ приводят
к огромным изменениям оптимальных весов. "Проклятие Марковица" — MVO оптимально
в выборке (in-sample), катастрофически нестабильно вне выборки (out-of-sample).

### HRP алгоритм (3 шага)

**Шаг 1: Tree Clustering**

Построить дерево похожести активов через иерархическую кластеризацию
корреляционной матрицы (Ward linkage или Average linkage):

```python
# Дистанция = sqrt((1 - ρ_ij) / 2), где ρ_ij = корреляция
dist_matrix = sqrt((1 - corr_matrix) / 2)
linkage = scipy.cluster.hierarchy.ward(dist_matrix)
```

**Шаг 2: Quasi-Diagonalization**

Переупорядочить матрицу ковариаций так, чтобы похожие активы стояли рядом.
Алгоритм: рекурсивный обход дерева кластеризации, листья = отсортированные активы.

**Шаг 3: Recursive Bisection**

Разделить активы на две группы по дереву. Каждой группе присвоить вес
обратно пропорционально её дисперсии (inverse-variance allocation):

```
w_left = V_right / (V_left + V_right)
w_right = V_left / (V_left + V_right)

где V = Σ_i Σ_j w_i × w_j × Cov(i, j) — variance of sub-portfolio
```

Повторять рекурсивно до отдельных активов.

### HRP vs MVO: результаты

| Метрика | MVO (in-sample optimal) | HRP |
|---|---|---|
| Out-of-sample variance | Высокая (нестабильно) | Низкая |
| Concentration | Высокая (2-3 актива) | Низкая (диверсифицировано) |
| Требует инвертировать Σ | Да | Нет |
| Работает с вырожденной Σ | Нет | Да |
| Sharpe Ratio OOS | Ниже MVO in-sample | Выше MVO out-of-sample |

### Применение для нашей системы

При масштабировании на 5-8 пар (BTCUSDT, ETHUSDT, SOLUSDT, ...) HRP — **идеальный
метод для распределения risk budget**:

```typescript
// Для 5 пар вместо равных весов (20% каждая):
// 1. Посчитать корреляции доходностей пар (rolling 90 дней)
// 2. Построить HRP-дерево
// 3. Получить веса: например {BTC: 0.30, ETH: 0.25, SOL: 0.15, LINK: 0.20, DOT: 0.10}
//    (SOL получает меньше weight из-за высокой корреляции с ETH и высокой волатильности)
// 4. risk budget = HRP_weight × total_position_limit

interface HRPWeights {
  [symbol: string]: number;  // сумма = 1.0
}
```

**Практическая ценность для нашего проекта:**
- Автоматически уменьшает концентрацию в высоко-коррелированных активах
- Не требует прогноза доходностей (только covariance matrix)
- Устойчив к выбросам и нестационарности
- В рамках HyroTrader: суммарный risk ≤ 10% → HRP обеспечивает его оптимальное
  распределение между парами

---

## 11. Опасность Бэктестинга

### Сколько стратегий нужно протестировать, чтобы найти "рабочую" случайно

При 5% уровне значимости (p < 0.05):
- Тестируя 20 случайных стратегий → ожидаем 1 "значимую" случайно
- Тестируя 100 → ожидаем 5 случайно значимых
- Тестируя 1000 → ожидаем 50

**Вывод:** если Sharpe Ratio > 1.0 после тестирования 100 вариантов параметров —
это почти гарантированно переобучение.

### Bailey-López de Prado: минимальная длина бэктеста

Для получения **статистически значимого** результата при заданном числе
испытаний N и наблюдаемом SR:

```
T_min = (Z_α/β / SR)² × (1 + (1 - γ₃ × SR) / 4 × σ_SR²)

грубое приближение: T ≥ (2.33 × N^0.5 / SR)² лет данных
```

Для нашего случая (SR ≈ 1.5, N = 50 parameter combinations):
```
T_min ≈ (2.33 × 50^0.5 / 1.5)^2 ≈ 121 месяцев ≈ 10 лет
```

Это объясняет, почему 3M/6M/1Y бэктесты дают ненадёжные результаты — **минимальная
статистически значимая длина значительно больше**.

### Практические правила против переобучения

1. **Не более 1 параметра на 252 бара** данных (López de Prado rule of thumb)
2. **Каждый параметр должен иметь экономическое обоснование** (не подбор чисел)
3. **Walk-forward validation** как минимум с 3 out-of-sample окнами
4. **Purging + Embargo** при любом cross-validation
5. **Deflated Sharpe Ratio** > 0 обязателен при N > 10 испытаний

---

## 12. Синтез: Что внедрить в нашу систему

### Уровень приоритета

#### CRITICAL (реализовать в ближайшем релизе)

**A. CUSUM Event Filter в бэктесте**
- Заменить "каждая 15M свеча" на "события с CUSUM threshold = ATR_14"
- Убирает ~60-70% избыточных наблюдений тихого рынка
- Улучшает качество обучающей выборки для Meta-Labeler

**B. Triple Barrier Labeling в бэктестном reporter**
- Заменить simple P&L label на Triple Barrier label
- Даёт корректные метки с учётом SL/TP структуры
- Основа для обучения Meta-Labeler

**C. Purging в бэктесте (минимальный уровень)**
- При калибровке добавить "мёртвую зону" 20-50 баров между train/test
- Предотвратить data leakage через Triple Barrier horizons

#### HIGH (следующий этап)

**D. Meta-Labeler (M2) поверх SMC+Confluence**
- Обучить Random Forest на исторических сигналах
- Input features: 8 компонентов confluence + ATR ratio + volume anomaly + hour + funding
- Output: вероятность успеха сделки
- Порог p > 0.60 для исполнения

**E. Entropy Filter**
- Rolling entropy (последние 50 баров, n=2 gram)
- Фильтр: entropy > 0.85 → skip signal (рынок случаен)

**F. Fractional Differentiation в feature engineering**
- Фракционно-дифференцированная цена (d=0.3) как признак для Meta-Labeler
- Заменяет raw prices как вход в ML-модель

#### MEDIUM (расширение на 5 пар)

**G. HRP для распределения risk budget между парами**
- Rolling 90-дневная корреляционная матрица пар
- HRP веса → risk budget на каждую пару
- Пересчёт раз в неделю

**H. Deflated Sharpe Ratio в бэктестном reporter**
- Автоматический расчёт DSR с учётом числа испытаний параметров
- "Предупреждение о переобучении" если DSR < 0

### Архитектурная схема с Meta-Labeling

```
                    ┌─────────────────────────────────────────┐
                    │           MARKET DATA (15M bars)        │
                    └──────────────────┬──────────────────────┘
                                       │
                              CUSUM Event Filter
                         (только значимые движения)
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │      M1: SMC + Confluence Scorer        │
                    │   (текущая система, score ≥ 70)         │
                    │                                         │
                    │  Output: side (long/short) + breakdown  │
                    └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │      M2: Meta-Labeler (RF model)        │
                    │                                         │
                    │  Input:  M1.breakdown + market context  │
                    │  Output: p (вероятность успеха)         │
                    └────────────────┬────────────────────────┘
                                     │
                              p < 0.55 → SKIP
                              p ≥ 0.55 → TRADE
                                     │
                    ┌────────────────▼────────────────────────┐
                    │         Bet Sizing (Kelly-based)        │
                    │   size = f(p, RR ratio, base_size)      │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │         HyroTrader Compliance           │
                    │   Daily DD / Max DD / SL checks         │
                    └────────────────┬────────────────────────┘
                                     │
                                  EXECUTE
```

---

## Список источников

- [Does Meta-Labeling Add to Signal Efficacy? — Hudson & Thames](https://hudsonthames.org/does-meta-labeling-add-to-signal-efficacy-triple-barrier-method/)
- [Triple Barrier Labeling — William Santos](https://williamsantos.me/posts/2022/triple-barrier-labelling-algorithm/)
- [Combinatorial Purged Cross-Validation — Towards AI](https://towardsai.net/p/l/the-combinatorial-purged-cross-validation-method)
- [Fractional Differentiation — Springer](https://link.springer.com/article/10.1007/s12572-021-00299-5)
- [Hierarchical Risk Parity — SSRN (López de Prado 2016)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2708678)
- [Clustered Feature Importance — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3517595)
- [A Data Science Solution to the Multiple-Testing Crisis — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3177057)
- [Meta-Labeling — Wikipedia](https://en.wikipedia.org/wiki/Meta-Labeling)
- [Hierarchical Risk Parity — Wikipedia](https://en.wikipedia.org/wiki/Hierarchical_Risk_Parity)
- [Hudson & Thames mlfinlab documentation](https://www.mlfinlab.com/en/latest/)
- [Cross Validation in Finance: Purging, Embargoing — QuantInsti](https://blog.quantinsti.com/cross-validation-embargo-purging-combinatorial/)
- [Backtest Overfitting in Finance — Oxford Academic](https://academic.oup.com/jrssig/article-abstract/18/6/22/7038278)
- [Feature Importance: MDI, MDA, SFI — mlfinlab](https://www.mlfinlab.com/en/latest/feature_importance/afm.html)
