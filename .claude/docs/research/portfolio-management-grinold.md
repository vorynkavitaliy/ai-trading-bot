# Portfolio Management: Grinold & Kahn, Ernest Chan, López de Prado

**Date:** 2026-04-06
**Sources:**
- Grinold & Kahn, "Active Portfolio Management" (2nd ed., McGraw-Hill, 1999)
- Ernest P. Chan, "Machine Trading" (Wiley, 2017)
- Marcos López de Prado, "Causal Factor Investing" (Cambridge University Press, 2023)
- Clarke, de Silva, Thorley — "Portfolio Constraints and the Fundamental Law" (FAJ, 2002)
- López de Prado — "Building Diversified Portfolios that Outperform Out-of-Sample" (JPM, 2016)
- Zarattini et al., "Catching Crypto Trends" (SSRN 5209907, April 2025)

---

## 1. The Fundamental Law of Active Management

### 1.1 Базовая формула

Гринольд (1989) сформулировал основной закон активного управления:

```
IR = IC × √BR
```

Расширенная версия с коэффициентом переноса (Clarke et al., 2002):

```
IR = TC × IC × √BR
```

Где:
- **IR** (Information Ratio) — риск-скорректированная избыточная доходность. Отношение среднего активного дохода к его стандартному отклонению (tracking error).
- **IC** (Information Coefficient) — качество сигнала. Spearman-корреляция между прогнозом и реализованной доходностью. Диапазон: [-1, +1].
- **BR** (Breadth) — количество **независимых** ставок в год.
- **TC** (Transfer Coefficient) — насколько хорошо прогнозы транслируются в реальные позиции. Снижается при наличии ограничений.

### 1.2 Интерпретация IC

| IC | Трактовка |
|----|-----------|
| < 0.03 | Слабый сигнал (практически шум) |
| 0.03 — 0.05 | Минимально значимый |
| 0.05 — 0.10 | Хороший (у профессиональных менеджеров) |
| > 0.10 | Исключительный (или overfitting) |
| > 0.15 | Почти наверняка overfitting |

Важно: IC должен быть **стабильным и персистентным**, а не разовым выбросом. IC = 0.05 со 100 независимыми ставками в год даёт IR = 0.05 × √100 = 0.5 — уже хорошая риск-скорректированная доходность.

### 1.3 Breadth: что считать независимой ставкой

Закон работает правильно только если ставки **действительно независимы**. Это ключевой момент, часто игнорируемый на практике.

**Что НЕ является независимой ставкой:**
- Два trade на BTC и ETH в один день при корреляции 0.88 — это одна ставка, не две.
- Два лонга по BTC в понедельник и вторник, основанные на одном и том же сигнале — это одна extended ставка.
- Пять одновременных лонгов по altcoins в период BTC-ралли — это примерно 1-2 независимые ставки.

**Формула эффективного Breadth при коррелированных активах:**

```
BR_effective = N / (1 + (N-1) × ρ_avg)

Где:
  N     = количество пар/стратегий
  ρ_avg = средняя попарная корреляция сигналов
```

**Числовой пример для нашего портфеля (5 пар, ρ_avg = 0.70):**

```
BR_effective = 5 / (1 + 4 × 0.70) = 5 / 3.8 ≈ 1.3

При 30 сделках/год на пару (150 итого):
  BR_nominal    = 150 ставок/год
  BR_effective  = 150 / 3.8 ≈ 39 независимых ставок/год
```

Это означает: 150 correlated trades дают не IR = IC × √150 = IC × 12.2, а IR = IC × √39 ≈ IC × 6.2. Разница в 2 раза по IR.

### 1.4 Квадратный корень: почему важен масштаб

```
IC = 0.06 (хороший сигнал, но реалистичный для SMC)

BR = 10:  IR = 0.06 × √10 = 0.19   (плохо)
BR = 25:  IR = 0.06 × √25 = 0.30   (приемлемо)
BR = 50:  IR = 0.06 × √50 = 0.42   (хорошо)
BR = 100: IR = 0.06 × √100 = 0.60  (отлично)
```

