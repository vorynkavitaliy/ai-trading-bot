# Technical Analysis of the Financial Markets — John J. Murphy
## Deep Research Reference for Algorithmic Trading Bot

**Date:** 2026-04-06
**Source book:** Technical Analysis of the Financial Markets (1999), John J. Murphy

---

## Trend Analysis

### Dow Theory — Six Tenets

Dow Theory остается фундаментом всего технического анализа. Murphy посвящает ей целую главу как отправную точку.

**Тезис 1: Рынок дисконтирует всё**
Цена отражает всю доступную информацию — новости, ожидания, эмоции участников. Это основа для технического подхода: нет нужды анализировать фундаментал отдельно, потому что он уже "в цене".

*Для нашего бота:* SMC-подход совместим с этим тезисом — институциональные движения (OB, FVG) уже закодированы в ценовой структуре.

**Тезис 2: Три типа трендов**
- Primary trend (первичный): месяцы–годы. Bull/Bear market.
- Secondary trend (вторичный): 3 недели–3 месяца. Коррекции 1/3–2/3 первичного движения.
- Minor trend (малый): дни–недели. "Шум" внутри вторичного тренда.

*Маппинг на наши таймфреймы:*
```
Primary trend   → Weekly/Daily (определяет общий bias)
Secondary trend → 4H/1H (наш торговый контекст)
Minor trend     → 15M (наш entry timeframe)
```

**Тезис 3: Три фазы первичного тренда**
- Фаза 1 (Accumulation): умные деньги тихо накапливают позиции, пока публика в панике
- Фаза 2 (Public Participation): широкое участие, тренд очевиден, большинство трейдеров входит
- Фаза 3 (Excess/Distribution): эйфория или паника, умные деньги распродают — именно здесь SMC-трейдер ищет разворот

**Тезис 4: Объём должен подтверждать тренд**
В аптренде: объём растёт на движениях вверх, падает на откатах.
В даунтренде: объём растёт при падениях.
Расхождение объём/цена = предупреждение о возможном развороте.

**Тезис 5: Тренд действует до явного разворотного сигнала**
Не торопитесь объявлять окончание тренда по малым флуктуациям. Ждать CHoCH (Change of Character) на целевом таймфрейме — прямое воплощение этого тезиса.

**Тезис 6: Тренды должны подтверждаться на разных индексах**
В классике: Dow Jones Industrial + Transportation. В крипто — аналогом является BTC + альткоины (Ethereum как второй "индекс"). Если BTC растёт, а ETH падает — подтверждения нет.

---

### Trend Definition: Swing Highs / Swing Lows

Murphy определяет тренд через последовательность swing points:

```
Uptrend:   Higher Highs (HH) + Higher Lows (HL)
Downtrend: Lower Highs (LH) + Lower Lows (LL)
Ranging:   No clear sequence
```

**Алгоритм определения swing point:**
```typescript
function isSwingHigh(candles: Candle[], index: number, lookback: number = 2): boolean {
  const c = candles[index];
  for (let i = 1; i <= lookback; i++) {
    if (candles[index - i]?.high >= c.high) return false;
    if (candles[index + i]?.high >= c.high) return false;
  }
  return true;
}

function isSwingLow(candles: Candle[], index: number, lookback: number = 2): boolean {
  const c = candles[index];
  for (let i = 1; i <= lookback; i++) {
    if (candles[index - i]?.low <= c.low) return false;
    if (candles[index + i]?.low <= c.low) return false;
  }
  return true;
}

// Определение структуры тренда
function detectTrendStructure(swings: SwingPoint[]): TrendBias {
  const highs = swings.filter(s => s.type === 'high').slice(-3);
  const lows  = swings.filter(s => s.type === 'low').slice(-3);

  const hhCount = highs.every((h, i) => i === 0 || h.price > highs[i-1].price) ? 1 : 0;
  const hlCount = lows.every((l, i) => i === 0 || l.price > lows[i-1].price) ? 1 : 0;

  if (hhCount && hlCount) return 'bullish';
  if (!hhCount && !hlCount) return 'bearish';
  return 'ranging';
}
```

**lookback = 2** — минимум для шума. **lookback = 5** — для 4H структуры.

---

### Support and Resistance

Murphy: "Поддержка — это уровень, где покупательное давление достаточно сильно, чтобы остановить падение. Сопротивление — где давление продаж останавливает рост."

**Ключевое свойство: Role Reversal**
Пробитая поддержка становится сопротивлением. Пробитое сопротивление — поддержкой.

**Алгоритм программной идентификации:**
```typescript
interface SRLevel {
  price: number;
  strength: number;   // количество касаний
  type: 'support' | 'resistance' | 'both';
  lastTouched: number; // timestamp
}

function identifySRLevels(
  candles: Candle[],
  tolerance: number = 0.003  // 0.3% tolerance
): SRLevel[] {
  const levels: SRLevel[] = [];

  // Шаг 1: Собираем все swing highs и swing lows
  for (let i = 5; i < candles.length - 5; i++) {
    if (isSwingHigh(candles, i, 5)) {
      mergeLevelOrCreate(levels, candles[i].high, 'resistance', tolerance);
    }
    if (isSwingLow(candles, i, 5)) {
      mergeLevelOrCreate(levels, candles[i].low, 'support', tolerance);
    }
  }

  // Шаг 2: Фильтруем по минимальному числу касаний
  return levels.filter(l => l.strength >= 2)
               .sort((a, b) => b.strength - a.strength);
}

function mergeLevelOrCreate(
  levels: SRLevel[],
  price: number,
  type: 'support' | 'resistance',
  tolerance: number
): void {
  const existing = levels.find(l => Math.abs(l.price - price) / price <= tolerance);
  if (existing) {
    existing.strength++;
    existing.price = (existing.price + price) / 2; // усредняем
    if (existing.type !== type) existing.type = 'both';
  } else {
    levels.push({ price, strength: 1, type, lastTouched: Date.now() });
  }
}
```

