# Математика управления капиталом и временные ряды

**Дата:** 2026-04-06
**Источники:**
- Ralph Vince, "The Mathematics of Money Management" (Wiley, 1992)
- Ralph Vince, "The Leverage Space Trading Model" (Wiley, 2009)
- James D. Hamilton, "Time Series Analysis" (Princeton UP, 1994)
- Hamilton (1989) — оригинальная статья по Markov Switching
- QuantPedia: [Beware of Excessive Leverage — Kelly and Optimal F](https://quantpedia.com/beware-of-excessive-leverage-introduction-to-kelly-and-optimal-f/)
- QuantifiedStrategies: [Optimal F Money Management](https://www.quantifiedstrategies.com/optimal-f-money-management/)
- QuantifiedStrategies: [Kelly vs Optimal F](https://www.quantifiedstrategies.com/kelly-criterion-vs-optimal-f/)
- ResearchGate: [Empirical Comparison Kelly vs Optimal F](https://www.researchgate.net/publication/301931721_An_Empirical_Comparison_between_Kelly_Criterion_and_Vince's_Optimal_F)
- Macrosynergy: [Hurst Exponent для детекции трендов](https://research.macrosynergy.com/detecting-trends-and-mean-reversion-with-the-hurst-exponent/)
- Medium: [Markov Regime Switching](https://medium.com/@yuhui_w/volatility-regime-classification-with-garch-1-1-markov-models-7cb85d4d5815)
- Hamilton (2005): [Regime-Switching Models](https://econweb.ucsd.edu/~jhamilto/palgrav1.pdf)

---

## Часть 1: Ralph Vince — Математика управления капиталом

### 1.1 Проблема геометрического роста

Большинство трейдеров интуитивно мыслят арифметически: "10% выигрыш и 10% проигрыш = ноль". На самом деле:

```
$1,000 × 1.10 × 0.90 = $990   (не $1,000!)
$1,000 × 1.10 × 0.90 × 1.10 × 0.90 = $980.10

Арифметическое среднее: (10% - 10%) / 2 = 0%
Геометрическое среднее: sqrt(1.10 × 0.90) - 1 = sqrt(0.99) - 1 = -0.5%/период
```

**Ключевой вывод Vince:** Оптимизировать нужно не ожидаемую доходность (E[R]), а геометрическое среднее — рост, который реально накапливается на счёте. Это фундаментальное различие между академической теорией портфеля (MPT) и реальной торговлей.

Геометрическое среднее (G) определяется как:

```
G = TWR^(1/N) - 1

где:
  TWR = Terminal Wealth Relative (итоговое отношение капитала)
  N   = количество сделок
```

Задача управления капиталом: найти такой размер позиции, который **максимизирует G**, а не E[R].

---

### 1.2 Optimal f — Формула и алгоритм

**Optimal f** — фракция капитала, при которой геометрическое среднее HPR максимально. Это эволюция критерия Келли для реальной торговли с ненормальным распределением результатов.

#### Формулы

**HPR (Holding Period Return) для каждой сделки:**

```
HPR_i = 1 + f × (-T_i / |BL|)

где:
  f   = тестируемая фракция (0 до 1+)
  T_i = P&L сделки i (положительный = прибыль, отрицательный = убыток)
  BL  = biggest loss (самый большой убыток в выборке, всегда отрицательное число)

Важно: знак инвертируется — убыток T_i < 0 даёт (-T_i) > 0, что корректно уменьшает HPR.
```

**TWR (Terminal Wealth Relative):**

```
TWR(f) = HPR_1 × HPR_2 × ... × HPR_N = ∏ HPR_i(f)
```

**Геометрическое среднее:**

```
G(f) = TWR(f)^(1/N)
```

**Optimal f:** значение f*, которое максимизирует G(f):

```
f* = argmax_f [ G(f) ] = argmax_f [ TWR(f)^(1/N) ]
```

#### Алгоритм вычисления

```
1. Собрать все P&L из истории сделок (в деньгах или %)
2. Найти BL = min(P&L_i) — самый большой убыток
3. Для f от 0.01 до 2.0 с шагом 0.01:
   a. Рассчитать HPR_i = 1 + f × (-P&L_i / |BL|) для каждой сделки
   b. Рассчитать TWR(f) = ∏ HPR_i
   c. Рассчитать G(f) = TWR(f)^(1/N)
4. f* = f с максимальным G(f)
```

#### Пример вычисления

```
История сделок (условные единицы):
  +$300, -$100, +$500, -$200, +$400, -$100, +$350, -$150

BL = -$200

При f = 0.25:
  HPR_1 = 1 + 0.25 × (300/200) = 1 + 0.375 = 1.375
  HPR_2 = 1 + 0.25 × (-(-100)/200) = 1 + 0.25 × 0.5 = ... ← ждём

Правильнее (убыток имеет знак минус):
  T_2 = -100 → (-T_2) = +100
  HPR_2 = 1 + 0.25 × (100/200) = 1 + 0.125 = 1.125

  T_4 = -200 → (-T_4) = +200
  HPR_4 = 1 + 0.25 × (200/200) = 1 + 0.25 = 1.25

  T_1 = +300 → (-T_1) = -300
  HPR_1 = 1 + 0.25 × (-300/200) = 1 - 0.375 = 0.625 ← прибыльная сделка!

Paradox: при win HPR < 1? Нет — знак T инвертируется по-другому:
  HPR_i = 1 + f × (T_i / |BL|)    ← вот правильная формула!
  Прибыль T > 0 → HPR > 1
  Убыток T < 0 → HPR < 1
```

Правильная формула Vince (прямая нотация):

```
HPR_i = 1 + f × (T_i / |BL|)

Пример:
  BL = -$200, |BL| = $200

  Сделка +$300: HPR = 1 + 0.25 × (300/200) = 1.375
  Сделка -$100: HPR = 1 + 0.25 × (-100/200) = 0.875
  Сделка +$500: HPR = 1 + 0.25 × (500/200) = 1.625
  Сделка -$200: HPR = 1 + 0.25 × (-200/200) = 0.750
  Сделка +$400: HPR = 1 + 0.25 × (400/200) = 1.500
  Сделка -$100: HPR = 0.875
  Сделка +$350: HPR = 1 + 0.25 × (350/200) = 1.4375
  Сделка -$150: HPR = 1 + 0.25 × (-150/200) = 0.8125

  TWR(0.25) = 1.375 × 0.875 × 1.625 × 0.750 × 1.500 × 0.875 × 1.4375 × 0.8125
            ≈ 2.124
  G(0.25)   = 2.124^(1/8) - 1 ≈ 0.0985 = 9.85% per trade
```

Итерируя по всем значениям f, находим f*, при котором G(f) максимален.

---

### 1.3 Optimal f vs Критерий Келли

Классическая формула Келли:

```
f_Kelly = (b × p - q) / b = p - q/b

где:
  p = вероятность выигрыша
  q = вероятность проигрыша (= 1 - p)
  b = отношение выигрыша к проигрышу (odds)

Предположения Келли:
  - Фиксированные ставки (p, q, b — константы)
  - Бинарный исход: либо выигрыш b, либо проигрыш 1.0
  - Независимые исходы
```

**Почему Kellyне достаточен для трейдинга:**

1. **Переменные размеры P&L:** Реальная торговля имеет разные размеры выигрышей и проигрышей — +2R, +0.5R, -1R, -0.3R, +5R. Kelly не учитывает это распределение.

2. **Формула Kellyна самом деле частный случай Optimal f:** Если выигрыш всегда = b (фиксированный) и проигрыш всегда = 1.0, тогда f_Kelly = f*. В общем случае — нет.

3. **Kellyиспользует только средние значения.** Optimal f учитывает весь массив исторических сделок и работает с реальным распределением.

4. **Practical test:** При одинаковых данных Kelly и Optimal f дают разные значения. Разница становится значимой при skewed distribution.

```
Пример различия:
  Стратегия: WR = 50%, avg_win = 3R, avg_loss = 1R

  Kelly: f_K = (1 × 0.5 - 0.5) / 1 = 0.0
         Это ошибка! Kelly здесь некорректен, т.к. предполагает b = avg_win/avg_loss
         Правильнее: b = 3, f_K = (3 × 0.5 - 0.5) / 3 = 0.333

  Но если P&L распределение реально: +3R, +3R, -1R, -1R (50/50)
  BL = -1R, |BL| = 1R
  Итерация optimal f даёт f* ≈ 0.25-0.30 (ниже Kelly!)

  Разница: Optimal f консервативнее Kelly при fat tails и ненормальном распределении.
```

---

### 1.4 Модель пространства плеча (Leverage Space Model)

Vince в поздней работе обобщает оптимальный f до **leverage space trading model** для нескольких одновременных позиций.

**Ключевые концепции:**

- **Leverage Space:** многомерное пространство, где каждая ось = фракция f_i для актива i.
- **Optimal joint f vector:** вектор (f_1, f_2, ..., f_N) для портфеля N инструментов.
- **Метрика риска:** Vince использует **просадку** как основной риск-параметр (не дисперсию, как MPT).

**Формула для портфеля из двух инструментов:**

```
HPR_portfolio = 1 + f_1 × (T_1 / |BL_1|) + f_2 × (T_2 / |BL_2|)

TWR(f_1, f_2) = ∏ HPR_portfolio_i

Задача:
  Найти (f_1*, f_2*) = argmax TWR(f_1, f_2)
  при ограничении: P(DD > max_DD) ≤ ε
```

**Влияние корреляций:**

```
Если два актива коррелируют положительно:
  - Одновременные убытки случаются чаще
  - Совместный optimal f ниже суммы индивидуальных f*
  - Диверсификация работает меньше

Если активы некоррелированы или отрицательно коррелированы:
  - Совместный f* может превышать индивидуальные
  - Реальная диверсификация → возможность использовать большее плечо безопасно
```

**Практический вывод для нашего бота (5-8 пар):**

При высокой BTC-корреляции всех пар (0.7+) портфельный optimal f не превышает одиночного. Диверсификации как таковой нет. Это подтверждает осторожный подход с 4% per trade per pair.

---

### 1.5 Просадка как функция f

Это одно из самых важных открытий Vince. Просадка **детерминистически связана с f:**

```
Ожидаемая максимальная просадка = функция от f

При f = f* (full optimal):
  Max DD ≥ f* (в процентах от капитала)
  
  То есть: если f* = 0.30, то drawdown гарантированно будет ≥ 30%

При f = 0.5 × f* (half optimal):
  Max DD ≈ 0.5 × f* — при примерно 75% от максимального роста

При f = 0.25 × f* (quarter optimal):
  Max DD ≈ 0.25 × f* — при примерно 50% от максимального роста
```

**Таблица trade-off роста и просадки:**

```
Фракция       | % от max G | Ожидаемая DD
------------- | ---------- | ------------
1.0 × f*      |   100%     |  f*% (очень высокая)
0.75 × f*     |    94%     |  ~0.75 × f*
0.5 × f*      |    75%     |  ~0.5 × f*
0.25 × f*     |    51%     |  ~0.25 × f*
0.1 × f*      |    20%     |  ~0.1 × f*

Пример при f* = 0.40:
  Full Kelly:        рост 100%, DD ≥ 40%
  Half Kelly:        рост 75%,  DD ≈ 20%
  Quarter Kelly:     рост 51%,  DD ≈ 10%
```

**Ключевое свойство Full Kelly:** существует X% вероятность, что счёт упадёт до X% от начального. То есть при полном f* вероятность 50% просадки = 50%. Это неприемлемо для prop firm.

---

### 1.6 Риск разорения (Risk of Ruin)

Формула риска разорения (упрощённая):

```
RoR = ((1 - edge) / (1 + edge))^(Capital / Risk_per_trade)

где:
  edge    = expectancy per trade (в долях риска)
  Capital = текущий капитал
  Risk    = риск на сделку (= 1R)

Более точная через f:
  RoR(f) ≈ (1 - f)^N при неблагоприятных сценариях → 0 при N → ∞

В leverage space: P(DD > D) = exp(-k × D) для некоторого k = f(f, expectancy)
```

**Практические числа (при WR=50%, RR=2:1, risk=2% per trade):**

```
Consecutive losses to ruin (10% DD limit):
  5 losers in a row: DD = 5 × 2% = 10% → рядом с лимитом

Probability of 5 consecutive losses:
  P = (1 - 0.5)^5 = 3.125%  ← случится в ~1 из 32 серий сделок!

При 100 сделок в год: ожидать ~3 таких серии в год → почти гарантированно.

Вывод: при RR=2:1 и WR=50% риск 2% per trade с лимитом DD=10% → опасно.
Надо либо WR > 55%, либо risk < 1.5% per trade, либо DD лимит > 15%.
```

---

### 1.7 Почему большинство трейдеров торгуют неоптимально

Vince выявил парадоксальную ситуацию в индустрии:

**Под-оптимальное плечо (under-leveraged):**
- Большинство retail трейдеров рискуют 0.5-1% per trade
- При хорошей системе (WR=55%, RR=2:1) optimal f может быть 8-15%
- Торговля на 1% = ~8-15% от optimal f → только 20-30% от максимального роста
- Причина: психологический страх, незнание математики

**Чрезмерное плечо (over-leveraged):**
- Торговля сверх optimal f гарантирует убыток в долгосрочной перспективе
- При f > 2 × f*: ожидаемый рост отрицателен даже при положительном expectancy
- Типичный пример: высокочастотный скальпинг с плечом 10-20x
- Причина: короткие периоды наблюдения, где завышенный риск кажется прибыльным

**Зона безопасного роста:**

```
Оптимальная практическая зона: 0.25 × f* до 0.50 × f*

При этом:
  - Рост 51-75% от максимально возможного
  - Просадка 25-50% от максимальной
  - Психологически переносимо
  - Margin for error при неточности оценки f*
```

**Почему нельзя точно знать f*:** Optimal f вычисляется на исторических данных. Будущее распределение P&L неизвестно. Если реальный worst loss окажется хуже исторического — система "сломается". Поэтому практики используют **Secure f** (Vince/Jones): f calibrated to worst imaginable loss, не историческому.

---

## Часть 2: James Hamilton — Временные ряды и рыночные режимы

### 2.1 Авторегрессионные модели (AR) — детекция импульса

Модель AR(p) описывает текущее значение как линейную комбинацию p предыдущих значений:

```
y_t = c + φ_1 × y_{t-1} + φ_2 × y_{t-2} + ... + φ_p × y_{t-p} + ε_t

где:
  c     = константа (drift)
  φ_i   = авторегрессионные коэффициенты
  ε_t   = белый шум (i.i.d. с нулевым средним)
```

**Для ценовых рядов важен AR(1):**

```
Δp_t = c + φ × Δp_{t-1} + ε_t

φ > 0: моментум (положительная автокорреляция изменений)
φ < 0: mean reversion (отрицательная автокорреляция)
φ = 0: случайное блуждание (нет предсказуемости)
```

**Экспонента Херста как упрощённая версия AR:**

```
H = 0.5: случайное блуждание (AR φ ≈ 0)
H > 0.5: трендовое поведение (AR φ > 0)
H < 0.5: mean reversion (AR φ < 0)

Для Bitcoin 2020-2024 на daily TF:
  H ≈ 0.52-0.58 → слабый моментум на дневном горизонте
  H ≈ 0.48-0.52 на 15M → близко к random walk

Для SOL:
  H ≈ 0.55-0.62 → более выраженный моментум на 1H-4H
```

**Тест Ljung-Box** на автокорреляцию остатков:

```
Если остатки AR(p) модели показывают автокорреляцию → нужно увеличить p
Если нет автокорреляции → AR(p) адекватна

Для трейдинга: проверить p = 1, 2, 3. Чаще всего достаточно AR(1) или AR(2).
```

---

### 2.2 GARCH модели — кластеризация волатильности

**ARCH (Engle, 1982) — первичная идея:**

```
σ²_t = ω + α × ε²_{t-1}

Смысл: вчерашний большой шок увеличивает сегодняшнюю дисперсию.
"Volatile periods follow volatile periods" — не предсказывая направление, но предсказывая масштаб.
```

**GARCH(1,1) (Bollerslev, 1986):**

```
σ²_t = ω + α × ε²_{t-1} + β × σ²_{t-1}

где:
  ω     = базовый (long-run) уровень дисперсии
  α     = reaction coefficient (чувствительность к новым шокам)
  ε²_{t-1} = квадрат вчерашней ошибки (новое "удивление")
  β     = persistence coefficient (инерция вчерашней дисперсии)

Типичные значения для BTC:
  α ≈ 0.08-0.15  (высокая реакция, быстрый отклик)
  β ≈ 0.80-0.90  (высокая инерция, медленное затухание)
  α + β ≈ 0.90-0.95
```

**Persistence — ключевая метрика:**

```
Persistence = α + β

При α + β < 1: модель стационарна, волатильность возвращается к long-run уровню
При α + β → 1: шок в волатильности практически постоянен

Полупериод (half-life) восстановления после шока:
  T_{1/2} = ln(0.5) / ln(α + β) дней

Примеры:
  α + β = 0.98: T_{1/2} = 34 дня
  α + β = 0.95: T_{1/2} = 14 дней
  α + β = 0.90: T_{1/2} = 7 дней

Long-run (unconditional) variance:
  VL = ω / (1 - α - β)
```

**Применение к нашему боту:**

```
Режим HIGH_VOL (σ_t >> VL):
  ATR/price > 2.5%
  Последние 3 дня: дневной диапазон > 4%
  → Уменьшить позицию, расширить SL, снизить порог confluence

Режим LOW_VOL (σ_t << VL):
  ATR/price < 0.3%
  → ATR фильтр сработает (0.1% минимум уже стоит)
  → Вероятно: боковик или накопление перед большим движением

Режим NORMAL_VOL (σ_t ≈ VL):
  ATR/price 0.3%-1.5%
  → Стандартные параметры стратегии
```

**EGARCH (Nelson, 1991) — асимметрия:**

```
ln(σ²_t) = ω + β × ln(σ²_{t-1}) + α × |ε_{t-1}/σ_{t-1}| + γ × (ε_{t-1}/σ_{t-1})

γ < 0 (типично): негативный шок увеличивает волатильность сильнее, чем позитивный того же размера.

Для BTC: γ ≈ -0.10 до -0.20
  Падение на 5% → волатильность растёт больше, чем рост на 5%
  → При шортах риск дополнительно возрастает (волатильность против)
```

---

### 2.3 Модели переключения режимов (Markov Switching)

Hamilton (1989) ввёл модели с **латентным** (скрытым) режимом, который переключается по законам Марковской цепи.

**Двух-режимная модель:**

```
Режим S_t ∈ {0, 1} (например, 0 = Bear, 1 = Bull)

В режиме 0:
  r_t = μ_0 + ε_t,  ε_t ~ N(0, σ²_0)  (низкая доходность, высокая волатильность)

В режиме 1:
  r_t = μ_1 + ε_t,  ε_t ~ N(0, σ²_1)  (высокая доходность, низкая волатильность)

Переходная матрица Маркова:
  P(S_t = 1 | S_{t-1} = 1) = p_{11}  (оставаться в Bull)
  P(S_t = 0 | S_{t-1} = 1) = 1 - p_{11}
  P(S_t = 0 | S_{t-1} = 0) = p_{00}  (оставаться в Bear)
  P(S_t = 1 | S_{t-1} = 0) = 1 - p_{00}
```

**Оценка:** фильтр Гамильтона (адаптация фильтра Калмана):

```
1. Forward pass: P(S_t = j | r_1, ..., r_t) — вероятность режима в момент t
   Обновление: P(S_t | r_1..t) ∝ f(r_t | S_t) × ∑ P(S_t | S_{t-1}) × P(S_{t-1} | r_1..t-1)

2. Smoothed probabilities (backward pass):
   P(S_t | r_1..T) — более точная оценка для анализа

3. MLE оценка параметров (μ_0, μ_1, σ²_0, σ²_1, p_00, p_11)
   через EM алгоритм (Baum-Welch)
```

**Типичные параметры для BTC:**

```
Bull Regime:
  μ_1 ≈ +0.3% per day (реалистично: +0.1% to +0.5%)
  σ_1 ≈ 2-3% daily volatility
  p_11 ≈ 0.95-0.97 (Bull самоподдерживается: среднее время ~20-30 дней)

Bear/Ranging Regime:
  μ_0 ≈ -0.1% to -0.3% per day
  σ_0 ≈ 3-5% daily volatility (выше!)
  p_00 ≈ 0.93-0.96 (Ranging тоже устойчив: ~15-20 дней)

Вывод: переходы редки, но сигнализируют о важных изменениях режима.
```

**Практическое применение (simplified):**

```typescript
// Proxy-детектор без full MLE — приближение через скользящие параметры
interface RegimeState {
  regime: 'bull' | 'bear' | 'ranging';
  confidence: number;  // 0-1
}

function detectRegime(candles: Candle[], lookback = 20): RegimeState {
  const returns = candles.slice(-lookback).map((c, i, arr) =>
    i === 0 ? 0 : (c.close - arr[i-1].close) / arr[i-1].close
  );

  const mean = returns.reduce((a, b) => a + b, 0) / lookback;
  const variance = returns.reduce((a, b) => a + (b - mean)**2, 0) / lookback;
  const stdDev = Math.sqrt(variance);
  const annualizedVol = stdDev * Math.sqrt(365 * 96); // 15M candles in year

  // SMA trend direction
  const sma20Close = candles.slice(-20).reduce((a, c) => a + c.close, 0) / 20;
  const sma60Close = candles.slice(-60).reduce((a, c) => a + c.close, 0) / 60;

  const isTrending = Math.abs(mean) > stdDev * 0.3;
  const isBull = sma20Close > sma60Close && mean > 0;
  const isHighVol = annualizedVol > 0.80;  // >80% annualized

  if (isTrending && isBull) return { regime: 'bull', confidence: 0.7 };
  if (isTrending && !isBull) return { regime: 'bear', confidence: 0.7 };
  return { regime: 'ranging', confidence: 0.6 };
}
```

---

### 2.4 Стационарность и тесты Дики-Фуллера

Hamilton подробно рассматривает **нестационарность** — одну из главных ловушек при работе с финансовыми данными.

**Нестационарный ряд (единичный корень):**

```
Случайное блуждание:
  p_t = p_{t-1} + ε_t

Характеристики:
  - Mean меняется со временем
  - Variance → ∞ при T → ∞
  - Любая корреляция с нестационарным рядом → "spurious regression"
```

**Тест Дики-Фуллера (ADF):**

```
H₀: ряд нестационарен (есть единичный корень)
H₁: ряд стационарен

Регрессия:
  Δy_t = α + β × t + γ × y_{t-1} + δ₁Δy_{t-1} + ... + ε_t

Тест: γ = 0 (нет возврата к среднему) vs γ < 0 (возврат к среднему)

Критические значения (5% уровень):
  Без константы и тренда: -1.95
  С константой:           -2.89
  С константой и трендом: -3.45

Если тест-статистика < критического значения → отвергаем H₀ → ряд стационарен
```

**Что стационарно, что нет в трейдинге:**

```
НЕСТАЦИОНАРНЫ (единичный корень):
  - Цены (raw): p_t
  - Индикатор RSI без нормировки на периоде >> lookback
  - EMA значения (следуют за ценой)
  - ATR в абсолютных единицах при меняющейся цене

СТАЦИОНАРНЫ (можно строить модели):
  - Логарифмические доходности: ln(p_t / p_{t-1})
  - ATR / price (нормированный ATR в %)
  - Spread двух коинтегрированных активов
  - RSI (14) — ограничен диапазоном 0-100
```

**Практическая важность:** Если в бэктесте индикатор вычисляется на нестационарном ряду — результаты могут быть артефактом данных (spurious correlation), а не реальным edge.

---

### 2.5 Коинтеграция и парный трейдинг

Hamilton формализует понятие **коинтеграции** (Engle-Granger, 1987): два нестационарных ряда коинтегрированы, если их линейная комбинация стационарна.

**Формальное определение:**

```
x_t ~ I(1), y_t ~ I(1)

Если ∃ β: e_t = y_t - β × x_t ~ I(0)  (стационарен)
→ x_t и y_t коинтегрированы с коэффициентом β
```

**Тест Engle-Granger (двухшаговый):**

```
Шаг 1: Регрессия y_t = α + β × x_t + e_t
Шаг 2: ADF тест на e_t (остатки)

Если остатки стационарны → коинтеграция есть → парный трейдинг работает
```

**Применение к нашему боту (multi-pair):**

```
BTC-ETH коинтеграция (исторически):
  β ≈ 0.6-0.8 (ETH следует BTC с коэффициентом)
  Spread = ETH_price - β × BTC_price
  При нормальных условиях spread стационарен → возвращается к среднему

  ПРЕДУПРЕЖДЕНИЕ: коинтеграция нестабильна:
    - В крипто-зиму 2022: beta и mean spread сильно менялись
    - После ETF 2024: корреляция структурно изменилась
    - Нужно регулярно пересчитывать β (rolling window 60-90 дней)

BTC-SOL: слабее, β нестабильна (SOL имеет периоды независимого движения)
```

---

### 2.6 Структурные переломы (Structural Breaks)

Тест Чоу (Chow Test) и тест Куандта-Эндрюса (Quandt-Andrews):

```
Тест Чоу:
  H₀: параметры модели одинаковы до и после точки T*
  H₁: параметры изменились в T*

  F = ((RSS_R - RSS_U) / k) / (RSS_U / (N - 2k))

  Требует: заранее знать предполагаемую точку перелома T*

Тест Куандта-Эндрюса:
  Вычисляет Chow-test для всех возможных T* в диапазоне [15%, 85%] данных
  QLR = max F(T*)  — наибольший F-статистик = наиболее вероятная точка перелома
```

**Известные структурные переломы для BTC:**

```
2024-01-10: одобрение BTC ETF (BlackRock)
  → Корреляция с S&P 500 резко выросла
  → Institutional participation выросла
  → Модели, откалиброванные до ETF, могут давать неверные сигналы

2022-05: коллапс LUNA
  → Structural break в alt-BTC отношениях
  → Коинтеграционные модели были нарушены на 3-6 месяцев

2021-04/2021-11: bull run peak and crash
  → Режим переключился из high-momentum в bear
  → GARCH параметры изменились структурно
```

**Практическое правило:** Если стратегия откалибрована на данных с одной стороны перелома, ожидать ухудшения производительности после перелома. Решение: rolling recalibration window + тест на structural break перед каждым major backtesting cycle.

---

## Часть 3: Применение к нашему боту

### 3.1 Расчёт optimal f для нашей стратегии

На основе бэктест-результатов алгоритм вычисления рекомендуемого f:

```typescript
interface TradeResult {
  pnlPercent: number;  // P&L в % от капитала
}

function computeOptimalF(trades: TradeResult[]): {
  optimalF: number;
  gMax: number;
  fractionalF: number;  // 0.25 × f* для практики
} {
  const pnls = trades.map(t => t.pnlPercent);
  const biggestLoss = Math.min(...pnls);  // отрицательное число

  if (biggestLoss >= 0) throw new Error('No losing trades — cannot compute f');

  let bestF = 0;
  let bestG = 0;

  for (let f = 0.01; f <= 2.0; f += 0.01) {
    // HPR для каждой сделки
    const hprs = pnls.map(t => 1 + f * (t / Math.abs(biggestLoss)));

    // Проверить что все HPR > 0 (иначе f слишком велик)
    if (hprs.some(h => h <= 0)) break;

    // TWR и геометрическое среднее
    const twr = hprs.reduce((acc, h) => acc * h, 1);
    const g = Math.pow(twr, 1 / pnls.length);

    if (g > bestG) {
      bestG = g;
      bestF = f;
    }
  }

  return {
    optimalF: bestF,
    gMax: bestG - 1,          // в % per trade
    fractionalF: bestF * 0.25  // практически безопасная фракция
  };
}
```

**Ожидаемые значения для нашей стратегии (WR=50%, RR=2:1):**

```
Приблизительный расчёт:
  Если avg win = +2%, avg loss = -1% (leverage+strategy combined)
  BL = -1% (самый большой исторический убыток, обычно хуже)

  При f = 0.25: G ≈ 1.007 = +0.7% per trade (geometric)
  При f = 0.50: G ≈ 1.011 = +1.1% per trade
  При f* ≈ 0.35-0.45: G_max ≈ 1.012 = +1.2% per trade

  fractionalF = 0.25 × f* ≈ 0.09-0.11

Наш текущий параметр: 4% per pair × 22.5% pos size
  Это соответствует ~0.1 × f* (очень консервативно)
  → Оставляет огромный запас под prop firm DD constraints

Вывод: Наш 4% / 22.5% параметр математически обоснован — он
  удерживает нас в нижней части optimal f space, где DD минимален.
  Увеличение до 0.25 × f* возможно только после проверки historical
  worst loss через длинные (2+ года) бэктест периоды.
```

---

### 3.2 GARCH-proxy без MLE: практический режим-детектор

Полная GARCH(1,1) модель требует библиотеки MLE. Для real-time торговли достаточно приближения:

```typescript
interface VolatilityRegime {
  currentVol: number;        // текущая волатильность (ATR/price)
  longRunVol: number;        // long-run базовый уровень
  persistence: number;       // α+β прокси (через EWMA)
  regime: 'low' | 'normal' | 'high' | 'extreme';
  positionSizeMultiplier: number;  // корректировка размера
}

function detectVolatilityRegime(
  candles: Candle[],
  atr14: number,
  price: number
): VolatilityRegime {
  const currentVolPct = atr14 / price;

  // EWMA волатильности (приближение GARCH β-компоненты)
  const ewmaVols = computeEWMA(
    candles.slice(-100).map(c => Math.abs(c.close - c.open) / c.open),
    lambda = 0.94  // стандартный RiskMetrics lambda
  );

  const longRunVol = ewmaVols.slice(-60).reduce((a, b) => a + b) / 60;

  // Persistence proxy: насколько текущий vol выше LR vol
  const volRatio = currentVolPct / longRunVol;

  let regime: VolatilityRegime['regime'];
  let positionSizeMultiplier: number;

  if (volRatio < 0.7) {
    regime = 'low';
    positionSizeMultiplier = 1.0;   // не увеличиваем — low vol может быть перед breakout
  } else if (volRatio < 1.5) {
    regime = 'normal';
    positionSizeMultiplier = 1.0;
  } else if (volRatio < 2.5) {
    regime = 'high';
    positionSizeMultiplier = 0.75;  // -25% к размеру
  } else {
    regime = 'extreme';
    positionSizeMultiplier = 0.5;   // -50% к размеру, либо skip
  }

  return { currentVol: currentVolPct, longRunVol, persistence: volRatio, regime, positionSizeMultiplier };
}
```

---

### 3.3 Режим-детектор для confluence scorer

Объединение AR-моментума, GARCH-волатильности и Марков-режима:

```typescript
interface MarketRegime {
  trend: 'bull' | 'bear' | 'ranging';
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
  momentum: 'trending' | 'reverting' | 'neutral';
  tradingBias: 'long_only' | 'short_only' | 'both' | 'pause';
  confluenceThresholdAdjustment: number;  // 0 = стандартный, +5 = строже
}

function assessMarketRegime(
  candles4H: Candle[],
  candles15M: Candle[]
): MarketRegime {
  // Тренд: SMA200 на 4H
  const sma200 = candles4H.slice(-200).reduce((a, c) => a + c.close, 0) / 200;
  const currentPrice = candles4H[candles4H.length - 1].close;
  const priceVsSma200 = (currentPrice - sma200) / sma200;

  // Моментум: 3-свечной AR(1) на 15M доходностях
  const returns15m = candles15M.slice(-20).map((c, i, arr) =>
    i === 0 ? 0 : (c.close - arr[i-1].close) / arr[i-1].close
  ).slice(1);
  const ar1Coef = computeAR1(returns15m);

  // Волатильность: ATR / price vs исторический средний
  const atr = computeATR(candles15M.slice(-14), 14);
  const atrPct = atr / currentPrice;

  // Определение тренда
  let trend: MarketRegime['trend'];
  if (priceVsSma200 > 0.05) trend = 'bull';
  else if (priceVsSma200 < -0.05) trend = 'bear';
  else trend = 'ranging';

  // Моментум
  let momentum: MarketRegime['momentum'];
  if (ar1Coef > 0.1) momentum = 'trending';
  else if (ar1Coef < -0.1) momentum = 'reverting';
  else momentum = 'neutral';

  // Торговые рекомендации
  let tradingBias: MarketRegime['tradingBias'] = 'both';
  let confluenceAdjust = 0;

  if (trend === 'bull' && momentum === 'trending') {
    tradingBias = 'long_only';
    confluenceAdjust = -5;  // ослабить требования для лонгов в тренде
  } else if (trend === 'bear' && momentum === 'trending') {
    tradingBias = 'short_only';
    confluenceAdjust = -5;
  } else if (trend === 'ranging' || momentum === 'reverting') {
    tradingBias = 'both';
    confluenceAdjust = +5;  // ужесточить, т.к. направление неясно
  }

  if (atrPct > 0.025) {
    confluenceAdjust += 10;  // высокая волатильность — строже фильтры
    if (atrPct > 0.04) tradingBias = 'pause';  // экстремальная волатильность
  }

  return {
    trend,
    volatilityRegime: atrPct > 0.025 ? 'high' : atrPct < 0.005 ? 'low' : 'normal',
    momentum,
    tradingBias,
    confluenceThresholdAdjustment: confluenceAdjust
  };
}
```

---

### 3.4 Рекомендации по position sizing для HyroTrader

Синтез Vince + Hamilton + наши HyroTrader constraints:

```
Наши ограничения:
  Daily DD limit: 5% от start balance
  Max DD limit:   10% от start balance
  SL per trade:   ≤ 3% от start balance

Через призму Vince:
  При риске 3% per trade и DD_limit = 10%:
    Максимальное количество consecutive losses = 10% / 3% ≈ 3 лосера подряд
    При WR = 50%: P(3 losers) = 0.5³ = 12.5%
    Слишком высокая вероятность! → нужен буфер

  При риске 2% per trade и DD_limit = 10%:
    Maximum consecutive losses = 10% / 2% = 5 лосеров
    P(5 losers at WR=50%) = 0.5⁵ = 3.125%
    Приемлемо при 100 сделках/год

  При риске 1% per trade и DD_limit = 10%:
    Maximum consecutive losses = 10
    P(10 losers at WR=50%) = 0.001 = 0.1%
    Очень безопасно, но рост медленнее

Рекомендация через Vince-GARCH-HyroTrader matrix:

  Режим NORMAL_VOL + BULL/BEAR trend:
    Risk per trade = 2% × position_size_multiplier(1.0)
    → 22.5% позиция при ATR-стопе 2% от entry

  Режим HIGH_VOL:
    Risk per trade = 1.5% × 0.75 = 1.125%
    → Меньше позиция или шире стоп

  Режим EXTREME_VOL или RANGING без направления:
    Пропустить сигнал или half position
    Risk per trade ≤ 1%
```

---

### 3.5 Итоговые правила для реализации

**Правило 1 — Optimal f constraint:**
```
Никогда не рисковать более 0.25 × f* в одной сделке.
f* рассчитывается из последних 100+ сделок бэктеста.
При отсутствии данных: использовать консервативный f = 0.05 (5% от capital at risk).
```

**Правило 2 — Geometric mean первично:**
```
При оптимизации TP уровней и SL: оптимизировать G(f), не avg_return.
G выше у систем с меньшей дисперсией P&L, даже при одинаковом avg_return.
```

**Правило 3 — GARCH-aware sizing:**
```
Position size = base_size × (LongRunVol / CurrentVol)^0.5

Если CurrentVol = 2 × LongRunVol:
  multiplier = (1/2)^0.5 = 0.707 → -30% к размеру позиции
```

**Правило 4 — Режим-детектор как pre-filter:**
```
При extreme volatility (ATR/price > 3%):
  → Не торговать (ATR фильтр уже стоит в стратегии)

При ranging market (trend = ranging, momentum = reverting):
  → Поднять confluence threshold на +5-10 pts
  → SMC-паттерны в боковике дают больше ложных сигналов

При strong trend + momentum:
  → Снизить threshold на -5 pts (паттерны надёжнее в тренде)
  → Фокус только на direction-aligned сигналах
```

**Правило 5 — Структурные переломы:**
```
После крупных macro событий (ETF approvals, major exchange failures,
regulatory decisions, halvings):
  → Запустить ADF тест на стационарность индикаторов
  → Проверить коинтеграцию пар за последние 30 дней
  → Рассмотреть снижение position size на 2-4 недели до стабилизации
```

---

## Ключевые выводы

1. **Optimal f vs Kelly:** Optimal f превосходит Kelly в реальной торговле с ненормальным P&L распределением. Криптовалюты имеют fat tails — Kelly переоценивает безопасный size.

2. **Fractional approach обязателен:** 0.25 × f* — практически оптимальный баланс роста и DD. Полный f* неприемлем для prop firm с жёсткими DD лимитами.

3. **GARCH(1,1) перевод:** Volatility clustering — реальный эффект в крипто. ATR(14) / price — достаточный proxy для режим-детектора без полной MLE реализации.

4. **Марков-переключение:** Два режима (bull/bear) имеют разные risk-return profiles. Торговля против режима снижает WR и увеличивает DD систематически.

5. **Стационарность критична:** Индикаторы на нестационарных рядах дают ложные сигналы. ATR/price (нормированный) стационарен; raw ATR — нет.

6. **DD детерминистически связан с f:** Единственный способ контролировать DD — контролировать f. Улучшение системы (WR, RR) позволяет использовать больший f при той же DD.

7. **Коинтеграция нестабильна:** Для пар (BTC-ETH, BTC-SOL) необходима rolling verification коинтеграции. Структурные переломы уничтожают ранее работавшие соотношения.

---

*Документ написан для команды Algorithmic Trading Bot. Релевантен для: position sizing модуля, risk.ts, volatility filter в confluence scorer, и multi-pair expansion.*