Из квадратного корня следует принцип убывающей отдачи от breadth: удвоение числа ставок даёт прирост IR лишь в √2 ≈ 1.41 раза. Чтобы удвоить IR — нужно учетверить breadth или удвоить IC.

### 1.5 Transfer Coefficient при ограничениях

TC = 1.0 в теории (нет ограничений, позиции строго пропорциональны прогнозам).
На практике — TC = 0.3 — 0.8 из-за:
- Long-only ограничения (нет шортов)
- Лимиты на максимальный размер позиции
- Prop firm DD ограничения (HyroTrader 5% daily DD)
- Блокировка пары при корреляции >0.8 с уже открытой позицией

Полный закон при TC = 0.6:

```
IR_actual = TC × IC × √BR = 0.6 × 0.06 × √50 = 0.6 × 0.06 × 7.07 = 0.25
```

Это хорошее значение для algorithmic crypto trading.

---

## 2. Alpha: природа, измерение и комбинирование

### 2.1 Что такое alpha в контексте систематической торговли

Гринольд-Кан определяют alpha как прогноз **избыточной доходности** — возврата сверх benchmark (или нулевого возврата для long-short) **после учёта рыночного beta**.

Для нашего бота:
- Benchmark = USDT (cash, нулевая доходность)
- Alpha = прибыль от сигнала за вычетом financing costs (funding rate perpetual)
- Beta exposure = нежелательно, но неизбежно при высоком BTC-корреляции пар

### 2.2 Alpha Decay — период жизни сигнала

Сигнал имеет период полураспада — после которого его предсказательная сила резко падает.

```
Типичные периоды полураспада (empirical):
  Краткосрочный импульс (15M OB/FVG):  1-4 часа (8-16 свечей 15M)
  Среднесрочный импульс (1H/4H):       1-3 дня
  Долгосрочный тренд (daily trend):    2-6 недель

Следствие для нас:
  - OB на 15M: TTL = 20 свечей (5 часов) — текущая реализация верна
  - FVG в Phase 2: TTL = 8-12 свечей (2-3 часа)
  - Если позиция не исполнена за N свечей → отменить (zombie orders)
```

Alpha decay объясняет, почему time-based exit снижает DD без потери WR: позиции, которые "не пошли" за 14 баров, скорее всего торгуют устаревший сигнал.

### 2.3 Комбинирование alpha-источников

Гринольд-Кан показывают, что оптимальное комбинирование нескольких сигналов — взвешивание по IC:

```
Combined_alpha = Σ (IC_i / Σ IC_j) × alpha_i

Где IC_i = Spearman correlation(signal_i, forward_return)
```

Это прямое теоретическое обоснование нашей confluence scoring системы. Компоненты с более высоким IC (BOS/CHoCH, OB, FVG) получают бо́льший вес — что соответствует текущим весам 25/20/20.

Пересмотр весов через ablation study (уже задокументированный подход) — это практическая реализация IC-weighted combination.

**Условие включения компонента:**
- IC < 0.02 → компонент не несёт информации, убрать
- IC < 0 → компонент вредит, убрать немедленно
- ICIR (IC / StdDev(IC)) < 0.5 → нестабильный сигнал, убрать

---

## 3. Построение портфеля: MVO и его ограничения

### 3.1 Классическое MVO — теория

Марковиц (1952) показал, что оптимальный портфель максимизирует return при заданном уровне риска:

```
max   μᵀw - (λ/2) wᵀΣw

Где:
  w  = вектор весов
  μ  = вектор ожидаемых доходностей
  Σ  = матрица ковариаций
  λ  = коэффициент неприятия риска
```

### 3.2 Почему MVO не работает для нашего портфеля

Гринольд-Кан, Лопес де Прадо и Чан единодушны: MVO имеет системные проблемы для малых портфелей с неустойчивыми оценками.

**Проблема 1 — Instability:**
Матрица ковариаций Σ оценивается по историческим данным. При малой выборке (N=5-8 пар, 1 год данных = 252 точки) оценка крайне нестабильна. Малые изменения в входных данных → кардинально разные веса.