**Дополнительные критерии силы уровня по Murphy:**
- Количество касаний (больше = сильнее)
- Объём на уровне (больше = сильнее)
- Длительность удержания (старые уровни имеют значение)
- Расстояние от текущей цены (ближние уровни важнее)

---

## Chart Patterns (с алгоритмическим обнаружением)

### Reversal Patterns

#### Head & Shoulders (H&S)

Murphy: один из самых надёжных разворотных паттернов. Формируется на вершинах (bearish) или основаниях (bullish — перевёрнутый H&S).

**Структура:**
- Left Shoulder: первый swing high
- Head: более высокий swing high
- Right Shoulder: третий swing high (ниже Head, примерно на уровне Left Shoulder)
- Neckline: линия через два впадины между плечами

**Алгоритм детекции:**
```typescript
function detectHeadAndShoulders(
  swings: SwingPoint[]
): HeadAndShouldersPattern | null {
  const highs = swings.filter(s => s.type === 'high');

  for (let i = 2; i < highs.length; i++) {
    const ls = highs[i - 2]; // Left shoulder
    const hd = highs[i - 1]; // Head
    const rs = highs[i];     // Right shoulder

    // Голова должна быть выше обоих плеч
    if (hd.price <= ls.price || hd.price <= rs.price) continue;

    // Плечи должны быть на схожих уровнях (±10%)
    const shoulderSymmetry = Math.abs(ls.price - rs.price) / hd.price;
    if (shoulderSymmetry > 0.1) continue;

    // Neckline: лоу между LS-HD и HD-RS
    const lows = swings.filter(s =>
      s.type === 'low' &&
      s.timestamp > ls.timestamp &&
      s.timestamp < rs.timestamp
    );
    if (lows.length < 2) continue;

    const necklineLeft  = lows[0].price;
    const necklineRight = lows[lows.length - 1].price;
    const necklineSlope = (necklineRight - necklineLeft) /
                          (lows[lows.length-1].timestamp - lows[0].timestamp);

    // Цель после пробоя = высота Head над neckline, отложенная вниз
    const height = hd.price - ((necklineLeft + necklineRight) / 2);

    return {
      type: 'head_and_shoulders',
      leftShoulder: ls,
      head: hd,
      rightShoulder: rs,
      necklineSlope,
      target: ((necklineLeft + necklineRight) / 2) - height,
      confirmed: false  // ставится true при пробое neckline с объёмом
    };
  }
  return null;
}
```

**Измерение цели (Murphy):** высота паттерна = head.high - neckline. Эта высота откладывается от точки пробоя вниз.

**Подтверждение:** пробой нeckline с объёмом выше среднего. Возможен throwback (возврат к neckline) — второй шанс для входа.

---

#### Double Top / Double Bottom

```typescript
function detectDoubleTop(swings: SwingPoint[], tolerance = 0.02): DoubleTop | null {
  const highs = swings.filter(s => s.type === 'high');

  for (let i = 1; i < highs.length; i++) {
    const first  = highs[i - 1];
    const second = highs[i];

    // Два peak на одном уровне (±2%)
    const priceDiff = Math.abs(first.price - second.price) / first.price;
    if (priceDiff > tolerance) continue;

    // Между ними должен быть значимый откат (> 5%)
    const valleyBetween = swings.filter(s =>
      s.type === 'low' &&
      s.timestamp > first.timestamp &&
      s.timestamp < second.timestamp
    );
    if (valleyBetween.length === 0) continue;

    const deepestValley = Math.min(...valleyBetween.map(v => v.price));
    const retracePct = (first.price - deepestValley) / first.price;
    if (retracePct < 0.05) continue;

    // Neckline = deepestValley
    // Target = neckline - (top - neckline)
    const neckline = deepestValley;
    const height = ((first.price + second.price) / 2) - neckline;

    return {
      type: 'double_top',
      firstPeak: first,
      secondPeak: second,
      neckline,
      target: neckline - height
    };
  }
  return null;
}
```

---

### Continuation Patterns

#### Flags and Pennants

Murphy: Флаги и вымпелы — краткосрочные паттерны консолидации, формирующиеся в середине резких движений. Один из самых надёжных continuation паттернов.

**Структура:**
- Flagpole: резкое импульсное движение (> 2× ATR за 3-5 свечей)
- Flag body: консолидация в слегка наклонном канале против тренда (4-20 свечей)
- Breakout: продолжение в направлении flagpole

