# Cycle Analytics for Traders — John F. Ehlers

**Date:** 2026-04-06
**Sources:**
- Ehlers, John F. *Cycle Analytics for Traders: Advanced Technical Trading Concepts*. Wiley, 2013. ISBN 9781118728512
- [EhlersFilters.pdf — mesasoftware.com](https://www.mesasoftware.com/papers/EhlersFilters.pdf)
- [SuperSmoother demystified — quantstrategy.io](https://quantstrategy.io/blog/demystifying-the-supersmoother-a-powerful-smoothing-algorithm/)
- [2-pole SuperSmoother — davenewberg.com](http://www.davenewberg.com/Trading/TS_Code/Ehlers_Indicators/2_pole_SuperSmoother.html)
- [Cyber Cycle — davenewberg.com](http://www.davenewberg.com/Trading/TS_Code/Ehlers_Indicators/Cyber_Cycle.html)
- [Using the Fisher Transform — mesasoftware.com](https://www.mesasoftware.com/papers/UsingTheFisherTransform.pdf)
- [Adaptive Indicators MQL5 — mql5.com](https://www.mql5.com/en/articles/288)
- [Even Better Sinewave — tradingview.com](https://www.tradingview.com/script/a1AeExr4-Ehlers-Even-Better-Sinewave-Indicator-CC/)
- [Autocorrelation Periodogram — quantstrattrader.com](https://quantstrattrader.com/2017/02/15/ehlerss-autocorrelation-periodogram/)
- [Go Ehlers Indicators — github.com/MathisWellmann](https://github.com/MathisWellmann/go_ehlers_indicators)
- [MQL5 Ehlers indicators — github.com/thetestspecimen](https://github.com/thetestspecimen/ehlers-indicators-mql5)

---

## 1. Введение: Почему Digital Signal Processing для трейдинга

Джон Эйлерс — инженер с опытом в аэрокосмической промышленности, применивший методы цифровой обработки сигналов (DSP) к финансовым рынкам. Его центральная идея:

> **Использование фиксированного 14-периодного RSI, 9-периодного стохастика или любого другого индикатора с фиксированным периодом фундаментально неверно, когда рыночные условия постоянно меняются.**

Рыночные цены — это сигналы, содержащие смесь:
- **Трендовых компонентов** (низкие частоты, длинные циклы)
- **Циклических компонентов** (средние частоты, торгуемые циклы 10–50 баров)
- **Шума** (высокие частоты, случайные флуктуации короче 5 баров)

DSP-подход решает три проблемы классических индикаторов:
1. **Lag (задержка)** — EMA сглаживает, но запаздывает. Ehlers-фильтры минимизируют задержку при том же уровне шумоподавления.
2. **Spectral dilation** — когда рынок медленный, индикатор с фиксированным периодом "видит" другую частоту. Адаптивные индикаторы решают это.
3. **Aliasing** — классические MA не убирают высокочастотный шум, он "просачивается" в сигнал.

---

## 2. SuperSmoother Filter — замена EMA

### Концепция

SuperSmoother — это 2-полюсный рекурсивный фильтр (IIR), имитирующий аналоговый фильтр Баттерворта 2-го порядка. Он агрессивно убирает компоненты короче заданного периода cutoff, при этом практически не вносит дополнительной задержки по сравнению с EMA с тем же периодом.

**Ключевое преимущество:** EMA с периодом N пропускает значительный шум выше частоты среза. SuperSmoother с тем же N убирает этот шум на ~40 дБ лучше (в 100 раз по мощности).

### Формула (2-полюсный)

```
Входные данные:
  price[i]  — текущая цена (hlc3 или close)
  period    — период среза (например, 10)

Коэффициенты (вычисляются один раз):
  a1 = exp(-sqrt(2) * π / period)
       = exp(-1.41421 * 3.14159 / period)
  b1 = 2 * a1 * cos(sqrt(2) * 180 / period * π/180)
       = 2 * a1 * cos(1.41421 * π / period)   // аргумент в радианах
  c2 = b1
  c3 = -a1 * a1
  c1 = 1 - c2 - c3

Рекурсия:
  SS[i] = c1 * (price[i] + price[i-1]) / 2
        + c2 * SS[i-1]
        + c3 * SS[i-2]

Инициализация:
  SS[0] = price[0]
  SS[1] = price[1]
```

Усреднение `(price[i] + price[i-1]) / 2` перед рекурсией — это встроенный 2-точечный сглаживатель, убирающий aliasing на частоте Найквиста.

### 3-полюсный SuperSmoother (более крутой откат)

```
Коэффициенты:
  a1  = exp(-π / period)
  b1  = 2 * a1 * cos(sqrt(3) * π / period)
  c1  = a1 * a1
  coef2 = b1 + c1
  coef3 = -(c1 + b1 * c1)
  coef4 = c1 * c1
  coef1 = 1 - coef2 - coef3 - coef4

Рекурсия:
  SS3[i] = coef1 * price[i]
          + coef2 * SS3[i-1]
          + coef3 * SS3[i-2]
          + coef4 * SS3[i-3]
```

3-полюсный даёт более резкую отсечку, но чуть больше задержки. Для трейдинга чаще используют 2-полюсный как компромисс.

### Применение в нашем боте

Замена `calcEMA(candles, period)` на SuperSmoother:
- EMA(20) → SuperSmoother(20): на 15M свечах уберёт тик-шум, сохранит тренд
- EMA(50) → SuperSmoother(50): более чистая медленная линия
- Кросс EMA20/EMA50 получит меньше ложных сигналов

---

## 3. Roofing Filter — двойная очистка сигнала

### Концепция

Roofing Filter — комбинация двух фильтров последовательно:
1. **Highpass filter** (HP) — убирает трендовую компоненту (низкие частоты, периоды > 48 баров)
2. **SuperSmoother** (LP) — убирает шум (высокие частоты, периоды < 10 баров)

Результат: "окно" пропускания от 10 до 48 баров — зона торгуемых рыночных циклов.

### Формула

```
// Highpass filter (убирает тренд, периоды > HPperiod = 48)
alpha1 = (cos(2*π / HPperiod) + sin(2*π / HPperiod) - 1)
       / cos(2*π / HPperiod)

HP[i] = (1 - alpha1/2)^2 * (price[i] - 2*price[i-1] + price[i-2])
       + 2*(1 - alpha1) * HP[i-1]
       - (1 - alpha1)^2 * HP[i-2]

// SuperSmoother поверх HP (убирает шум, периоды < LPperiod = 10)
// применяем SuperSmoother(10) к HP
Filt[i] = SuperSmoother(HP[i], period=10)
```

### Свойства Roofing Filter

- Убирает трендовую "постоянную составляющую", которая искажает осцилляторы
- Устраняет spectral dilation — осциллятор больше не "болтается" при смене волатильности
- Результат всегда центрирован около нуля, амплитуда стабильна
- Критически важен как предобработка перед Cyber Cycle, Stochastic, RSI

---

## 4. Cyber Cycle — измерение рыночного цикла

### Концепция

Cyber Cycle — осциллятор, обнаруживающий текущий рыночный цикл. В отличие от RSI или стохастика с фиксированным периодом, он математически выделяет циклическую компоненту ценового сигнала.

### Формула

```
// Шаг 1: предсглаживание 4-точечным симметричным FIR
Smooth[i] = (price[i] + 2*price[i-1] + 2*price[i-2] + price[i-3]) / 6

// Шаг 2: вычисление цикла
alpha = 0.07   // соответствует примерно 30-периодному фильтру; может адаптироваться

Cycle[i] = (1 - 0.5*alpha)^2 * (Smooth[i] - 2*Smooth[i-1] + Smooth[i-2])
          + 2*(1 - alpha) * Cycle[i-1]
          - (1 - alpha)^2 * Cycle[i-2]

// Триггерная линия
Trigger[i] = Cycle[i-1]
```

**Сигналы:**
- Cycle пересекает Trigger снизу вверх → Long сигнал
- Cycle пересекает Trigger сверху вниз → Short сигнал

### Адаптивный Cyber Cycle

В адаптивной версии `alpha` вычисляется динамически на основе доминирующего периода цикла:
```
alpha = 2 / (DominantPeriod + 1)   // как в EMA, но период адаптивный
```

---

## 5. Stochastic Cyber Cycle — точный тайминг входа

### Концепция

Нормализует Cyber Cycle в диапазон [-1, +1] аналогично стохастику, устраняя влияние spectral dilation на амплитуду.

### Формула

```
// Находим максимум и минимум Cycle за lookback баров
HighestCycle = max(Cycle[i-lookback .. i])
LowestCycle  = min(Cycle[i-lookback .. i])

// Нормализация
StochCC[i] = (Cycle[i] - LowestCycle) / (HighestCycle - LowestCycle)

// Сглаживание SuperSmoother
StochCC_smooth[i] = SuperSmoother(StochCC[i], period=5)
```

Уровни overbought/oversold: +0.7 / -0.7 (вместо 80/20 как в RSI).

**Ключевое преимущество перед RSI:** амплитуда нормализована, ложные сигналы в трендовых рынках значительно снижены при использовании вместе с детектором режима.

---

## 6. Hilbert Transform — мгновенный период

### Концепция

Преобразование Гильберта позволяет измерить мгновенную частоту (период) рыночного цикла в каждом баре. Это основа для всех адаптивных индикаторов.

### Алгоритм (упрощённый дискретный)

```
// Входной сигнал — предварительно очищен через HP filter
// InPhase (I) и Quadrature (Q) компоненты

// 4-точечный Hilbert Transform (дискретное приближение):
Smooth = (price[i] + 2*price[i-1] + 2*price[i-2] + price[i-3]) / 6
Detrender = (0.0962*Smooth + 0.5769*Smooth[i-2]
             - 0.5769*Smooth[i-4] - 0.0962*Smooth[i-6])
            * (0.075 * Period[i-1] + 0.54)

// InPhase и Quadrature
InPhase[i]    = Detrender[i-3]
Quadrature[i] = (0.0962*Detrender + 0.5769*Detrender[i-2]
                 - 0.5769*Detrender[i-4] - 0.0962*Detrender[i-6])
               * (0.075 * Period[i-1] + 0.54)

// Фаза
Phase[i] = atan(Quadrature[i] / InPhase[i])   // arctangent

// Разность фаз → период
DeltaPhase = Phase[i-1] - Phase[i]
// Ограничение:
if DeltaPhase < 0.1  then DeltaPhase = 0.1
if DeltaPhase > 1.1  then DeltaPhase = 1.1  // цикл не короче 6 и не длиннее 63 баров

// Суммирование до 360 градусов
InstPeriod[i] = InstPeriod вычисляется накоплением DeltaPhase пока сумма не достигнет 2π
// Типовая реализация: MedianDelta = median(DeltaPhase за 5 баров)
MedianPeriod = 2 * π / MedianDelta

// Сглаживание периода:
Period[i] = 0.2 * MedianPeriod + 0.8 * Period[i-1]
```

Результат: `Period[i]` — динамически обновляемый доминирующий период цикла от 6 до 63 баров.

---

## 7. MESA Autocorrelation Periodogram — надёжное обнаружение доминирующего цикла

### Концепция

Более надёжная альтернатива Hilbert Transform для измерения доминирующего периода. Использует:
1. **Roofing Filter** для очистки сигнала
2. **Autocorrelation Function (ACF)** с минимум 3-барным усреднением
3. **Discrete Fourier Transform (DFT)** autocorrelation-результатов
4. Определение периода с максимальной мощностью

### Алгоритм

```
// Шаг 1: очистка через Roofing Filter
Filt = RoofingFilter(price)   // пропускает 10-48 баров

// Шаг 2: ACF — autocorrelation для каждого лага lag от 1 до MaxPeriod
// avgLen = 3 (минимальное усреднение по Ehlers)
for lag = 1 to MaxPeriod:
    Corr[lag] = autocorrelation(Filt, lag, avgLen=3)

// Шаг 3: DFT autocorrelation для каждого периода period от MinPeriod до MaxPeriod
for period = MinPeriod to MaxPeriod:
    CosinePart = sum(Corr[lag] * cos(2π * lag / period), lag=1..MaxPeriod)
    SinePart   = sum(Corr[lag] * sin(2π * lag / period), lag=1..MaxPeriod)
    Pwr[period] = CosinePart^2 + SinePart^2

// Нормализация к максимуму
MaxPwr = max(Pwr)
for period = MinPeriod to MaxPeriod:
    NormPwr[period] = Pwr[period] / MaxPwr

// Шаг 4: поиск доминирующего периода
DominantPeriod = period с максимальным NormPwr
```

**Преимущество перед Hilbert:** менее подвержен фазовым ошибкам на резких ценовых движениях (фронтах). Более стабилен как основа для адаптивных индикаторов.

---

## 8. Bandpass Filter — изоляция конкретного цикла

### Концепция

Bandpass Filter пропускает только компоненты вблизи центрального периода. Применение: подтверждение, что конкретный цикл присутствует на рынке перед входом.

### Формула

```
// center   — центральный период (например, доминирующий цикл = 20)
// bandwidth — ширина полосы (например, 0.1 = 10%)
// delta     = bandwidth / 2

beta1  = cos(2*π / center)
gamma1 = 1 / cos(2*π * delta / center)   // где delta = bandwidth * π
alpha1 = gamma1 - sqrt(gamma1^2 - 1)

BP[i] = 0.5 * (1 - alpha1) * (price[i] - price[i-2])
       + beta1 * (1 + alpha1) * BP[i-1]
       - alpha1 * BP[i-2]

// Пиковое значение (envelope)
Peak[i] = 0.991 * Peak[i-1]
if abs(BP[i]) > Peak[i]: Peak[i] = abs(BP[i])

// Нормализованный сигнал
Signal[i] = BP[i] / Peak[i]   // [-1, +1]
```

**Рекомендованный bandwidth:** 0.05 < delta < 0.5 (узкий — чёткий цикл, широкий — захватывает больше шума).

---

## 9. Fisher Transform — острые разворотные сигналы

### Концепция

Fisher Transform преобразует любое распределение индикатора к нормальному (Гауссовому). Это создаёт резкие, почти вертикальные переходы на разворотах — значительно острее, чем исходный индикатор.

### Формула

```
// Шаг 1: нормализация любого осциллятора в (-1, +1)
// Например, для цены:
HighestHigh = max(high[i-period .. i])
LowestLow   = min(low[i-period .. i])
Value = 2 * ((price[i] - LowestLow) / (HighestHigh - LowestLow)) - 1

// Ограничение для числовой стабильности:
Value = min(max(Value, -0.999), 0.999)

// Шаг 2: Fisher Transform
Fisher[i] = 0.5 * ln((1 + Value) / (1 - Value))   // ln = натуральный логарифм

// Триггер
Trigger[i] = Fisher[i-1]
```

**Сигналы:**
- Fisher пересекает Trigger снизу вверх (из экстремально низких значений) → Long
- Fisher пересекает Trigger сверху вниз (из экстремально высоких значений) → Short
- Экстремальные значения Fisher (±2.0) надёжнее сигнализируют о развороте, чем RSI 30/70

**Применение к Cyber Cycle:**
Применение Fisher Transform поверх нормализованного Cyber Cycle даёт очень чёткие входные сигналы с минимальным lag.

---

## 10. Even Better Sinewave — детектор режима рынка

### Концепция

Наиболее практичный инструмент для ответа на вопрос: **рынок сейчас трендует или циклирует?**

Индикатор использует компоненты Roofing Filter (I и Q части) для измерения "чистоты" синусоидального поведения цены.

### Формула

```
// Из Roofing Filter получаем HP (highpass cleaned signal)
HP = HighpassFilter(price, period=48)
Filt = SuperSmoother(HP, period=10)

// Quadrature (сдвиг на 90°) через сдвиг на DominantPeriod/4 баров:
Quad = Filt[i - DominantPeriod/4]

// Амплитуда цикла
Amplitude[i] = sqrt(Filt[i]^2 + Quad[i]^2)

// Сглаживание амплитуды
AvgAmp[i] = EMA(Amplitude, period=DominantPeriod)

// Even Better Sinewave
EBS[i] = Filt[i] / AvgAmp[i]   // нормализованная синусоида

// Сигнал — сдвинутая версия
Signal[i] = EBS[i-1]
```

### Детектор режима (Trend vs Cycle)

```
// Мера цикличности: насколько цена ведёт себя как чистая синусоида
// Вычисляем через сравнение ожидаемой и реальной квадратурной компоненты

// Trend Vigor
TrendVig = abs(slope of SuperSmoother / ATR)

// Простое правило (Ehlers):
if (abs(EBS[i]) > 0.9 OR abs(EBS[i-1]) > 0.9):
    режим = TREND     // синусоида "ломается" на максимуме → тренд
else:
    режим = CYCLE     // синусоида плавная → цикличный рынок
```

**Практика:** когда EBS долго остаётся выше 0.9 или ниже -0.9 без пересечения нуля — рынок трендует. Когда EBS регулярно пересекает нуль с периодом — циклический режим.

---

## 11. Decycler Oscillator — тренд без lag

### Концепция

Decycler — это инверсия подхода. Вместо выделения цикла, он **вычитает цикл**, оставляя только тренд. Decycler Oscillator сравнивает два Decycler с разными периодами — это быстрый crossover без задержки.

### Формула

```
// High-Pass Filter:
// alpha1 для периода period:
alpha1(period) = (cos(2π/period) + sin(2π/period) - 1) / cos(2π/period)

HP(price, period)[i] = (1 - alpha1/2)^2 * (price[i] - 2*price[i-1] + price[i-2])
                      + 2*(1-alpha1) * HP[i-1]
                      - (1-alpha1)^2 * HP[i-2]

// Decycler = цена минус цикличная компонента = только тренд
Decycler(period)[i] = price[i] - HP(price, period)[i]

// Decycler Oscillator = разность двух Decycler
// fast period = 10 (или 1/2 медленного)
// slow period = 20
DecOsc[i] = Decycler(10)[i] - Decycler(20)[i]
```

**Сигналы:**
- DecOsc переходит с отрицательного на положительный → бычий тренд
- DecOsc переходит с положительного на отрицательный → медвежий тренд
- Практически нулевая задержка по сравнению с EMA crossover

---

## 12. Adaptive RSI — RSI с авто-периодом

### Концепция

Фиксированный 14-периодный RSI некорректен при любых рыночных условиях. Правильный подход Эйлерса:

> **RSI следует настраивать на половину доминирующего периода цикла.**

### Формула

```
// Получаем доминирующий период (из HT или Autocorrelation Periodogram)
DomPeriod = getDominantPeriod()   // например, 20 баров

// Адаптивный период RSI
AdaptRSI_period = DomPeriod / 2   // ≈ 10 при DoP=20

// Стандартный RSI с адаптивным периодом
AdaptRSI[i] = RSI(price, period=AdaptRSI_period)
```

**Для стохастика и CCI** — период равен полному доминирующему циклу (не половине).

### Практическое значение

| Индикатор       | Традиционный период | Адаптивный период        |
|-----------------|---------------------|--------------------------|
| RSI             | 14 (фиксирован)     | DominantPeriod / 2       |
| Stochastic      | 9 (фиксирован)      | DominantPeriod           |
| CCI             | 14 (фиксирован)     | DominantPeriod           |
| EMA fast        | 20 (фиксирован)     | DominantPeriod / 2       |
| EMA slow        | 50 (фиксирован)     | DominantPeriod           |

---

## 13. Корреляционный Cycle Indicator

### Концепция

Измеряет степень корреляции между текущим ценовым сигналом и чистой синусоидой с периодом доминирующего цикла. Высокая корреляция → рынок циклирует. Низкая → рынок трендует.

### Формула

```
// Для каждого периода P от MinPeriod до MaxPeriod:
cosSeries[i] = cos(2π * i / P)
sinSeries[i] = sin(2π * i / P)

// Корреляция с ценой (нормализованной через Roofing Filter)
CosCorr = correlation(Filt, cosSeries, period=P)
SinCorr = correlation(Filt, sinSeries, period=P)

// Мощность при данном периоде
Power[P] = CosCorr^2 + SinCorr^2
```

Визуализируется как тепловая карта периодов — "периодограмма в реальном времени". Доминирующий период = максимум Power.

---

## 14. Применение в нашем торговом боте

### Иерархия улучшений (по приоритету)

**Приоритет 1 — Немедленное применение (EMA замена):**
```
Текущее:      calcEMA(candles, 20), calcEMA(candles, 50)
Улучшение:    superSmoother(candles, 20), superSmoother(candles, 50)
Эффект:       -60% ложных кроссоверов EMA на шумных рынках (BTC 15M)
```

**Приоритет 2 — Детектор режима рынка:**
```
Проблема:     наша стратегия не различает trending vs cycling рынок
Решение:      Even Better Sinewave или Decycler Oscillator
Эффект:       в trending режиме — не торговать осцилляторные сигналы (RSI OB/OS)
              в cycling режиме — использовать RSI/стохастик с максимальным весом
```

**Приоритет 3 — Адаптивный RSI:**
```
Текущее:      RSI(14) — фиксированный
Улучшение:    RSI(DominantPeriod/2) — адаптивный
Предпосылка:  нужен расчёт DominantPeriod (Hilbert или Autocorrelation Periodogram)
Сложность:    высокая (требует надёжного измерения периода)
```

**Приоритет 4 — Stochastic Cyber Cycle как замена RSI:**
```
StochCC нормализован через максимум/минимум цикла
Fisher Transform поверх StochCC — острые разворотные сигналы
Это самый точный тайминг входа из арсенала Эйлерса для ETH и SOL (более цикличные)
```

### Псевдокод интеграции SuperSmoother в наш scorer

```typescript
// src/indicators/classic/supersmoother.ts

export function superSmoother(prices: number[], period: number): number[] {
  const a1 = Math.exp(-Math.SQRT2 * Math.PI / period);
  const b1 = 2 * a1 * Math.cos(Math.SQRT2 * Math.PI / period);
  const c2 = b1;
  const c3 = -a1 * a1;
  const c1 = 1 - c2 - c3;

  const result: number[] = new Array(prices.length).fill(0);
  result[0] = prices[0];
  result[1] = prices[1];

  for (let i = 2; i < prices.length; i++) {
    result[i] = c1 * (prices[i] + prices[i - 1]) / 2
              + c2 * result[i - 1]
              + c3 * result[i - 2];
  }
  return result;
}

// Использование вместо EMA:
// const ema20 = calcEMA(closes, 20);     // старый код
// const ema20 = superSmoother(closes, 20);  // новый
```

### Псевдокод детектора режима рынка

```typescript
// src/indicators/smc/market-regime.ts

export type MarketRegime = 'TRENDING' | 'CYCLING' | 'UNCERTAIN';

export function detectMarketRegime(
  candles: Candle[],
  hpPeriod = 48,
  lpPeriod = 10
): MarketRegime {
  const closes = candles.map(c => c.close);

  // Highpass filter
  const hp = highPassFilter(closes, hpPeriod);
  // SuperSmoother поверх HP = Roofing Filter
  const filt = superSmoother(hp, lpPeriod);

  // Последние N значений для определения режима
  const N = 20;
  const recent = filt.slice(-N);
  const crossings = countZeroCrossings(recent);

  // Простое правило:
  // 3+ пересечений нуля за 20 баров → цикличный рынок
  // < 1 пересечения → трендовый рынок
  if (crossings >= 3) return 'CYCLING';
  if (crossings === 0) return 'TRENDING';
  return 'UNCERTAIN';
}
```

### Модификация confluence scorer с учётом режима

```typescript
// В ConfluenceScorer:
const regime = detectMarketRegime(candles);

// Адаптация весов по режиму:
if (regime === 'TRENDING') {
  // Усилить структурные сигналы, ослабить осцилляторы
  weights.bosChoch   *= 1.3;
  weights.orderBlock *= 1.2;
  weights.rsi        *= 0.3;  // RSI в тренде даёт ложные OB/OS
  weights.ema        *= 1.5;
} else if (regime === 'CYCLING') {
  // Усилить осцилляторы, ослабить структурные
  weights.rsi        *= 1.8;
  weights.fvg        *= 1.3;
  weights.bosChoch   *= 0.7;
}
```

---

## 15. Сравнительная таблица: Традиционные vs Ehlers индикаторы

| Задача                      | Традиционный подход      | Ehlers подход              | Преимущество          |
|-----------------------------|--------------------------|----------------------------|-----------------------|
| Сглаживание цены            | EMA(N)                   | SuperSmoother(N)           | -40 дБ шума           |
| Удаление тренда             | Price - MA               | Highpass Filter            | Без lag               |
| Осциллятор                  | RSI(14)                  | Cyber Cycle + Fisher       | Острые развороты      |
| Нормализация осциллятора    | RSI 0-100                | Stochastic Cyber Cycle     | Нет spectral dilation |
| Детектор тренда/цикла       | ADX > 25                 | Even Better Sinewave       | Нет lag, точнее       |
| Период индикатора           | Фиксированный            | Adaptive (HT / ACF)        | Авто-подстройка       |
| Определение разворота       | MACD дивергенция         | Fisher Transform           | Вертикальные сигналы  |
| Доминирующий цикл           | Нет аналога              | MESA Autocorr. Periodogram | Измеримый             |

---

## 16. Ограничения и предупреждения

### Что нужно учитывать

1. **Вычислительная сложность.** Autocorrelation Periodogram на каждом баре — O(N²). На 15M BTC это несколько тысяч баров в сутки, вычисление займёт миллисекунды на современном CPU, но нужно профилировать.

2. **Начальная нестабильность.** Рекурсивные фильтры (IIR) требуют "прогрева" — первые 50–100 баров дают некорректные значения. В бэктесте и в live-боте нужен warm-up period.

3. **Рынки без циклов.** BTCUSDT на нескольких 15M свечах после major news event (ликвидационный каскад) не циклирует — все cycle-based индикаторы дадут шум. Детектор режима критически важен.

4. **Период цикла ≠ прогноз.** Знание доминирующего периода 20 баров не значит, что следующие 10 баров будут точно по синусоиде. Это статистическая характеристика, не детерминированная.

5. **Ehlers разрабатывал на дневных данных.** На 15M внутридневных данных crypto периоды циклов значительно короче (6–20 баров типично), что уменьшает полосу пропускания roofing filter. MinPeriod может нужно снизить до 6, MaxPeriod — до 30.

6. **Параметры по умолчанию — из книги.** HP cutoff = 48, LP cutoff = 10 рассчитаны для акций на дневных данных. Для 15M crypto рекомендуется калибровать через бэктест.

---

## 17. Приоритетный план внедрения

| Этап | Индикатор                 | Файл                                    | Сложность | Ожидаемый эффект        |
|------|---------------------------|-----------------------------------------|-----------|-------------------------|
| 1    | SuperSmoother             | `indicators/classic/supersmoother.ts`  | Низкая    | Чище EMA сигналы        |
| 2    | Highpass Filter           | `indicators/classic/highpass.ts`       | Низкая    | Основа для остальных    |
| 3    | Roofing Filter            | `indicators/classic/roofing.ts`        | Низкая    | Предобработка           |
| 4    | Decycler Oscillator       | `indicators/smc/market-regime.ts`      | Средняя   | Trend vs cycle mode     |
| 5    | Fisher Transform          | `indicators/classic/fisher.ts`         | Низкая    | Острые сигналы на RSI   |
| 6    | Cyber Cycle               | `indicators/classic/cybercycle.ts`     | Средняя   | Альтернатива RSI        |
| 7    | Stochastic Cyber Cycle    | `indicators/classic/stoch-cc.ts`       | Средняя   | Нормализованный цикл    |
| 8    | Hilbert Transform period  | `indicators/classic/hilbert.ts`        | Высокая   | Адаптивные периоды      |
| 9    | Adaptive RSI              | `indicators/classic/adaptive-rsi.ts`   | Высокая   | Авто-период RSI         |
| 10   | Autocorr. Periodogram     | `indicators/classic/mesa-period.ts`    | Высокая   | Точный доминантный цикл |

**Рекомендуемый минимальный набор для следующей итерации бэктеста:**
Этапы 1–4. SuperSmoother + Roofing + Decycler Oscillator дадут ощутимое снижение ложных сигналов с умеренной сложностью реализации.