**Проблема 2 — Estimation error amplification:**
MVO "усиливает" ошибки оценки. Активы с завышенным estimate μ получают чрезмерный вес. Активы с заниженным estimate μ получают нулевой или отрицательный вес (short).

**Проблема 3 — Expected returns are unknowable:**
IC наших сигналов ≈ 0.05-0.10. Это означает, что точность прогноза доходности — примерно ±10-15%. MVO требует значительно более высокой точности μ для получения стабильных результатов.

**Практический вывод:** MVO для 5-8 криптопар с данными за 1 год = "мусор на входе, мусор на выходе". Альтернативы — IVP, HRP, равновесный вес.

### 3.3 Risk Parity как практическая альтернатива

**Inverse Variance Portfolio (IVP)** — самый простой подход:

```
w_i = (1 / σ_i²) / Σ (1 / σ_j²)

Где σ_i = историческое стандартное отклонение доходностей пары i
```

IVP игнорирует корреляции (что является weakness), но зато не требует обращения матрицы. Для нашего случая (высокие корреляции ≈ 0.8) — это не критичный недостаток, т.к. корреляции примерно равны.

**Эффект:** Более волатильные пары (SOL, PEPE) получают меньшие веса. Менее волатильные (BTC, ETH) — бо́льшие.

---

## 4. Hierarchical Risk Parity (HRP)

### 4.1 Теоретическая основа

Лопес де Прадо (2016) предложил HRP — подход, основанный на кластеризации:

**Три шага:**
1. **Tree Clustering** — построение иерархического дерева активов на основе попарных корреляций (Ward linkage).
2. **Quasi-diagonalization** — перестановка активов так, чтобы похожие активы оказались рядом в матрице.
3. **Recursive bisection** — рекурсивное распределение весов: каждый кластер получает вес, обратно пропорциональный его риску.

**Преимущества перед MVO:**
- Не требует обращения матрицы ковариаций (никакой нестабильности)
- Стабильно при малых выборках
- Outperforms MVO out-of-sample в большинстве проведённых экспериментов
- Работает с non-invertible covariance matrices

### 4.2 HRP для нашего портфеля из 5-8 пар

**Шаг 1 — Матрица корреляций (empirical):**

```
       BTC   ETH   SOL   DOGE  XRP
BTC    1.00  0.87  0.82  0.75  0.65
ETH    0.87  1.00  0.75  0.72  0.61
SOL    0.82  0.75  1.00  0.70  0.58
DOGE   0.75  0.72  0.70  1.00  0.55
XRP    0.65  0.61  0.58  0.55  1.00
```

**Шаг 2 — Дерево кластеров (концептуально):**

```
           Portfolio
          /          \
     Cluster A      Cluster B
    /    \              |
  BTC   ETH         SOL-DOGE-XRP
```

**Шаг 3 — Распределение весов:**

Пример при σ = {BTC: 1.5%, ETH: 1.8%, SOL: 2.2%, DOGE: 2.5%, XRP: 1.9%}:

```
IVP weights:
  BTC  ∝ 1/0.015² = 4444 → w ≈ 34%
  ETH  ∝ 1/0.018² = 3086 → w ≈ 24%
  SOL  ∝ 1/0.022² = 2066 → w ≈ 16%
  DOGE ∝ 1/0.025² = 1600 → w ≈ 12%
  XRP  ∝ 1/0.019² = 2770 → w ≈ 21% (но скорректирован кластером)

HRP отличается: учитывает, что BTC и ETH в одном кластере → суммарный вес кластера
снижается, что даёт менее концентрированный портфель.
```

**Критическое наблюдение из исследований (2025):**

Практический бэктест (июнь 2022 — июнь 2025) показал, что при криптопортфеле HRP outperforms по Sharpe, но underperforms по абсолютной доходности vs simple BTC hold. Причина: в бычьем рынке BTC + ETH-концентрация выигрывает, т.к. они тянут портфель сильнее.

Для нас это не проблема — мы торгуем СИГНАЛЫ, не хоним активы. HRP применяется к **распределению risk budget между стратегиями**, не к весам buy-and-hold.

### 4.3 Как применить HRP к нашим сигналам