**Алгоритм:**
```typescript
function detectFlag(candles: Candle[], atr: number): FlagPattern | null {
  const n = candles.length;
  if (n < 20) return null;

  // 1. Ищем flagpole: 3-5 свечей с суммарным движением > 3×ATR
  for (let poleEnd = 10; poleEnd < n - 5; poleEnd++) {
    const poleStart = poleEnd - 5;
    const poleMove = Math.abs(candles[poleEnd].close - candles[poleStart].close);
    if (poleMove < 3 * atr) continue;

    const isLong = candles[poleEnd].close > candles[poleStart].close;

    // 2. Консолидация после flagpole (5-20 свечей)
    const consolidStart = poleEnd + 1;
    const consolidEnd   = Math.min(consolidStart + 20, n - 1);

    const consolHigh = Math.max(...candles.slice(consolidStart, consolidEnd).map(c => c.high));
    const consolLow  = Math.min(...candles.slice(consolidStart, consolidEnd).map(c => c.low));
    const consolRange = consolHigh - consolLow;

    // Консолидация не должна быть слишком глубокой (< 50% флагштока)
    if (consolRange > poleMove * 0.5) continue;

    // Слабый наклон против тренда (для флага)
    const consolSlope = (candles[consolidEnd].close - candles[consolidStart].close) /
                        (consolidEnd - consolidStart);
    const slopeAgainst = isLong ? consolSlope < 0 : consolSlope > 0;
    if (!slopeAgainst) continue;

    // Цель = длина flagpole, отложенная от точки пробоя
    return {
      type: 'flag',
      direction: isLong ? 'bullish' : 'bearish',
      poleHeight: poleMove,
      consolidationHigh: consolHigh,
      consolidationLow: consolLow,
      target: isLong
        ? consolHigh + poleMove
        : consolLow - poleMove
    };
  }
  return null;
}
```

#### Triangles (Symmetric, Ascending, Descending)

**Ascending Triangle:** горизонтальное сопротивление + повышающиеся лоу → бычий continuation.
**Descending Triangle:** горизонтальная поддержка + понижающиеся хаи → медвежий continuation.
**Symmetric Triangle:** сужающийся диапазон, оба уровня наклонены — нейтральный, пробой в сторону тренда.

```typescript
function detectTriangle(
  swings: SwingPoint[],
  minPoints: number = 4
): TrianglePattern | null {
  const highs = swings.filter(s => s.type === 'high').slice(-4);
  const lows  = swings.filter(s => s.type === 'low').slice(-4);

  if (highs.length < 2 || lows.length < 2) return null;

  // Линейная регрессия для определения наклона
  const highSlope  = linearSlope(highs.map(h => h.price));
  const lowSlope   = linearSlope(lows.map(l => l.price));

  const tolerance = 0.001;

  if (Math.abs(highSlope) <= tolerance && lowSlope > tolerance) {
    return { type: 'ascending', breakoutBias: 'bullish' };
  }
  if (highSlope < -tolerance && Math.abs(lowSlope) <= tolerance) {
    return { type: 'descending', breakoutBias: 'bearish' };
  }
  if (highSlope < -tolerance && lowSlope > tolerance) {
    return { type: 'symmetric', breakoutBias: 'neutral' };
  }
  return null;
}
```

**Murphy по треугольникам:** пробой должен происходить не позже чем на 2/3 ширины треугольника. Пробой в последней трети ненадёжен.

---

### Wedges (Клинья)

Rising Wedge (обе линии идут вверх, сходятся) = **медвежий** сигнал.
Falling Wedge (обе линии идут вниз, сходятся) = **бычий** сигнал.

Ключевое отличие от треугольника: **обе** линии наклонены в одну сторону.

```typescript
function isWedge(highSlope: number, lowSlope: number): WedgeType | null {
  // Обе линии должны идти в одном направлении и сходиться
  if (highSlope > 0 && lowSlope > 0 && highSlope < lowSlope) {
    return 'rising_wedge';  // bearish reversal/continuation
  }
  if (highSlope < 0 && lowSlope < 0 && highSlope > lowSlope) {
    return 'falling_wedge'; // bullish reversal/continuation
  }
  return null;
}
```

---

## Indicators Deep Dive

### Moving Averages

**SMA vs EMA — ключевые различия:**
- SMA: равный вес всем периодам. Медленнее реагирует.
- EMA: экспоненциально больший вес последним данным. Быстрее.

**Murphy:** EMA предпочтительнее для трейдеров, SMA — для долгосрочных инвесторов.

**EMA формула:**
```typescript
function calcEMA(candles: Candle[], period: number): number[] {
  const k = 2 / (period + 1);  // multiplier
  const result: number[] = [];

  // Первое значение = SMA
  const firstSMA = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  result.push(firstSMA);

  for (let i = period; i < candles.length; i++) {
    result.push(candles[i].close * k + result[result.length - 1] * (1 - k));
  }
  return result;
}
```

**Оптимальные периоды для крипто (на основе бэктестов):**

| Период | Применение |
|--------|------------|
| EMA 9  | Краткосрочный импульс (15M scalping) |
| EMA 20 | Ближняя тенденция (наш текущий entry filter) |
| EMA 50 | Среднесрочный тренд (наш текущий filter) |
| EMA 100 | Среднесрочный bias |
| EMA 200 | Долгосрочный bias (golden/death cross) |
| SMA 200 | Институциональный уровень поддержки/сопротивления |

**Исследование показывает:** 13/48 EMA crossover — одна из лучших комбинаций для BTC. Однако стандартные периоды (20/50) более устойчивы к overfitting.

**Кросс-сигналы:**
```typescript
function detectEMACrossover(
  fastEMA: number[],
  slowEMA: number[]
): 'golden_cross' | 'death_cross' | 'none' {
  const n = fastEMA.length;
  const prevFastAboveSlow = fastEMA[n-2] > slowEMA[n-2];
  const currFastAboveSlow = fastEMA[n-1] > slowEMA[n-1];

  if (!prevFastAboveSlow && currFastAboveSlow) return 'golden_cross';
  if (prevFastAboveSlow && !currFastAboveSlow) return 'death_cross';
  return 'none';
}
```

