# Volatility Analysis for Futures Trading
## Based on Natenberg "Option Volatility & Pricing" and Hull "Options, Futures, and Other Derivatives"

**Date:** 2026-04-06
**Author:** Learner Agent
**Focus:** Volatility regime detection and SL/TP calibration for BTCUSDT USDT Perpetual trading bot

**Sources:**
- [Natenberg: Option Volatility & Pricing — Book Review & Summary](https://kriminiltrading.com/blogs/must-read-economic-market-books/option-volatility-pricing-by-natenberg-my-book-summary-review)
- [Natenberg — QuantRL Summary](https://quantrl.com/natenberg-option-volatility-and-pricing/)
- [Hull: Volatility Surfaces — Rotman/Toronto Paper](https://www-2.rotman.utoronto.ca/~hull/DownloadablePublications/DaglishHullSuoRevised.pdf)
- [Risk Premia in Bitcoin Market — arxiv 2410.15195](https://arxiv.org/pdf/2410.15195)
- [Deribit DVOL Index — Deribit Insights](https://insights.deribit.com/exchange-updates/dvol-deribit-implied-volatility-index/)
- [Demystifying DVOL Futures — Deribit Insights](https://insights.deribit.com/industry/demystifying-dvol-futures/)
- [Gamma Exposure — Glassnode Insights](https://insights.glassnode.com/gamma-exposure/)
- [Gamma Exposure Heatmap — Glassnode](https://insights.glassnode.com/gamma-exposure-heatmap/)
- [Crypto Gamma Models Guide — MenthorQ](https://menthorq.com/guide/crypto-gamma-models/)
- [GARCH for Crypto Volatility — Medium/Akbay](https://medium.com/@yavuzakbay/forecasting-crypto-volatility-with-garch-models-6a67822d1273)
- [GARCH Cryptocurrency Study — MDPI Mathematics](https://www.mdpi.com/2227-7390/9/14/1614)
- [Bitcoin Volatility Trends — Fidelity Digital Assets](https://www.fidelitydigitalassets.com/research-and-insights/bitcoin-price-phases-navigating-bitcoins-volatility-trends)
- [Bitcoin Volatility — S&P Global](https://www.spglobal.com/en/research-insights/special-reports/bitcoin-volatility-trends-deep-dive)
- [IV Rank and Percentile — Charles Schwab](https://www.schwab.com/learn/story/using-implied-volatility-percentiles)
- [Max Pain in Crypto Options — CoinPerps](https://www.coinperps.com/learn/max-pain-in-options-trading-explained)
- [BTC Options Max Pain — KuCoin](https://www.kucoin.com/blog/en-bitcoin-options-max-pain-price-how-expiring-options-shape-btc-short-term-trends)
- [Funding Rate Dynamics — Coinbase Institutional](https://www.coinbase.com/institutional/research-insights/research/market-intelligence/a-primer-on-perpetual-futures)
- [Volatility-Based Stop Indicator — LuxAlgo](https://www.luxalgo.com/blog/volatility-stop-indicator-volatility-based-trailing-stop-strategy/)

---

## Executive Summary

Мы не торгуем опционами, но опционный рынок — это наиболее точный барометр рыночных ожиданий и страха. Понимание концепций волатильности из работ Natenberg и Hull даёт фьючерсному трейдеру три критических преимущества:

1. **Режимное понимание** — знать, в каком состоянии рынок прямо сейчас (сжатие, расширение, переход)
2. **Калибровка SL/TP** — настраивать стопы на основе реального «шума» рынка, а не фиксированных ATR-множителей
3. **Понимание потоков** — как хеджирование маркет-мейкеров влияет на движения спота и перпетуальных фьючерсов

---

## 1. Подразумеваемая волатильность (IV) — что она говорит

### Фундаментальное определение (Natenberg)

Implied volatility (IV) — это единственный параметр в модели ценообразования опционов (Black-Scholes), который не наблюдается напрямую. Она выводится из рыночной цены опциона и представляет **консенсусный прогноз рынка** о том, насколько сильно будет двигаться актив до экспирации.

Ключевая формула для практического понимания:

```
Ожидаемое дневное движение = IV_годовая / sqrt(252)

При DVOL = 60% (типичный BTC):
  Дневное движение = 60% / sqrt(252) ≈ 3.8%

При DVOL = 90% (высокая волатильность):
  Дневное движение = 90% / sqrt(252) ≈ 5.7%

При DVOL = 40% (низкая волатильность):
  Дневное движение = 40% / sqrt(252) ≈ 2.5%

Короткое правило (Deribit): ожидаемое дневное движение ≈ DVOL / 20
```

Hull добавляет важное уточнение: IV — это **прогноз рынка**, а не гарантия. В реальности realized volatility может существенно отличаться. Разница между ними и создаёт торговые возможности.

### Что IV говорит фьючерсному трейдеру

Высокая IV означает, что рынок ожидает **крупных движений** в ближайшие 30 дней. Это влияет на нас следующим образом:

- **SL должен быть шире** — "нормальный" шум увеличивается. Стоп 2×ATR при DVOL=40% и DVOL=80% означает разные вещи в абсолютных долларах.
- **TP цели реалистичнее** — крупные движения подтверждают, что рынок "ждёт" выхода. Трендовые стратегии работают лучше.
- **Риск несимметричен** — высокая IV перед событием (ФРС, халвинг) означает не просто "будет движение", но и что движение может быть в любую сторону.

---

## 2. Historical vs Implied Volatility — Volatility Risk Premium

### Концепция VRP (Natenberg + Hull)

Volatility Risk Premium (VRP) — это систематическая разница между implied volatility и последующей realized volatility:

```
VRP = IV_30day - RV_30day_realized

На BTC исторически: VRP ≈ +8-15 pp (IV всегда выше реализованной)
```

Это означает: **опционный рынок хронически переоценивает будущую волатильность BTC**. Продавцы опционов (маркет-мейкеры) собирают этот премиум как плату за риск.

Для нас, фьючерсных трейдеров, VRP имеет следующие следствия:

**Когда IV >> RV (высокий VRP):**
- Рынок напуган/перегрет эмоционально
- Цена, скорее всего, останется в диапазоне или двинется "разочаровывающе" мало
- SMC сетапы в этот момент: ожидать фейки и ложные пробои
- Стратегия: сужать TP (рынок не выдаст обещанного движения), ужесточать фильтры

**Когда IV ≈ RV (низкий VRP):**
- Рынок "не боится" — фактически недооценивает риск
- Часто предшествует резкому движению (volatility compression → explosion)
- Это наш лучший момент: trending move у OB с последующей трендовой экспансией
- Стратегия: TP шире, trailing stop — наш друг

### Практическое вычисление

```
RV_20 = std(log(close/close[1]), 20 bars) * sqrt(252) * 100
// Дает исторически реализованную волатильность в %

HV_Rank = percentile(RV_20, current, 252 bars)
// 0% = минимальная за год, 100% = максимальная за год

VRP_proxy = DVOL - RV_20
// Если > +10: рынок переплачивает за страх
// Если < +5: рынок не боится = следить за взрывом
```

---

## 3. Volatility Smile и Skew в Крипто — что это означает

### Базовая концепция (Hull, Chapter 20)

В теоретической модели Black-Scholes IV должна быть одинаковой для всех страйков. В реальности существует **volatility smile / skew** — IV отличается для разных страйков.

**Equity/Traditional markets** — "volatility smirk" или "negative skew":
- Пут-опционы (защита от падения) дороже колл-опционов
- Рынок больше боится резких падений, чем роста

**Crypto (BTC) — Reverse/Positive skew:**
- Исторически BTC имел положительный скью — колл-опционы были дороже путов
- Это "action gauge" вместо "fear gauge" (Deribit): BTC ждут скорее взрывного роста, чем краша
- В медвежьих рынках скью нейтрализуется или уходит в отрицательную зону

### Что скью говорит фьючерсному трейдеру

| Состояние скью | Что означает | Следствие для нас |
|----------------|--------------|-------------------|
| Положительный (call premium > put premium) | Рынок ждёт роста. Институционалы покупают upside | Лонги работают лучше. Шорты — против потока |
| Нейтральный (call ≈ put) | Неопределённость | Оба направления равновероятны |
| Отрицательный (put premium > call premium) | Рынок боится краша | Медвежий bias. Шорты от ключевых уровней |
| Экстремально отрицательный | Паника/страх | Часто — OB покупки: рынок перегнул |

**Практический инструмент:** Смотреть на 25-delta Risk Reversal (25RR) на Deribit:
- `25RR > 0`: call дороже = бычий настрой
- `25RR < 0`: put дороже = медвежий настрой
- Резкое изменение 25RR за 1-2 дня = разворот настроений

---

## 4. Волатильные режимы — детекция Low/High Vol Environment

### Четыре режима волатильности (синтез Natenberg + практика)

Natenberg описывает волатильность как **mean-reverting процесс**. На практике это означает, что IV и RV всегда возвращаются к долгосрочному среднему. Мы можем классифицировать режимы:

```
Режим 1 — COMPRESSED (сжатие):
  HV_Rank < 20%, ATR/Price < percentile_15
  Характеристика: tight range, BB сужается, BBWP < 20
  Предиктор: взрывное движение неизбежно (направление неизвестно)
  Для стратегии: снизить confluence threshold (лучшие сетапы — перед взрывом)

Режим 2 — NORMAL (нормальный):
  HV_Rank 20-60%
  Характеристика: типичная волатильность, стратегия работает штатно
  Для стратегии: стандартные параметры

Режим 3 — EXPANDED (расширение):
  HV_Rank 60-80%, ATR/Price > percentile_75
  Характеристика: после крупного движения, vol ещё не остыла
  Для стратегии: шире SL и TP, TP trailing, размер × 0.75

Режим 4 — EXTREME (экстремальный):
  HV_Rank > 80%, ATR/Price > percentile_90
  Характеристика: паника, flash crash, новости
  Для стратегии: остановить торговлю или размер × 0.5, только A+ сетапы
```

### Алгоритм определения режима (TypeScript-псевдокод)

```typescript
interface VolatilityRegime {
  state: 'compressed' | 'normal' | 'expanded' | 'extreme';
  hvRank: number;       // 0-100
  atrPercentile: number; // 0-100
  sizeMultiplier: number; // для position sizing
  slMultiplier: number;   // для SL width
  tpMultiplier: number;   // для TP targets
}

function detectRegime(candles: Candle[], lookback = 252): VolatilityRegime {
  // 1. Рассчитать текущую Historical Volatility (20-bar)
  const returns = candles.slice(-21).map((c, i, arr) =>
    i === 0 ? 0 : Math.log(c.close / arr[i - 1].close)
  ).slice(1);
  const hvCurrent = stdDev(returns) * Math.sqrt(252) * 100;

  // 2. Рассчитать HV Rank за lookback период
  const hvHistory = calcRollingHV(candles, 20, lookback);
  const hvRank = percentileRank(hvHistory, hvCurrent);

  // 3. ATR Percentile
  const atrHistory = calcATRHistory(candles, 14, lookback);
  const atrCurrent = atrHistory[atrHistory.length - 1];
  const atrPercentile = percentileRank(atrHistory, atrCurrent);

  // 4. Определить режим
  if (hvRank < 20 && atrPercentile < 25) {
    return { state: 'compressed', hvRank, atrPercentile, sizeMultiplier: 0.8, slMultiplier: 0.9, tpMultiplier: 1.2 };
  } else if (hvRank > 80 || atrPercentile > 90) {
    return { state: 'extreme', hvRank, atrPercentile, sizeMultiplier: 0.5, slMultiplier: 1.4, tpMultiplier: 0.8 };
  } else if (hvRank > 60 || atrPercentile > 75) {
    return { state: 'expanded', hvRank, atrPercentile, sizeMultiplier: 0.75, slMultiplier: 1.2, tpMultiplier: 1.1 };
  } else {
    return { state: 'normal', hvRank, atrPercentile, sizeMultiplier: 1.0, slMultiplier: 1.0, tpMultiplier: 1.0 };
  }
}
```

---

## 5. GARCH-модели для прогнозирования волатильности

### Что такое GARCH и почему это важно

GARCH (Generalized Autoregressive Conditional Heteroskedasticity) — семейство моделей, которые формализуют ключевое наблюдение: **волатильность кластеризуется**. Периоды высокой волатильности чередуются с периодами низкой. Это означает, что прошлая волатильность предсказывает будущую.

Стандартная модель GARCH(1,1) (Hull):

```
σ²_t = ω + α × ε²_{t-1} + β × σ²_{t-1}

где:
  σ²_t    = прогнозируемая дисперсия на момент t
  ε²_{t-1} = квадрат прошлого "шока" (realized return²)
  σ²_{t-1} = прошлая дисперсия
  ω, α, β  = параметры (ω > 0, α+β < 1)
  
Типичные параметры для BTC:
  α ≈ 0.10-0.15 (вес свежей информации)
  β ≈ 0.80-0.85 (персистентность волатильности)
  α + β ≈ 0.95 (высокая персистентность, медленное затухание)
```

**Для BTC:** Академические исследования (MDPI 2021, Springer 2025) показывают, что EGARCH(1,1) и TGARCH лучше стандартного GARCH для крипто, потому что они учитывают **leverage effect** — негативные шоки создают более высокую волатильность, чем позитивные той же величины.

### Практическое применение без полной реализации GARCH

Для нашего бота не нужна полная GARCH реализация. Достаточно аппроксимации:

```typescript
// Simplified GARCH-like volatility estimate
// Используем экспоненциально взвешенную волатильность (EWMA)
// Это упрощённый аналог GARCH(1,1) с β=lambda

function calcEWMAVolatility(returns: number[], lambda = 0.94): number {
  // lambda = 0.94 — стандарт RiskMetrics (JP Morgan)
  // Высокий lambda = медленно забываем прошлое = "смотрим в даль"
  let variance = Math.pow(returns[0], 2);
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * Math.pow(returns[i], 2);
  }
  return Math.sqrt(variance * 252) * 100; // аннуализированная %
}

// GARCH-based signal: резкий рост EWMA vol → расширение режима
function isVolatilityExpanding(returns: number[]): boolean {
  const ewmaShort = calcEWMAVolatility(returns.slice(-10), 0.9);  // fast
  const ewmaLong  = calcEWMAVolatility(returns.slice(-30), 0.97); // slow
  return ewmaShort > ewmaLong * 1.3; // vol растёт быстрее нормы
}
```

**Ключевые GARCH-инсайты для торговли:**
1. После большого движения (ε² большой) → σ_t+1 растёт → SL нужно шире
2. Долгий период низкой vol (β × σ малый) → "пружина сжата" → ожидать взрыва
3. α + β близко к 1 в крипто → vol very persistent → режим держится неделями, не часами

---

## 6. Волатильность Mean-Reversion — следствия для position sizing

### Суть mean-reversion волатильности (Natenberg)

Ключевой принцип Natenberg: волатильность mean-reverting по природе. Она не может расти вечно. Экстремально высокая IV всегда возвращается к норме. Это имеет прямые следствия:

**При экстремально высокой IV (HV_Rank > 80%):**
- Текущие ATR-значения преувеличены
- SL, рассчитанный как ATR × multiplier, становится слишком широким
- Позиция с риском 1% при нормальной vol на самом деле рискует 1.5-2% при высокой vol
- **Вывод:** Размер позиции нужно уменьшить, чтобы сохранить фиксированный денежный риск

**При экстремально низкой IV (HV_Rank < 20%):**
- ATR недооценивает реальный потенциал движения
- SL слишком тесный — будет выбивать на "шуме" перед реальным движением
- Compression перед explosion: лучшие сетапы, но непредсказуемое направление
- **Вывод:** Чуть шире SL + уменьшить размер позиции пропорционально

### Volatility Targeting — метод квантовых фондов

Топ-кванты не блокируют торговлю при высокой vol — они **масштабируют размер**:

```
target_vol = 20%  // целевая аннуализированная волатильность
realized_vol = текущая EWMA-vol (например, 40%)

size_multiplier = target_vol / realized_vol = 20% / 40% = 0.5x

При нормальной vol (20%): size = 1.0x (полный размер)
При высокой vol (40%):    size = 0.5x (половина)
При низкой vol (10%):     size = 2.0x (НО с кепом, максимум 1.5x)
```

**Адаптация для нашей системы (с HyroTrader compliance):**

```typescript
function calcVolAdjustedSize(
  baseMarginPct: number,    // 22.5% от баланса
  hvRank: number,           // 0-100
  startBalance: number
): number {
  let multiplier: number;

  if (hvRank < 20) {
    multiplier = 0.8;  // compressed — немного меньше (широкий SL)
  } else if (hvRank < 40) {
    multiplier = 1.0;  // нормальный
  } else if (hvRank < 60) {
    multiplier = 0.9;  // немного повышена
  } else if (hvRank < 80) {
    multiplier = 0.75; // expanded
  } else {
    multiplier = 0.5;  // extreme
  }

  // HyroTrader cap: максимум 22.5% от startBalance (уже задан baseMarginPct)
  // При multiplier уменьшаем, никогда не превышаем базовый лимит
  return baseMarginPct * multiplier;
}
```

---

## 7. DVOL — Крипто-аналог VIX

### Что такое DVOL (Deribit)

DVOL — это 30-дневный индекс подразумеваемой волатильности BTC от Deribit, построенный по методологии, аналогичной VIX в традиционных рынках. Он агрегирует цены опционов разных страйков для расчёта ожидаемой волатильности на 30 дней вперёд.

**Доступ:** Публичный WebSocket Deribit без авторизации:
```
wss://www.deribit.com/ws/api/v2
Subscription: { "method": "public/subscribe", "params": { "channels": ["deribit_volatility_index.btc_usd"] } }
```

**Интерпретация значений (Deribit):**

| DVOL | Режим | Ожидаемое дневное движение |
|------|-------|--------------------------|
| < 35 | Compressed / низкая тревога | < 1.75% |
| 35-50 | Нормальный | 1.75-2.5% |
| 50-70 | Повышенный | 2.5-3.5% |
| 70-90 | Высокий / страх | 3.5-4.5% |
| > 90 | Экстремальный | > 4.5% |

**Правило из практики:** DVOL / 20 = ожидаемое дневное движение BTC в процентах.

### DVOL как trading signal

```
DVOL < 35 (compressed):
  → Ожидать взрывного движения. Снизить confluence threshold.
  → НО: SL нужен чуть шире — когда взрыв случится, шум будет.

DVOL 35-70 (нормальный):
  → Стандартные параметры. SMC работает лучше всего.

DVOL резко растёт (+15 за 3 дня):
  → Vol-expansion. Reduce size, widen SL.
  → Не входить против нового импульса (trending mode).

DVOL резко падает (-15 за 3 дня):
  → Vol-contraction after spike. Mean reversion imminent.
  → Range-bound: OB сетапы в диапазоне, TP ≤ 1.5R.
```

**Caveat:** DVOL доступен только с 2021 года — бэктест только с этой даты. Без исторических данных DVOL нельзя верифицировать его сигнальную силу исторически. Аппроксимация через HV_Rank работает на любом историческом периоде.

---

## 8. Хеджирование маркет-мейкеров опционов — влияние на цену спота и перпетуальных фьючерсов

### Как работает delta hedging (Natenberg, Hull)

Когда маркет-мейкер продаёт колл-опцион, он принимает на себя риск роста цены. Для нейтрализации он покупает базовый актив (или фьючерс) пропорционально дельте:

```
Delta = ∂V/∂S = изменение стоимости опциона при изменении цены на $1

Пример:
  MM продал 100 колл-опционов BTC delta=0.5 страйк $100k
  MM должен купить 50 BTC в спот/фьючерс (hedge)
  
  Если BTC растёт: delta → 0.7, нужно докупить ещё 20 BTC
  Если BTC падает: delta → 0.3, нужно продать 20 BTC
```

**Gamma hedging** (вторая производная) — как MM должны корректировать хедж при изменении цены:
- **Long gamma (MM купил опцион):** При росте цены MM продаёт, при падении покупает. **Стабилизирует цену.**
- **Short gamma (MM продал опцион):** При росте цены MM покупает, при падении продаёт. **Усиливает движение.**

### GEX (Gamma Exposure) и его влияние

Glassnode и MenthorQ рассчитывают агрегированный GEX биткоина:

```
Положительный GEX (net long gamma у MM):
  → Маркет-мейкеры "стабилизируют" цену
  → Цена "залипает" около страйков с большим OI
  → Диапазонный рынок, мелкие движения, много шума
  → SMC сетапы: работают хуже (много ложных пробоев)

Отрицательный GEX (net short gamma у MM):
  → Маркет-мейкеры "усиливают" движение
  → Бид-аск расширяется, цена "скользкая"
  → Trending рынок, большие свечи
  → SMC сетапы: работают лучше (пробои настоящие)
```

**Практический вывод:** При крупных опционных экспирациях (последняя пятница месяца) маркет-мейкеры активно перебалансируют дельту → аномальные потоки в перпетуальных фьючерсах (через базис BTC/USDT). Funding rate в эти дни может резко меняться.

### Влияние на funding rate

Delta hedging маркет-мейкеров происходит через перпетуальные фьючерсы (не только спот):
- Крупная покупка перпетуалов для хеджа → funding rate растёт (лонги платят шортам)
- Крупная продажа перпетуалов → funding rate падает или уходит в отрицательную зону

```
Funding rate > +0.05%/8h = перегрев лонгов → шорты привлекательны
Funding rate < -0.02%/8h = перегрев шортов → лонги привлекательны
Экстремальный funding > +0.1%/8h = near-term reversal вероятен
```

---

## 9. Gamma Exposure — как это влияет на прайс-экшн

### Концепция "Gamma Wall" и "Pin Strike"

Вблизи крупных опционных страйков с большим OI формируются зоны интенсивного delta hedging:

**Gamma Wall (позитивный GEX на страйке):**
- Маркет-мейкеры стараются держать цену "под" этим страйком
- Механизм: если цена приближается к страйку снизу, MM начинают продавать → сопротивление
- В нашей стратегии: **крупный страйк OI = дополнительное сопротивление = зона для шорта или TP**

**Gamma Pin (цена "залипает"):**
- Вблизи экспирации цена часто "залипает" на страйке максимального OI
- Это увеличивает вероятность ложных пробоев наших OB зон
- В пятницы экспирации (weekly options) торговать осторожнее, снизить confluence threshold

**Negative Gamma Zone (усиление движений):**
```
Зона: цена ниже крупного пут-страйка
Механизм: MM short gamma → при падении цены MM тоже продаёт → cascading
Для нас: если цена входит в зону Negative GEX → тренд усиливается
Действие: trailing stop предпочтителен над фиксированным TP
```

---

## 10. Max Pain Theory — следствия опционных экспираций

### Механизм Max Pain (Hull)

Max Pain Price — это уровень цены, при котором суммарные выплаты по всем опционам (коллам + путам) минимальны, то есть максимальный убыток несут **покупатели** опционов.

Механизм влияния:
1. Продавцы опционов (MM) выигрывают, когда опционы истекают бесполезными
2. Перед экспирацией MM через delta hedging "затягивают" цену к max pain
3. Эффект наиболее выражен за 2-3 дня до экспирации

**Криптовалютный контекст:** Эффект реален, но ограничен. Рынок крипто-опционов (~$15-20B OI) значительно меньше спот + перп рынков (~$500B+ daily volume). Pinning происходит, но не гарантирован.

**Расписание экспираций BTC options:**
- Еженедельно: каждую пятницу 08:00 UTC (Deribit)
- Ежемесячно: последняя пятница месяца 08:00 UTC (крупнее)
- Квартально: последняя пятница квартала 08:00 UTC (самые крупные)

```
Практическое правило:
  Среда-четверг перед крупной экспирацией:
    → Max Pain эффект усиливается
    → Ложные пробои более вероятны
    → ATR может сжиматься (диапазонный рынок)
    → Снизить агрессивность лонгов/шортов против тренда к max pain

  В день экспирации (пятница до 08:00 UTC):
    → Аномальные потоки → не открывать позиций 06:00-10:00 UTC
```

---

## 11. Volatility-Adjusted Position Sizing — практическая имплементация

### Принцип (Natenberg: all about expected value)

Natenberg постоянно возвращается к одному принципу: **размер позиции должен отражать реальный риск, а не номинальный**. При высокой волатильности "1 ATR" содержит больше реального риска, чем при низкой.

Наш текущий подход: `SL = OB.low - (ATR × slAtrMultiplier)`. Это уже учитывает волатильность, но только одну точку во времени. ATR за последние 14 баров не отражает режим.

### Полная формула (три уровня адаптации)

```
Уровень 1 — SL ширина (уже реализован):
  SL = entry - ATR(14) × slAtrMultiplier

Уровень 2 — SL multiplier корректируется по режиму:
  effective_multiplier = slAtrMultiplier × regime.slMultiplier
  
  Compressed:  1.5 × 0.9  = 1.35 (немного тесней — vol низкая, шум меньше)
  Normal:      1.5 × 1.0  = 1.50 (базовый)
  Expanded:    1.5 × 1.2  = 1.80 (шире — vol высокая, шум больше)
  Extreme:     1.5 × 1.4  = 2.10 (очень широкий — защита от gaps)

Уровень 3 — размер позиции корректируется по режиму:
  margin = baseMarginPct × regime.sizeMultiplier × startBalance
  
  Compressed:  22.5% × 0.8 = 18% margin
  Normal:      22.5% × 1.0 = 22.5% margin
  Expanded:    22.5% × 0.75 = 16.9% margin
  Extreme:     22.5% × 0.5 = 11.25% margin
  
  ВСЕГДА ≤ 22.5% (HyroTrader compliance)
```

### TP адаптация к волатильному режиму

```
Compressed режим (HV_Rank < 20):
  - Рынок скоро взорвётся → trailing stop важнее фиксированного TP
  - TP1 = 1.5R (захватить движение начала)
  - Trailing multiplier = 1.5 ATR (тесный — не упустить трендовое движение)

Normal режим:
  - TP1 = 2.0R, trailing = 0.75 ATR (текущая конфигурация)

Expanded режим (HV_Rank 60-80):
  - Большие движения нормальны → можно целить выше
  - TP1 = 2.5R, trailing = 1.0 ATR (дать движению больше пространства)

Extreme режим (HV_Rank > 80):
  - Движения большие, но реверсии резкие
  - TP1 = 1.5R (фиксируй прибыль быстро), trailing = 0.5 ATR (тесный)
  - Или вообще не торгуй
```

---

## 12. Использование Implied Vol для SL/TP калибровки

### Теоретическая основа (Natenberg)

IV дает нам **теоретически обоснованный** диапазон движений через концепцию вероятностных полос:

```
1-sigma move (68% вероятность) за период T:
  Move_1σ = price × IV × sqrt(T/252)

Для 15M таймфрейма (T = 1/96 торгового дня, 15M из 6.5h → криптовалюта торгует 24/7):
  T = 15 / (60 * 24) = 0.01042 дня

  При DVOL = 60%:
  Move_1σ = price × 0.60 × sqrt(0.01042) = price × 0.60 × 0.102 = price × 0.061 = 0.61%

  Это означает: 68% 15M свечей не выйдут за ±0.61% от начальной цены
  
  Для SL размещения вне "шума" нужно ≥ 2σ = 1.22% от цены при текущем DVOL
```

**Практическое правило:**

```
Min SL distance = price × (DVOL / 100) × sqrt(15 / 1440) × 2.0
// 2.0 = 2-sigma, вне нормального шума

Пример при DVOL = 60, цена BTC = $90,000:
  Min SL = 90000 × 0.60 × sqrt(0.01042) × 2.0
  Min SL = 90000 × 0.60 × 0.102 × 2.0
  Min SL = 90000 × 0.122 = $1,102

  То есть SL должен быть не теснее $1,102 от входа при данной волатильности
```

### Сравнение с нашим ATR-подходом

Текущий подход: `SL = ATR(14, 15M) × 2.0`

При DVOL = 60% и цене $90,000:
- ATR(14, 15M) ≈ $500-600 (примерно 0.55-0.67% от цены)
- SL = ATR × 2 ≈ $1,000-1,200

Это почти совпадает с IV-методом! ATR(14) на 15M — это хорошая аппроксимация σ за 15 минут. **Наш текущий подход уже близок к теоретически обоснованному.** Улучшение: динамически подстраивать `slAtrMultiplier` на основе режима, а не держать фиксированный 2.0.

### Адаптивный SL multiplier

```typescript
function getAdaptiveSlMultiplier(
  baseMultiplier: number,
  hvRank: number,
  dvolLevel?: number // если доступен
): number {
  let regimeAdjust: number;

  if (dvolLevel !== undefined) {
    // Использовать DVOL если доступен
    if (dvolLevel < 35) regimeAdjust = 0.85;      // compressed
    else if (dvolLevel < 50) regimeAdjust = 1.0;  // normal
    else if (dvolLevel < 70) regimeAdjust = 1.15; // elevated
    else if (dvolLevel < 90) regimeAdjust = 1.30; // high
    else regimeAdjust = 1.5;                      // extreme
  } else {
    // Fallback на HV Rank
    if (hvRank < 20) regimeAdjust = 0.85;
    else if (hvRank < 50) regimeAdjust = 1.0;
    else if (hvRank < 70) regimeAdjust = 1.15;
    else if (hvRank < 85) regimeAdjust = 1.30;
    else regimeAdjust = 1.50;
  }

  // Итоговый multiplier в диапазоне [1.2, 3.0]
  return Math.min(3.0, Math.max(1.2, baseMultiplier * regimeAdjust));
}
```

---

## Практические рекомендации для бота

### Приоритет 1 — HV Rank (уже частично запланирован)

Реализовать `calcHVRank(candles, 20, 252)` в `indicators/classic/` и передавать в `risk.ts`.
Это даёт **режимное знание** без внешних зависимостей. Работает на любом историческом периоде.

```typescript
// В risk.ts
const hvRank = calcHVRank(candles15m, 252);
const regime = detectRegime(hvRank);
const adjustedMargin = baseMargin * regime.sizeMultiplier;
const adjustedSlMultiplier = config.slAtrMultiplier * regime.slMultiplier;
```

### Приоритет 2 — DVOL WebSocket (внешняя зависимость)

Подключить `wss://www.deribit.com/ws/api/v2` → `deribit_volatility_index.btc_usd`.
DVOL обновляется каждые 5 минут. Хранить последнее значение в Redis.

**Caveat:** DVOL недоступен для бэктеста (история с 2021). Использовать как дополнительный сигнал поверх HV Rank, не как основной.

### Приоритет 3 — Экспирационный календарь

Добавить в `sessionFilterUTC` исключение: пятница 06:00-10:00 UTC при крупных экспирациях.
Это можно детектировать по открытому интересу опционов через Deribit публичный API.

### Приоритет 4 — Funding Rate как vol-сигнал

Уже есть фильтр `funding rate > 0.1%`. Усилить: добавить мониторинг динамики funding:
- Funding rate резко растёт → лонги перегреты → повышать confluence threshold для лонгов
- Funding rate уходит в минус → шорты перегреты → вето на шорты

### Параметры для BTCUSDT.json (рекомендуемые добавления)

```json
{
  "volatilityRegime": {
    "enabled": true,
    "hvRankLookback": 252,
    "compressedThreshold": 20,
    "expandedThreshold": 65,
    "extremeThreshold": 82,
    "sizeMultipliers": {
      "compressed": 0.80,
      "normal": 1.00,
      "expanded": 0.75,
      "extreme": 0.50
    },
    "slMultipliers": {
      "compressed": 0.90,
      "normal": 1.00,
      "expanded": 1.20,
      "extreme": 1.40
    }
  },
  "dvolIntegration": {
    "enabled": false,
    "compressedThreshold": 35,
    "extremeThreshold": 80
  }
}
```

---

## Ключевые выводы

1. **ATR — хорошая аппроксимация волатильности**, но статичный множитель 2.0 одинаково неоптимален во всех режимах. Динамический `slAtrMultiplier` на основе HV Rank — приоритетное улучшение.

2. **HV Rank > DVOL для бэктеста**: DVOL доступен с 2021, HV Rank вычисляется на любых данных. Начинать с HV Rank, DVOL добавить позже как подтверждение.

3. **Volatility clustering (GARCH-эффект)**: Расширенный режим держится неделями. Не возвращаться к полному размеру сразу после spike vol — ждать 5+ дней снижения HV Rank.

4. **Gamma и опционные экспирации**: Пятницы (особенно последняя в месяце) — аномальные потоки. Добавить временной фильтр 06:00-10:00 UTC в пятницу как "low confidence" период.

5. **Volatility mean-reversion**: При HV_Rank > 80 — уменьшить размер до 0.5x, расширить SL. При HV_Rank < 20 — уменьшить размер до 0.8x, немного расширить SL (готовиться к взрыву).

6. **VRP (vol risk premium)**: Исторически IV > RV для BTC (+8-15pp). Это означает, что рынок хронически "переплачивает" за волатильность. Не доверять экстремальным ожиданиям движения в опционных ценах — реализованная vol будет ниже.

7. **Скью опционного рынка** — бесплатный sentiment indicator. Положительный 25RR = бычий bias, отрицательный = медвежий. Использовать для фильтрации направления сигналов.

---

*Следующий шаг для Calibrator/Developer:* Реализовать `calcHVRank` в `indicators/classic/hv-rank.ts` и интегрировать в `risk.ts` через поле `volatilityRegime` в BTCUSDT.json. Верифицировать через бэктест: сравнить статичный slAtrMultiplier=2.0 vs динамический по HV Rank за последний 1Y период.