Вместо "сколько держать BTC vs ETH" — HRP решает "какой risk budget выделить каждой паре":

```
Risk Budget per pair = HRP_weight × Total_Risk_Budget

Total_Risk_Budget = Portfolio_Heat_Cap × Account_Balance
                  = 4% × $10,000 = $400/день

Пример HRP allocation:
  BTC:  30% → $120/день max risk
  ETH:  25% → $100/день max risk
  SOL:  20% → $80/день max risk
  XRP:  15% → $60/день max risk
  DOGE: 10% → $40/день max risk
```

---

## 5. Чан: Практический мультистратегийный подход

### 5.1 Принципы мультистратегийного портфеля

Эрнест Чан в "Machine Trading" формулирует практические принципы:

**Принцип 1 — Uncorrelated returns, not uncorrelated assets:**

Цель — некоррелированность ДОХОДНОСТЕЙ стратегий, не активов. Две стратегии на BTC (трендовая + mean reversion) дают меньшую корреляцию доходностей, чем одна трендовая на BTC и одна трендовая на ETH.

```
Correlation matrix примера (гипотетическая):
                     SMC_BTC  SMC_ETH  MR_BTC  Supertrend_SOL
SMC_BTC             1.00      0.72    -0.15       0.60
SMC_ETH             0.72      1.00    -0.12       0.54
MR_BTC             -0.15     -0.12    1.00       -0.08
Supertrend_SOL      0.60      0.54   -0.08        1.00
```

Mean Reversion на BTC даёт практически нулевую корреляцию с трендовыми стратегиями — это настоящий независимый BR.

**Принцип 2 — Sharpe ratio портфеля при uncorrelated strategies:**

```
SR_portfolio = √(Σ SR_i²)    (при нулевой корреляции)

Пример:
  SMC_BTC:        SR = 0.8
  SMC_ETH:        SR = 0.7
  Supertrend_SOL: SR = 0.9

  SR_portfolio ≈ √(0.64 + 0.49 + 0.81) = √1.94 ≈ 1.39

Vs единственная стратегия SMC_BTC: SR = 0.8
```

Диверсификация через некоррелированные стратегии улучшает Sharpe в √N раз (при нулевой попарной корреляции) — прямое следствие фундаментального закона.

**Принцип 3 — Режим-зависимое распределение капитала (CPO):**

Чан предлагает Conditional Portfolio Optimization: веса стратегий меняются в зависимости от рыночного режима.

```
Признаки рыночного режима:
  ADX(BTC, 4H) > 25 → Trending режим
  ADX(BTC, 4H) < 20 → Ranging режим
  VIX/BVOL(BTC, 30d) > 80% percentile → High-vol режим

Allocation matrix:
  Режим          SMC_trend  MR_reversal  Skip/Reduce
  Trending        70%          10%          20%
  Ranging         20%          70%          10%
  High-vol        30%          30%          40% (reduced overall)
```

### 5.2 Практические реализации у Чана

**Калибровка весов через backtested returns correlation:**

Шаг 1: Запустить все стратегии на исторических данных независимо.
Шаг 2: Построить матрицу корреляций ежедневных P&L.
Шаг 3: Применить HRP к P&L матрице (не к price matrix).

```typescript
// Псевдокод
const strategies = ['SMC_BTC', 'SMC_ETH', 'Supertrend_SOL', 'MR_BTC'];
const dailyPnL = backtest.getDailyPnLMatrix(strategies);  // [dates × strategies]
const corrMatrix = computeSpearmanCorrelation(dailyPnL);
const hrpWeights = hierarchicalRiskParity(corrMatrix, dailyPnL.std());
// hrpWeights → risk budget per strategy
```

**Walk-forward rebalancing:**

Чан рекомендует не фиксировать веса навсегда, а пересчитывать их периодически:
- Период калибровки: 6 месяцев
- Период удержания: 1-3 месяца
- Trigger для внеплановой ребалансировки: когда P&L корреляция между стратегиями превысила порог (например, ρ > 0.85 за последние 30 дней) → стратегии начали "слипаться" в режиме market stress.

---