**Важно по Murphy:** цена, отскочившая от MA, часто является сигналом. MA становится динамической поддержкой/сопротивлением. Особенно EMA 200 — институциональный ориентир.

---

### RSI (Relative Strength Index)

**Wilder формула (период 14):**
```typescript
function calcRSI(candles: Candle[], period: number = 14): number[] {
  const changes = candles.map((c, i) =>
    i === 0 ? 0 : c.close - candles[i-1].close
  );

  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

  // Первые avgGain/avgLoss = SMA
  let avgGain = gains.slice(1, period + 1).reduce((a, b) => a + b) / period;
  let avgLoss = losses.slice(1, period + 1).reduce((a, b) => a + b) / period;

  const rsi: number[] = new Array(period).fill(50);

  for (let i = period; i < candles.length - 1; i++) {
    avgGain = (avgGain * (period - 1) + gains[i + 1]) / period; // Wilder smoothing
    avgLoss = (avgLoss * (period - 1) + losses[i + 1]) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  return rsi;
}
```

**Зоны по Murphy:**
- RSI > 70: перекупленность (не сигнал продажи сам по себе!)
- RSI < 30: перепроданность (не сигнал покупки сам по себе!)
- RSI > 50: бычий bias
- RSI < 50: медвежий bias

**Дивергенция RSI — самый ценный сигнал:**
```typescript
function detectRSIDivergence(
  candles: Candle[],
  rsi: number[],
  lookback: number = 14
): 'bullish_div' | 'bearish_div' | 'none' {
  const n = candles.length;
  const window = candles.slice(-lookback);
  const rsiWindow = rsi.slice(-lookback);

  // Bullish divergence: цена делает LL, RSI делает HL
  const priceLL = window[window.length-1].low < Math.min(...window.slice(0,-1).map(c => c.low));
  const rsiHL   = rsiWindow[rsiWindow.length-1] > Math.min(...rsiWindow.slice(0,-1));

  if (priceLL && rsiHL) return 'bullish_div';

  // Bearish divergence: цена делает HH, RSI делает LH
  const priceHH = window[window.length-1].high > Math.max(...window.slice(0,-1).map(c => c.high));
  const rsiLH   = rsiWindow[rsiWindow.length-1] < Math.max(...rsiWindow.slice(0,-1));

  if (priceHH && rsiLH) return 'bearish_div';

  return 'none';
}
```

**Murphy предупреждает:** RSI даёт ложные сигналы в сильных трендах (может оставаться в overbought долго). Дивергенция надёжнее абсолютных уровней.

---

### MACD

**Параметры по умолчанию:** 12, 26, 9 (EMA fast, EMA slow, Signal line)

```
MACD Line   = EMA(12) - EMA(26)
Signal Line = EMA(9) of MACD Line
Histogram   = MACD Line - Signal Line
```

**Три типа сигналов (по Murphy):**

1. **Crossover** (слабее): MACD пересекает Signal Line
2. **Zero line cross** (сильнее): MACD пересекает нулевую линию
3. **Divergence** (самый надёжный): цена делает новый экстремум, MACD — нет

```typescript
function detectMACDSignals(macd: MACDData): MACDSignal {
  const n = macd.macdLine.length;
  const curr = macd.macdLine[n-1];
  const prev = macd.macdLine[n-2];
  const currSig = macd.signalLine[n-1];
  const prevSig = macd.signalLine[n-2];
  const currHist = macd.histogram[n-1];
  const prevHist = macd.histogram[n-2];

  // Crossover
  const bullishCross = prev < prevSig && curr > currSig;
  const bearishCross = prev > prevSig && curr < currSig;

  // Histogram momentum shift (ранний сигнал)
  const histMomentumBull = prevHist < 0 && currHist > prevHist; // гистограмма растёт из негатива
  const histMomentumBear = prevHist > 0 && currHist < prevHist; // гистограмма падает из позитива

  return {
    bullishCrossover: bullishCross,
    bearishCrossover: bearishCross,
    bullishMomentum: histMomentumBull,
    bearishMomentum: histMomentumBear,
    aboveZero: curr > 0
  };
}
```

**Оптимальные таймфреймы для крипто:** 4H и Daily дают наиболее надёжные MACD-сигналы. 15M — много шума, использовать только как дополнительный фильтр.

---

### Stochastic Oscillator

**Формула:**
```
%K = (Close - Lowest Low) / (Highest High - Lowest Low) × 100
%D = SMA(3) of %K
```

**Параметры:** стандартные (14, 3, 3). Для крипто Murphy-совместимый подход:
- Быстрый Stochastic (5, 3): для 15M scalping, очень чувствительный
- Медленный Stochastic (14, 3): для 4H/1H, более надёжный

**Зоны:** > 80 = overbought, < 20 = oversold.

**Важно:** Stochastic отлично работает в боковиках, хуже — в сильных трендах. Комбинируйте с определением режима рынка.

---

## Volume Analysis

### Принципы Мёрфи по объёму

Murphy: "Объём — второй по важности инструмент после цены."

**Ключевые правила:**
1. В аптренде: объём должен расти на ралли и падать на откатах
2. В даунтренде: объём должен расти на снижении и падать на отскоках
3. Расхождение объём/цена = ранний сигнал разворота
4. **Пробой уровня без объёма** = подозрительно (вероятный fake breakout)

**Volume Ratio (наш текущий подход):**
```typescript
function calcVolumeRatio(candles: Candle[], period: number = 20): number {
  const avgVolume = candles.slice(-period - 1, -1)
    .reduce((sum, c) => sum + c.volume, 0) / period;
  return candles[candles.length - 1].volume / avgVolume;
}
// > 2.0 = сильное подтверждение (5 pts в нашей системе)
// 1.5-2.0 = умеренное (3 pts)
```

### On-Balance Volume (OBV)

Cumulative indicator: если цена выросла — добавляем объём, упала — вычитаем.

```typescript
function calcOBV(candles: Candle[]): number[] {
  const obv: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i-1].close;
    const curr = candles[i].close;
    const vol  = candles[i].volume;

    if (curr > prev) obv.push(obv[obv.length-1] + vol);
    else if (curr < prev) obv.push(obv[obv.length-1] - vol);
    else obv.push(obv[obv.length-1]);
  }
  return obv;
}
```

**OBV для нашего бота:**
- OBV растёт при боковой цене = **стелс-аккумуляция** (бычий)
- OBV падает при боковой цене = **стелс-дистрибуция** (медвежий)
- OBV дивергенция = один из самых ранних сигналов разворота

**Confirmation matrix:**
```
Цена вверх + OBV вверх  → сильный аптренд, можно торговать long
Цена вверх + OBV вниз   → bearish divergence, осторожно с лонгами
Цена вниз  + OBV вниз   → сильный даунтренд, можно торговать short
Цена вниз  + OBV вверх  → bullish divergence, осторожно с шортами
```

---

## Multi-Timeframe Analysis

### Методология по Murphy (Top-Down подход)

Murphy описывает принцип Elder (Three Screen System): анализ должен начинаться с самого высокого таймфрейма.

**Правило таймфреймов:** каждый следующий ТФ примерно в 4-5x меньше предыдущего:
```
Daily (общий контекст)  ×4
  → 4H (bias)           ×4
    → 1H (структура)    ×4
      → 15M (entry)     ×3
        → 5M (precision)
```

**Наша реализация:**
```typescript
enum Timeframe { TF_5M, TF_15M, TF_1H, TF_4H, TF_1D }

interface MTFAnalysis {
  daily:  { bias: TrendBias; phase: MarketPhase };
  h4:     { bias: TrendBias; keyLevels: SRLevel[]; obFVG: SMCContext };
  h1:     { structure: TrendBias; lastBOS: BOSEvent | null };
  m15:    { score: ConfluenceScore; signal: TradeSignal | null };
}

function analyzeMTF(symbol: string): MTFAnalysis {
  // 1. Daily: определяем долгосрочный bias
  const dailyBias = getTrendBias(candles['1D']);

  // 2. 4H: торговый контекст + SMC зоны
  const h4Bias = getTrendBias(candles['4H']);
  const h4SMC  = detectSMCZones(candles['4H']);

  // 3. 1H: подтверждение структуры
  const h1Structure = getTrendBias(candles['1H']);
  const h1BOS = detectLastBOS(candles['1H']);

  // 4. 15M: entry score
  // Торгуем ТОЛЬКО если 4H bias == 15M direction
  if (dailyBias !== h4Bias) return { /* NO TRADE — conflict */ };
  if (h4Bias !== h1Structure) return { /* weaker signal */ };

  const m15Score = calcConfluenceScore(candles['15M'], h4SMC, h4Bias);

  return { daily: dailyBias, h4: h4Bias, h1: h1Structure, m15: m15Score };
}
```

**Правило фильтра по Murphy:** не торговать против высшего таймфрейма. Если 4H медвежий — не открывать лонги на 15M, сколько бы очков они не набрали.

**MTF Alignment Score:**
```typescript
function calcMTFAlignmentBonus(
  dailyBias: TrendBias,
  h4Bias: TrendBias,
  h1Bias: TrendBias,
  direction: 'long' | 'short'
): number {
  const targetBias = direction === 'long' ? 'bullish' : 'bearish';
  let bonus = 0;

  if (dailyBias === targetBias) bonus += 10;
  if (h4Bias === targetBias)    bonus += 15;
  if (h1Bias === targetBias)    bonus += 5;

  return bonus; // максимум +30 если все TF aligned
}
```

---

## Fibonacci Retracements and Extensions

### Ключевые уровни по Murphy

**Retracement levels:** 23.6%, 38.2%, 50%, 61.8%, 78.6%
**Extension levels:** 100%, 127.2%, 138.2%, 161.8%, 200%, 261.8%

**Самый важный уровень:** 61.8% (Golden Ratio). Murphy: "Если цена не удерживается на 61.8% — ожидайте полного разворота тренда."