## 6. Лопес де Прадо: Причинные факторы и предотвращение overfit

### 6.1 Factor Mirages

Лопес де Прадо в "Causal Factor Investing" (2023) доказывает, что большинство факторных моделей — это statistical artefacts, а не реальные alpha источники:

**Confounding bias:** Фактор A предсказывает доходность только потому, что коррелирует с фактором B, который реально движет рынок. Исключение B → A перестаёт работать.

**Collider bias:** Выбор по фактору создаёт ложную корреляцию между факторами, которые реально независимы.

**Применение к нам:**
Наш confluence score комбинирует OB, FVG, BOS. Вопрос: они независимые alpha источники или один и тот же механизм (институциональный поток)? Вероятно, все три — проявления одного causal mechanism (institutional order flow). Если это так, тогда IC не суммируются — они выражают одну и ту же alpha, и наш BR не растёт от добавления всех трёх.

**Практический тест на независимость сигналов:**

```
1. Стратегия только с OB → metrics
2. Стратегия только с FVG → metrics
3. Стратегия только с BOS → metrics
4. Стратегия с OB+FVG → если metrics значительно лучше, чем max(1,2) → они независимы
5. Если metrics ≈ max(1,2) → они capturing same alpha, BR не удваивается
```

### 6.2 HRP как защита от overfitting

MVO максимизирует in-sample performance, что ведёт к overfitting. HRP не оптимизирует под конкретную history — поэтому стабильнее out-of-sample.

Лопес де Прадо показывает: в симуляциях с 10,000 случайными портфелями HRP outperforms MVO в 75% случаев on out-of-sample data. Причина — HRP "не запоминает" in-sample отклонения.

**Для нас:** При выборе risk budget allocation по парам — использовать HRP по volatility/correlation исторических P&L, не пытаться угадать "лучшую" пару через MVO.

### 6.3 Backtesting best practices (López de Prado)

Три правила, которые отделяют реальный alpha от statistical artefact:

1. **Combinatorial Purged Cross-Validation (CPCV):** Несколько непересекающихся train/test splits с purging (удалением overlapping samples). Применительно к нам: минимум 3 независимых OOS-периода.

2. **Deflated Sharpe Ratio (DSR):** Когда мы тестируем N конфигураций стратегии, реальный порог Sharpe должен быть выше простого benchmar-а, т.к. из N попыток одна случайно окажется хорошей. DSR = SR × функция(N_trials). Чем больше перебор параметров → тем выше должен быть SR для принятия стратегии.

3. **False Discovery Rate:** При тестировании 20 параметров один из них будет казаться значимым просто случайно (при p=0.05). Поправка Бенджамини-Хохберга — стандарт для множественных тестов.

---

## 7. Rebalancing: когда и как пересматривать веса

### 7.1 Costs vs Benefits трейдофф

Каждая ребалансировка имеет стоимость (transaction costs, slippage) и выгоду (коррекция к оптимальным весам).

**Оптимальная частота ребалансировки:**

```
Чем быстрее alpha decay → тем чаще нужна ребалансировка
Чем выше transaction costs → тем реже оптимальна ребалансировка

Для 15M SMC стратегии:
  Alpha decay: 2-5 часов
  Position-level rebalancing: каждая сделка (implicit)
  Portfolio weights rebalancing: каждые 1-3 месяца

Trigger-based rebalancing (вместо calendar-based):
  Trigger: если текущие веса отклонились >20% от target weights
  (Zarattini, 2025: rebalance only if deviation >20% of target allocation)
```

**Модель оптимальной ребалансировки (Almgren-Chriss):**

Минимизировать transaction costs vs tracking error:

```
Optimal rebalance size = f(alpha_strength, alpha_decay_rate, transaction_cost)

Правило Чана: только ребалансировать позицию если
  expected_gain_from_rebalancing > 2 × transaction_cost
```

### 7.2 Portfolio Heat как реальный механизм ребалансировки

Для нашего бота "ребалансировка" означает прежде всего управление risk exposure:

```
Portfolio Heat = Σ (open_positions × risk_per_position)

Максимум: 4% account balance (80% от HyroTrader 5% daily DD limit)

Правила:
  Heat < 2%: принимать любой новый сигнал score >= 70
  Heat 2-4%: принимать только score >= 80 (повышенный порог)
  Heat > 4%: блокировать новые входы
```

Это неявная форма ребалансировки — при высоком Portfolio Heat новые сигналы игнорируются, уменьшая expo к trailing risk.

---

## 8. Performance Attribution

### 8.1 Компоненты доходности (Brinson-Hood-Beebower framework)

Общая доходность = Allocation Effect + Selection Effect + Interaction Effect.

Для нашего мультипарного бота адаптация:

```
Total P&L = Σ по парам [
    Allocation Effect     — выбрали ли мы правильную пару (нужно ли было торговать)
  + Selection Effect      — качество входа/выхода конкретной сделки
  + Timing Effect         — торговали ли в правильном рыночном режиме
]
```

### 8.2 Практическая атрибуция для нашего бота

**По-парная декомпозиция:**

```
BTC contribution = (BTC_trades / Total_trades) × BTC_avg_return
ETH contribution = (ETH_trades / Total_trades) × ETH_avg_return
...

Вопросы атрибуции:
  1. Какая пара генерирует бо́льшую часть прибыли?
  2. Какой компонент confluence score наиболее предиктивен?
  3. В какой рыночный режим стратегия работает лучше всего?
```

**По-компонентная декомпозиция сигнала:**

```
Для каждой выигрышной/проигрышной сделки логировать:
  - Какие компоненты набрали очки
  - Итоговый score
  - Breakdown по компонентам

Затем:
  win_trades → avg scores по компонентам
  loss_trades → avg scores по компонентам

  IC_component = Spearman(component_score, trade_outcome)
```

### 8.3 Факторная атрибуция (López de Prado approach)

Вместо "какая пара лучше" → "какой фактор объясняет доходность":

```
Факторы для нашего бота:
  1. BTC Trend Factor:    ADX(BTC, 4H) > 20 → trending trades
  2. Volatility Factor:  ATR(pair, 14) / price
  3. Liquidity Factor:   time of day (Asian/London/NY session)
  4. Momentum Factor:    RSI < 35 или RSI > 65 при входе

Регрессия:
  Trade_Return = β₁×BTC_Trend + β₂×Volatility + β₃×Session + β₄×Momentum + ε

  Значимые β → реальные факторы alpha
  Незначимые β → убрать из стратегии (они шум)
```

---

## 9. Применение к нашей системе: максимизация Breadth

### 9.1 Текущая ситуация

```
Текущий бот (1 пара — BTC):
  Trade frequency: ~28 сделок/год
  BR_nominal:      28
  BR_effective:    28 (1 пара, независимость = 100%)
  IC (оценка):     0.06 (WR ~63%, RR ~1.5, E ≈ 0.45R → IC ≈ 0.06)
  IR = 0.06 × √28 = 0.32   → приемлемо

Целевой бот (5 пар, смешанные стратегии):
  Trade frequency: ~140-180 сделок/год
  BR_nominal:      ~160
  ρ_avg между парами: ~0.70 (все трендовые SMC стратегии)
  BR_effective:    ~160 / (1 + 4×0.70) = 160 / 3.8 ≈ 42
  IR = 0.06 × √42 ≈ 0.39   → умеренный прирост (+22%)
```

### 9.2 Как РЕАЛЬНО увеличить эффективный Breadth

**Путь 1 — Добавить стратегии с разными стилями (наиболее эффективно):**

```
Пара стратегий с ρ(returns) ≈ 0:
  SMC_trend (BTC, ETH)          ↔   Mean_Reversion (BTC flat periods)
  Supertrend_breakout (SOL)     ↔   Range_fade (ETH stable periods)

При добавлении MR_BTC к SMC_BTC:
  ρ = -0.10 (антикорреляция)
  BR_effective = 2 / (1 + 1×(-0.10)) = 2 / 0.9 = 2.22  ← выше 2!

При нулевой корреляции:
  BR_effective = N (linear scaling)
```

**Путь 2 — Добавить пары с более низкой корреляцией:**

```
Добавление XRP (ρ_btc ≈ 0.65) вместо AVAX (ρ_btc ≈ 0.82):
  BR_effective улучшится, т.к. XRP вносит более независимый сигнал

Приоритет по contribution to BR_effective:
  1. XRP  (ρ = 0.65) — лучший диверсификатор
  2. DOGE (ρ = 0.72) — хороший
  3. SOL  (ρ = 0.82) — умеренный
  4. ETH  (ρ = 0.87) — минимальный вклад в BR
```

**Путь 3 — Торговать разные таймфреймы (разный alpha decay):**

```
Стратегии на разных таймфреймах имеют разный alpha decay →
разные holding periods → менее коррелированные P&L:

  SMC_15M:    alpha decay ~3-4 часа, holding ~2-8 часов
  Supertrend_1H: alpha decay ~12-24 часа, holding ~1-3 дня
  Trend_4H:   alpha decay ~2-5 дней, holding ~3-10 дней

  ρ(SMC_15M, Trend_4H) ≈ 0.20-0.35  (намного ниже, чем ρ(SMC_15M, SMC_1H) ≈ 0.60)
```

**Путь 4 — Sesion-based независимость:**

```
Asian session trades и NY session trades частично независимы.
Причина: в азиатскую сессию BTC движется по локальным ликвидным зонам,
в NY сессию — по макро flow и BTC dominance.

Если логировать session и разделять P&L по сессиям:
  ρ(Asian_trades, NY_trades) ≈ 0.40-0.55  (ниже чем overall 0.70)
  → session diversity contributes to BR_effective
```

### 9.3 Целевая архитектура максимального BR (для нашего портфеля)

```
Компонент               | Стратегия          | Пары  | ~trades/yr | ρ к SMC_BTC
------------------------|--------------------|---------| -----------|-------------
SMC_trend_major         | SMC 15M            | BTC,ETH |    60-70   |  1.00 / 0.72
Supertrend_breakout     | ST+RSI+Vol 15M     | SOL,BNB |    50-60   |  0.60 / 0.58
Mean_Reversion          | BB/Keltner fade    | BTC,ETH |    30-40   | -0.15 /-0.12
Range_filter_alts       | Low-corr pairs     | XRP,DOT |    25-35   |  0.40 / 0.38

BR_nominal:  ~165-205 trades/year
Стратегий:   4 типа
Пар:         6

Adjusted ρ-matrix:
  Cluster A: [SMC_BTC, SMC_ETH]             ρ = 0.72  ← 1 effective bet
  Cluster B: [ST_SOL, ST_BNB]               ρ = 0.58  ← 1.3 effective bets
  Cluster C: [MR_BTC, MR_ETH]               ρ = 0.30  ← 1.7 effective bets
  Cluster D: [SMC_XRP, SMC_DOT]             ρ = 0.55  ← 1.4 effective bets
  Between clusters: ρ ≈ 0.10-0.40

  BR_effective ≈ 4.0 + 1.0 + 1.5 = 6.5 "super-strategies" × ~30 each
  BR_effective ≈ 195 × correction ≈ 60-70 effective independent bets

  IR_target = 0.06 × √65 ≈ 0.48  (хорошо — значительно лучше single-pair)
```

---

## 10. Сводная таблица: Рекомендации для имплементации

| Принцип | Действие | Приоритет |
|---------|----------|-----------|
| Maximize BR_effective | Добавить MR стратегию (anti-correlated с trend) | P1 |
| IC measurement | Логировать IC каждого компонента confluence score | P1 |
| HRP risk budget | Распределять risk budget по парам через IVP (упрощённый HRP) | P2 |
| Transfer Coefficient | Документировать насколько constraints снижают TC | P3 |
| Alpha decay TTL | OB: 20 свечей, FVG: 8-12 свечей — уже реализовано | Done |
| Portfolio Heat | 4% cap, повышенный порог при heat 2-4% | P1 |
| Regime allocation | ADX gate: trend → SMC, ranging → MR — уже в backlog | P1 |
| Performance attribution | Логировать per-pair per-component breakdown для каждой сделки | P2 |
| Walk-forward rebalancing | Пересматривать risk budget каждые 3 месяца | P3 |
| DSR threshold | При тестировании N>10 параметров требовать SR > DSR(N) | P2 |