**Алгоритм автоматического расчёта:**
```typescript
const FIB_RETRACES  = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
const FIB_EXTENSIONS = [1.0, 1.272, 1.382, 1.618, 2.0, 2.618];

function calcFibLevels(swingHigh: number, swingLow: number, bias: 'bullish' | 'bearish') {
  const range = swingHigh - swingLow;

  // Retracements (куда может откатиться)
  const retracements = FIB_RETRACES.map(ratio => ({
    ratio,
    price: bias === 'bullish'
      ? swingHigh - range * ratio    // откат вниз после роста
      : swingLow + range * ratio,    // откат вверх после падения
    label: `${(ratio * 100).toFixed(1)}%`
  }));

  // Extensions (куда может дойти после пробоя)
  const extensions = FIB_EXTENSIONS.map(ratio => ({
    ratio,
    price: bias === 'bullish'
      ? swingLow + range * ratio
      : swingHigh - range * ratio,
    label: `${(ratio * 100).toFixed(1)}%`
  }));

  return { retracements, extensions };
}

// Fibonacci Confluence Zone: уровень на котором совпадают несколько Fib уровней
function findFibConfluence(
  fibSets: FibLevel[][],
  tolerance: number = 0.003  // 0.3%
): FibZone[] {
  const allLevels = fibSets.flat();
  const zones: FibZone[] = [];

  for (const level of allLevels) {
    const nearby = allLevels.filter(l =>
      l !== level &&
      Math.abs(l.price - level.price) / level.price <= tolerance
    );
    if (nearby.length >= 2) {
      zones.push({ price: level.price, strength: nearby.length + 1 });
    }
  }

  return zones.filter((z, i, arr) =>
    arr.findIndex(x => Math.abs(x.price - z.price) / z.price < tolerance) === i
  );
}
```

**Связь с Elliott Wave:**
- Wave 2 typically retraces 38.2%–61.8% of Wave 1
- Wave 3 typically extends to 161.8% of Wave 1
- Wave 4 typically retraces 23.6%–38.2% of Wave 3
- Wave 5 typically equals Wave 1 OR extends to 61.8% of Waves 1+3

---

## Japanese Candlestick Patterns

### Ключевые паттерны с алгоритмической детекцией

Murphy добавил главу о японских свечах, считая их важным дополнением к западному TA.

```typescript
interface CandlePattern {
  type: string;
  bullish: boolean;
  strength: 'strong' | 'moderate' | 'weak';
}

function detectCandlePatterns(candles: Candle[], atr: number): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  const curr = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const body = Math.abs(curr.close - curr.open);
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const totalRange = curr.high - curr.low;

  // === SINGLE CANDLE PATTERNS ===

  // Doji: тело < 10% диапазона
  if (body / totalRange < 0.1 && totalRange > 0.3 * atr) {
    patterns.push({ type: 'doji', bullish: false, strength: 'weak' });
  }

  // Hammer: нижний хвост > 2× тела, маленький верхний хвост, после даунтренда
  if (lowerWick > 2 * body && upperWick < 0.3 * body && body > 0) {
    patterns.push({ type: 'hammer', bullish: true, strength: 'moderate' });
  }

  // Shooting Star: верхний хвост > 2× тела, маленький нижний хвост
  if (upperWick > 2 * body && lowerWick < 0.3 * body && body > 0) {
    patterns.push({ type: 'shooting_star', bullish: false, strength: 'moderate' });
  }

  // Marubozu: почти нет хвостов, сильное направленное тело
  if (body > 0.85 * totalRange && totalRange > 1.5 * atr) {
    patterns.push({
      type: 'marubozu',
      bullish: curr.close > curr.open,
      strength: 'strong'
    });
  }

  // === TWO CANDLE PATTERNS ===

  // Bullish Engulfing
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  if (prevBearish && currBullish &&
      curr.open < prev.close && curr.close > prev.open &&
      body > Math.abs(prev.close - prev.open)) {
    patterns.push({ type: 'bullish_engulfing', bullish: true, strength: 'strong' });
  }

  // Bearish Engulfing
  const prevBullish = prev.close > prev.open;
  const currBearish = curr.close < curr.open;
  if (prevBullish && currBearish &&
      curr.open > prev.close && curr.close < prev.open &&
      body > Math.abs(prev.close - prev.open)) {
    patterns.push({ type: 'bearish_engulfing', bullish: false, strength: 'strong' });
  }

  // === THREE CANDLE PATTERNS ===

  // Morning Star (сильный bullish reversal)
  const c1Bear = prev2.close < prev2.open;
  const c2Small = Math.abs(prev.close - prev.open) < 0.3 * atr; // маленькое тело
  const c3Bull = curr.close > curr.open;
  const c3Recovers = curr.close > (prev2.open + prev2.close) / 2;

  if (c1Bear && c2Small && c3Bull && c3Recovers) {
    patterns.push({ type: 'morning_star', bullish: true, strength: 'strong' });
  }

  return patterns;
}
```

**Приоритет паттернов для нашего бота:**
1. Engulfing + Marubozu: сильный сигнал, высокий вес
2. Morning/Evening Star: надёжный разворот на ключевых уровнях
3. Hammer/Shooting Star: только на значимых S/R уровнях
4. Doji: сигнал нерешительности, не торговать в одиночестве

---

## Elliott Wave Basics

### Пять волновых принципов

Murphy: Elliott Wave — "один из самых полезных и всесторонних подходов к анализу рынка."

**Структура:**
```
Impulse (5 волн):   1 → 2 → 3 → 4 → 5
Corrective (3 волны): A → B → C

Волны 1, 3, 5 — импульсные (в направлении тренда)
Волны 2, 4 — коррективные (против тренда)
```

**Неизменные правила:**
1. Wave 2 никогда не пересекает начало Wave 1
2. Wave 3 никогда не является самой короткой импульсной волной
3. Wave 4 никогда не пересекает ценовую территорию Wave 1

**Fibonacci связи:**
- Wave 2 = 38.2%–61.8% retrace Wave 1
- Wave 3 = 161.8%–261.8% of Wave 1 (самая длинная и сильная)
- Wave 4 = 23.6%–38.2% retrace Wave 3
- Wave 5 = equal to Wave 1 OR 61.8% of Waves 1-3

**Практическое применение для алго:**

Elliott Wave сложно автоматизировать точно, но его принципы полезны как фильтр:

```typescript
function checkElliottWavePosition(
  currentRetrace: number,   // % откат от последнего swing
  waveCount: number         // предполагаемый номер волны
): ElliottFilter {
  if (waveCount === 2) {
    // Wave 2 entry: ищем лонг на 38.2%-61.8% откате
    if (currentRetrace >= 0.382 && currentRetrace <= 0.618) {
      return { valid: true, expectedTarget: 1.618 }; // Wave 3 = 161.8%
    }
  }
  if (waveCount === 4) {
    // Wave 4 entry: 23.6%-38.2% откат
    if (currentRetrace >= 0.236 && currentRetrace <= 0.382) {
      return { valid: true, expectedTarget: 1.0 }; // Wave 5 = equal Wave 1
    }
  }
  return { valid: false };
}
```

**Caveat:** Для нашего бота Elliott Wave используется только как дополнительная проверка Fibonacci уровней, а не как основной сигнал — слишком субъективен для полной автоматизации.

---

## Intermarket Analysis (BTC Dominance)

### Принципы Мёрфи применительно к крипто

Murphy в "Intermarket Technical Analysis" (1991) описал взаимосвязи: bonds → stocks → commodities → currencies. В крипто аналогичные связи:

**BTC как "reserve currency" крипторынка:**
```
BTC Dominance ↑ → Капитал концентрируется в BTC → Алты падают
BTC Dominance ↓ → Капитал ротируется в алты → "Altseason"
```

**Практическая матрица:**
```typescript
type BTCDominanceTrend = 'rising' | 'falling' | 'flat';
type BTCPriceTrend     = 'bullish' | 'bearish' | 'ranging';

interface CryptoMarketRegime {
  btcDominanceTrend: BTCDominanceTrend;
  btcPriceTrend:     BTCPriceTrend;
  altBias:           'risk_on' | 'risk_off' | 'neutral';
  tradingMode:       'btc_only' | 'alts_follow' | 'avoid';
}

function getCryptoMarketRegime(
  btcDom: number[],
  btcPrice: number[]
): CryptoMarketRegime {
  const domTrend   = getSimpleTrend(btcDom);
  const priceTrend = getSimpleTrend(btcPrice);

  // BTC растёт, доминанс падает = alt season → торговать алтами
  if (priceTrend === 'bullish' && domTrend === 'falling') {
    return { altBias: 'risk_on', tradingMode: 'alts_follow' };
  }
  // BTC падает, доминанс растёт = risk off, капитал в BTC → не торговать алты
  if (priceTrend === 'bearish' && domTrend === 'rising') {
    return { altBias: 'risk_off', tradingMode: 'btc_only' };
  }
  // BTC растёт, доминанс растёт = BTC rally, алты отстают
  if (priceTrend === 'bullish' && domTrend === 'rising') {
    return { altBias: 'neutral', tradingMode: 'btc_only' };
  }
  // BTC падает, доминанс падает = тотальный risk off → не торговать
  return { altBias: 'risk_off', tradingMode: 'avoid' };
}
```

**Ключевые уровни BTC доминанса:**
- 40%: исторически сильная поддержка в bull markets
- 50%: зона сопротивления при росте доминанса
- 60%+: экстремальный risk-off, только BTC

**Correlation бета-коэффициенты (практические значения):**
- ETH/BTC beta: ~1.1-1.5x
- SOL/BTC beta: ~1.5-2.0x
- Мемкоины: ~2.5-4.0x (непредсказуемо)

**Межрыночный анализ для multi-pair стратегии:**
```typescript
function shouldTradeAlt(
  altSymbol: string,
  btcMomentum: number,   // BTC % change last 4H
  btcDomChange: number,  // BTC.D % change last 4H
  altBeta: number        // known beta
): boolean {
  // Если BTC резко падает → не торгуем алты (риск cascade)
  if (btcMomentum < -2.0) return false;

  // Если доминанс резко растёт → капитал уходит в BTC
  if (btcDomChange > 1.5) return false;

  // Если BTC растёт + доминанс падает → лучшие условия для алтов
  if (btcMomentum > 1.0 && btcDomChange < -0.5) return true;

  return true; // нейтральные условия, продолжаем анализ
}
```

---

## Actionable Insights for Our Bot

### Что немедленно улучшает нашу стратегию

**1. Dow Theory Trend Filter (High Priority)**
Добавить проверку Primary Trend через Daily/Weekly EMA 200. Торговать ТОЛЬКО в направлении primary trend. Убирает значительную часть loser-трейдов против тренда.

```typescript
// Добавить в ConfluenceScorer
const dailyBias = getDailyTrendBias(dailyCandles); // EMA20 vs EMA50 на дневном
if (direction !== dailyBias) score -= 15; // штраф за торговлю против Primary Trend
```

**2. Volume-OBV Divergence Filter**
OBV дивергенция как дополнительный confirmation/veto:
- Bullish OBV divergence + наш сигнал лонг = +5 pts bonus
- Bearish OBV divergence + сигнал лонг = -10 pts penalty (или veto)