---

## 11. Числовые ориентиры для нашей системы

```
Текущий базовый сценарий (1 пара, BTC):
  IC:           0.06 (WR=63%)
  BR_effective: 28
  TC:           0.70 (есть ограничения на размер, heat cap)
  IR = 0.70 × 0.06 × √28 = 0.22

Целевой сценарий (5-6 пар + MR стратегия):
  IC:           0.06 (сохраняем качество, не деградируем)
  BR_effective: 65  (4 стратегических кластера)
  TC:           0.65 (больше ограничений в мультипарном режиме)
  IR = 0.65 × 0.06 × √65 = 0.31

Улучшение IR: 0.22 → 0.31 = +41%
Ожидаемое снижение DD: пропорционально 1/√(некоррелированных_стратегий) = -30-40%
```

---

## Caveats / Gotchas

**1. BR не растёт линейно от числа пар.** Пять пар с ρ=0.85 — это BR ≈ 1.4, не 5. Добавление ETH к BTC даёт значительно меньший прирост BR, чем кажется.

**2. Корреляции нестабильны.** В крипте rolling 90d correlation может меняться от 0.60 до 0.95 в зависимости от BTC доминанса. Матрицу нужно пересчитывать минимум ежемесячно.

**3. HRP не даёт "оптимальных" весов — даёт стабильные веса.** В bull run BTC-концентрация обыгрывает HRP. HRP выигрывает in the long run через меньший drawdown и out-of-sample stability.

**4. TC снижается при ограничениях HyroTrader.** Daily DD limit 5%, требование server-side SL в течение 5 минут, max 1 позиция на пару — всё это реальные constraints, снижающие TC с теоретического 1.0.

**5. IC = 0.06 — это консервативная оценка без track record.** Реальный IC нужно считать на >100 сделках с proper walk-forward validation. IC из in-sample бэктеста всегда завышен.

**6. Гринольд-Кан разработали закон для акционных портфелей.** В крипте correla-tions значительно выше, turnover выше, и alpha decay быстрее. BR_effective будет ниже, чем в equity world.

---

Sources:
- [Fundamental Law of Active Management — CorporateFinanceInstitute](https://corporatefinanceinstitute.com/resources/career-map/sell-side/capital-markets/fundamental-law-of-active-management/)
- [Fundamental Law — True Theta](https://truetheta.io/concepts/financial-engineering/fundamental-law-of-active-management/)
- [Transfer Coefficient & Portfolio Constraints — Duke](https://people.duke.edu/~charvey/Teaching/BA491_2005/Transfer_coefficient.pdf)
- [Building Diversified Portfolios — López de Prado SSRN 2708678](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2708678)
- [HRP Wikipedia](https://en.wikipedia.org/wiki/Hierarchical_Risk_Parity)
- [HRP for Crypto — Alexey Golev](https://alexeygolev.blog/hierarchical-risk-parity-hrp-for-crypto-portfolio-optimisation/)
- [OMSCS Notes — Fundamental Law](https://www.omscs-notes.com/machine-learning-trading/fundamental-law-active-portfolio-management/)
- [Zarattini 2025 — Catching Crypto Trends SSRN 5209907](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5209907)
- [IC Information Coefficient — FE Training](https://www.fe.training/free-resources/portfolio-management/information-coefficient-ic/)
- [Alpha Decay — Maven Securities](https://www.mavensecurities.com/alpha-decay-what-does-it-look-like-and-what-does-it-mean-for-systematic-traders/)
- [Alpha Decay & Multi-period Optimal Trading — arXiv 2502.04284](https://arxiv.org/abs/2502.04284)
- [CME Group — Diversifying Crypto with XRP and SOL](https://www.cmegroup.com/articles/2025/diversifying-crypto-portfolios-with-xrp-and-sol.html)
- [Brinson Attribution — SimCorp](https://www.simcorp.com/resources/insights/industry-articles/2024/Risk-based-or-Brinson-attribution)