**3. Fibonacci Confluence с OB/FVG (Medium Priority)**
Когда наш Order Block попадает в зону 61.8% Fibonacci retracement от последнего swing — это существенно усиливает сигнал. Добавить проверку:

```typescript
function isFibConfluenceZone(
  obPrice: number,
  recentSwingHigh: number,
  recentSwingLow: number,
  tolerance: number = 0.005
): boolean {
  const fibs = calcFibLevels(recentSwingHigh, recentSwingLow, 'bullish');
  return fibs.retracements.some(f =>
    [0.382, 0.5, 0.618, 0.786].includes(f.ratio) &&
    Math.abs(f.price - obPrice) / obPrice <= tolerance
  );
}
```

**4. Candlestick Confirmation Layer**
Требовать наличие bullish/bearish candlestick паттерна при касании OB для входа:
- Engulfing = сильное подтверждение (+5 pts)
- Hammer/Pin Bar на OB = подтверждение (+3 pts)
- Marubozu в направлении = подтверждение (+3 pts)

**5. Intermarket Pre-Filter для алтов**
Перед анализом любого альткоина проверять рыночный режим:
- BTC.D растёт > 1% за 4H → пропускаем сигнал на алтах
- BTC упал > 2% за 4H → пропускаем сигнал на алтах
- BTC растёт + BTC.D падает → усиленный bias для алт-лонгов

**6. MTF Alignment Bonus**
Текущая система уже использует MTF (4H bias для 15M entry). Улучшение: добавить Daily как третий фильтр. Если все три ТФ aligned — bonus +5 pts.

**7. RSI Divergence как Entry Refiner**
Не добавлять RSI divergence к score (он там уже есть косвенно), но использовать как precision tool: если OB + Fib + RSI bullish divergence совпали — это идеальный сетап, требующий меньшего общего score (порог 65 вместо 70).

### Параметры которые НЕ стоит автоматизировать

- Elliott Wave счёт волн: слишком субъективен, много ложных интерпретаций
- Dow Theory подтверждение через два индекса: в крипто нет прямого аналога (BTC.D не то же самое)
- Point & Figure charts: неприменимы к real-time algo trading
- Нейроподобные паттерны (голова-плечи): работают, но дают мало сигналов на 15M

### Риски и caveats

1. **Overfitting на исторические паттерны:** Мёрфи писал о традиционных рынках. Крипто 2020+ показал, что многие классические паттерны работают иначе из-за высокого влияния ретейл-трейдеров и манипуляций.

2. **Паттерны работают пока в них верят:** Self-fulfilling prophecy — H&S срабатывает частично потому, что все его видят. Когда популярность паттерна падает — эффективность снижается.

3. **Объём в крипто менее надёжен:** wash trading на многих биржах делает объёмные подтверждения менее точными, чем на традиционных рынках.

4. **BTC Dominance задержка:** изменение доминанса запаздывает за ценой на 1-4 часа. Не использовать как real-time entry signal, только как режимный фильтр.

5. **Fibonacci не является "магическим":** уровни 38.2% и 61.8% работают не потому что они "природные", а потому что достаточное число участников рынка следят за ними.

---

## Summary: Приоритеты внедрения

| Улучшение | Сложность | Ожидаемый эффект | Приоритет |
|-----------|-----------|------------------|-----------|
| Daily trend filter | Низкая | WR +3-5% | HIGH |
| Fib confluence с OB | Средняя | Улучшение entry | HIGH |
| Candlestick confirmation | Низкая | Precision +2-3% | HIGH |
| Intermarket alt filter | Низкая | DD снижение | HIGH |
| OBV divergence | Средняя | Veto false signals | MEDIUM |
| MTF Daily alignment bonus | Низкая | Score quality | MEDIUM |
| RSI divergence as precision | Средняя | Entry precision | MEDIUM |
| Elliott Wave filter | Высокая | Минимальный | LOW |

---

**Sources:**
- [TraderLion — Technical Analysis of the Financial Markets Summary](https://traderlion.com/trading-books/technical-analysis-of-the-financial-markets/)
- [Bookey — Chapter Summary](https://www.bookey.app/book/technical-analysis-of-the-financial-markets)
- [NBER — Foundations of Technical Analysis: Computational Algorithms](https://www.nber.org/system/files/working_papers/w7613/w7613.pdf)
- [PapersWithBacktest — Head and Shoulders Detection](https://paperswithbacktest.com/wiki/head-and-shoulders-chart-pattern-technical-analysis)
- [AltFINS — RSI Divergence](https://altfins.com/knowledge-base/rsi-divergence/)
- [LuxAlgo — Volume Trend Confirmation](https://www.luxalgo.com/blog/using-volume-to-confirm-trends-best-trading-strategies/)
- [EBC — Dow Theory Six Tenets](https://www.ebc.com/forex/what-is-dow-theory-the-6-tenets-that-shape-market-analysis)
- [Elliott Wave Forecast — Theory Overview](https://elliottwave-forecast.com/elliott-wave-theory/)
- [QuantPedia — Multi-Timeframe Bitcoin Strategy](https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/)
- [BingX — BTC Dominance Analysis](https://bingx.com/en/learn/article/what-is-bitcoin-dominance-and-how-to-use-it-in-crypto-trading)
- [HyroTrader Blog — Moving Averages in Crypto](https://www.hyrotrader.com/blog/moving-averages-in-crypto/)
- [Trendoscope — Flag and Pennant Patterns BTCUSDT](https://trendoscope.com/blog/flags-and-pennants)
