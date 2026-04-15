# Momentum Trading: Clenow, Gray & Pair Selection for Multi-Pair Crypto Portfolio

**Date:** 2026-04-06
**Sources:**
- [Andreas Clenow — Stocks on the Move](https://www.followingthetrend.com/stocks-on-the-move/)
- [Andreas Clenow — Trading Evolved](https://www.followingthetrend.com/trading-evolved/)
- [Quantitative Momentum — Alpha Architect PDF](https://alphaarchitect.com/wp-content/uploads/2021/08/The_Quantitative_Momentum_Investing_Philosophy.pdf)
- [Exponential Regression Momentum — Quant Investing](https://www.quant-investing.com/blog/how-to-find-stocks-on-the-move-with-a-better-momentum-indicator-exponential-regression)
- [Teddy Koker — Stocks on the Move Python](https://teddykoker.com/2019/05/momentum-strategy-from-stocks-on-the-move-in-python/)
- [Frog in the Pan Momentum — Alpha Architect](https://alphaarchitect.com/frog-in-the-pan-identifying-the-highest-quality-momentum-stocks/)
- [Crypto Momentum Research — Springer 2025](https://link.springer.com/article/10.1007/s11408-025-00474-9)
- [Time-Series vs Cross-Sectional Momentum in Crypto — SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565)
- [Risk-Managed Momentum Crypto — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1544612325011377)
- [Dual Momentum — Optimal Momentum](https://www.optimalmomentum.com)
- [Clenow Momentum Implementation — QuantConnect](https://www.quantconnect.com/forum/discussion/10493/andreas-clenow-momentum-strategy-using-framework-from-stocks-on-the-move-book/)

---

## 1. Контекст: зачем нам momentum для отбора пар

Наш бот торгует одновременно на нескольких USDT Perpetual парах (цель: 5-8 пар).
Проблема: какие пары активны прямо сейчас? Какие стоит добавить, какие отключить?

Текущий подход — статичный список (BTC, ETH, SOL, ...). Проблема со статичным списком:
- В медвежьем рынке большинство алтов дают ложные сетапы
- В альт-сезон можно упустить пары с наивысшим движением
- Некоторые пары "засыпают" на месяцы, генерируя шумные сигналы

Momentum-based pair selection решает это: динамически ранжируем пары по силе тренда
и торгуем только топ-N из нашего вселенной (universe). Это прямое применение методологии
Clenow + Gray к нашему конкретному кейсу.

---

## 2. Clenow — "Stocks on the Move" и "Trading Evolved"

### Ключевая идея

Clenow предлагает измерять momentum не простым процентным изменением цены, а через
**экспоненциальную регрессию**, которая одновременно оценивает:

1. **Скорость движения** (slope регрессии = угол наклона линии тренда)
2. **Качество движения** (R² = насколько плотно цена следует этой линии)

Произведение этих двух компонентов даёт **Adjusted Momentum Score**:

```
momentum_score = annualized_slope × R²
```

### Формула вычисления (точная)

1. Берём закрытия за последние N дней (Clenow использует 90 дней)
2. Делаем линейную регрессию log(price) на time_index
3. Коэффициент slope — это дневной логарифмический прирост
4. Аннуализируем: `annualized_slope = (1 + slope)^252 - 1`
5. Вычисляем R² регрессии
6. Итог: `score = annualized_slope × R²`

Пример на Python:
```python
import numpy as np
from scipy import stats

def clenow_momentum_score(closes: list[float], period: int = 90) -> float:
    """
    Clenow Adjusted Momentum Score.
    closes: массив цен закрытия (минимум period+1 значений)
    """
    prices = closes[-period:]
    x = np.arange(len(prices))
    log_prices = np.log(prices)

    slope, intercept, r_value, p_value, std_err = stats.linregress(x, log_prices)

    annualized_slope = (1 + slope) ** 252 - 1  # для дневных данных
    r_squared = r_value ** 2

    return annualized_slope * r_squared
```

Для адаптации под часовые / 4H свечи:
```python
# Для 4H свечей: в году ~2190 4H свечей
annualized_slope = (1 + slope) ** 2190 - 1

# Для 1H свечей: в году ~8760 1H свечей
annualized_slope = (1 + slope) ** 8760 - 1
```

### Почему R² критически важен

Пример: два актива оба выросли на 50% за 90 дней.
- Актив A: рос плавно, почти по прямой линии (R² = 0.95)
- Актив B: -30% → +80% (рост с огромным откатом, R² = 0.30)

Простой 90-дневный return = одинаковый (50%), но:
- Score A = 0.50 × 0.95 = **0.475**
- Score B = 0.50 × 0.30 = **0.150**

Актив A — реальный тренд. Актив B — случайное восстановление. R² отфильтровывает шум.

### Position Sizing через ATR (Clenow)

Clenow использует volatility-adjusted sizing:
```
position_size = (account_value × risk_per_position) / ATR(20)
```

Где `risk_per_position` = 0.001 (10 basis points) от размера портфеля.

Это гарантирует, что каждая позиция имеет **одинаковое dollar risk** независимо от
волатильности конкретного актива. Высоковолатильный актив получает меньший размер позиции.

**Применение к нашему боту:**
Наш текущий подход — 4% margin × 5x leverage на пару. Это фиксированный размер.
Clenow предлагает масштабировать этот размер обратно пропорционально ATR пары —
пары с высоким ATR получают меньший вес.

---

## 3. "Trading Evolved" — Systematic Momentum для фьючерсов

В "Trading Evolved" Clenow переносит momentum методологию на фьючерсные рынки.

### Ключевые отличия от акций

1. **Нет "вселенной акций"** — фьючерсы сами по себе диверсифицированы по классам
2. **Continuous contracts** — фьючерсы роллируются (для крипты perpetual — нет этой проблемы)
3. **Position sizing** — через Target Risk (% от NAV) делённый на ATR × price

### Фильтр тренда (Bear Market Filter)

Clenow обязательно использует фильтр: не торговать в противоположном направлении.

Для акций: не покупать если S&P 500 < 200-day SMA.
Для фьючерсов / крипты: не покупать актив если он сам < своей 200-day SMA.

Это **абсолютный momentum фильтр** — работает как kill switch при смене режима.

### Rebalancing

- Акции: еженедельно (по средам)
- Фьючерсы: менее часто (месячно, но мониторинг ежедневный)
- Крипта 24/7: исследования 2025 подтверждают еженедельный ребаланс оптимален

---

## 4. Wes Gray — "Quantitative Momentum"

### Основная концепция

Gray разбивает momentum на два слоя:

1. **Intermediate momentum**: 12-1 (12 месяцев return, пропуская последний месяц — reverse).
   Этот период работает лучше всего — объяснение: поведенческое underreaction инвесторов.

2. **Path quality (Frog in the Pan)**: среди акций с одинаковым 12-1 momentum,
   предпочитаем те, у которых это движение было **стабильным**, а не резким скачком.

### "Frog in the Pan" — ключевая идея

Исследование Da, Gurun, Warachka (Review of Financial Studies 2014): инвесторы
не замечают постепенных изменений, но реагируют на резкие. Следствие:

- **Continuous momentum** (маленькие шаги в одну сторону) → **сильнее и устойчивее**
- **Discrete momentum** (один резкий скачок) → **быстро разворачивается**

Практическое измерение:
```
information_discreteness = sign(return_12_1) × (%days_positive - %days_negative)
```

Для long momentum: чем больше дней было с положительным закрытием, тем лучше.

**Применение к крипте:** В криптовых перпетуалах особенно важно, потому что
часто наблюдаются спайки (листинги, хайп-события). Актив мог вырасти на 100%
за 3 дня и потом стагнировать — это плохой momentum. Нам нужны ровные тренды.

### Поведенческая основа

Gray объясняет, почему momentum работает:
- **Value** работает из-за overreaction (инвесторы слишком резко переоценивают)
- **Momentum** работает из-за underreaction (инвесторы слишком медленно обновляют взгляды)

Для крипты оба эффекта усилены: рынок более эмоциональный, меньше институционалов
которые "арбитражируют" неэффективности.

---

## 5. Dual Momentum (Antonacci) — Два слоя фильтрации

Gary Antonacci (книга "Dual Momentum Investing") вводит двухуровневую систему:

### Уровень 1: Absolute Momentum (Time-Series)
```
absolute_momentum = return(asset, lookback) > return(cash/risk_free, lookback)
```
Если актив вырос меньше чем T-bill за те же N месяцев → отказываемся от него.
Это **bear market filter**: работает даже если лучший актив в твоей вселенной — всё равно убыточный.

### Уровень 2: Relative Momentum (Cross-Sectional)
```
relative_momentum = rank(asset) by return(lookback) relative to all assets
```
Из активов прошедших absolute filter → выбираем топ-N по относительному ранку.

### Dual Momentum результат

Комбинация двух слоёв:
- Absolute momentum обрезает drawdown в медвежьих рынках (убирает всю вселенную)
- Relative momentum выбирает лучший актив когда рынок растёт

Исторические данные (акции 1974-2013): Dual Momentum CAGR 17.4% vs S&P 13.8%,
при drawdown -17.8% vs -50.9%.

---

## 6. Cross-Sectional vs Time-Series Momentum в крипте

Академические исследования 2024-2025 (Han, Kang, Ryu — SSRN 2024):

| Тип | Принцип | Работает в крипте? |
|-----|---------|-------------------|
| **Time-Series** | Актив растёт → продолжает расти | **Сильно** — тренды устойчивы |
| **Cross-Sectional** | Лучший среди пиров → продолжает лидировать | **Умеренно** — полезен для отбора |

**Ключевые находки:**
- Time-series momentum в крипте выражен сильнее чем в акциях
- Cross-sectional momentum слабее чем в акциях, но статистически значим
- Комбинирование обоих типов даёт лучший Sharpe
- Оптимальный lookback period для крипты: 14-56 дней (не 12 месяцев как в акциях!)
- Еженедельный ребаланс превосходит месячный

**Про momentum crashes в крипте:**
Momentum стратегии в крипте подвержены резким crashes. Решение — volatility management:
уменьшать позицию когда реализованная vol вырастает выше нормы.

---

## 7. Momentum Crashes — Как Обнаружить и Избежать

### Типичный сценарий краша

1. Сильный uptrend (momentum отличный)
2. Резкий разворот (bear market)
3. Momentum стратегии в этот момент **максимально long** (они подобрали лучшие активы бычьего рынка)
4. Все активы с топ-momentum падают одновременно → огромный drawdown

### Защитные фильтры

**Фильтр 1: 200-day SMA (Absolute Momentum)**
```
if price < SMA(200): skip this asset (no new longs)
```
Исследования показывают: этот фильтр убирает ~70% momentum crashes.

**Фильтр 2: Volatility Scaling**
```
target_vol = 0.15  # целевая аннуализированная волатильность
realized_vol = std(daily_returns, 20) * sqrt(252)
position_multiplier = target_vol / realized_vol
position_size *= min(position_multiplier, 2.0)  # кэп 2x
```

**Фильтр 3: Portfolio Correlation Brake**
Если корреляция всех активов в портфеле выросла до 0.90+ → уменьшить размер всего портфеля.
Высокая корреляция = системный стресс = momentum crash risk.

**Фильтр 4: Funding Rate (специфика крипта-перпов)**
Funding rate > 0.1%/8h на большинстве пар одновременно → перегрев рынка → снизить leverage.

---

## 8. Адаптация Momentum для Крипто-Перпетуалов

### Ключевые отличия крипты от акций

| Параметр | Акции (Clenow) | Крипта 24/7 |
|---------|---------------|-------------|
| Торговые дни | 252/год | 365/год |
| Lookback | 90 дней | 14-56 дней (режим меняется быстрее) |
| Rebalance | Еженедельно | Еженедельно (подтверждено исследованиями 2025) |
| Bear filter | SMA(200) дней | SMA(200) часовых свечей (≈8 дней) ИЛИ SMA(50) дней |
| R² период | 90 дней | 30-45 дней (рыночные режимы короче) |
| Аннуализация | × 252 | × 365 |

### Рекомендуемый lookback для нашего бота

Исследование 2025 (ScienceDirect): risk-managed momentum улучшает avg weekly return
с 3.18% до 3.47% и Sharpe с 1.12 до 1.42. Оптимальный lookback: 2-8 недель.

**Наш выбор: 21-day (= 3 недели) для основного score + 63-day (9 недель) для подтверждения.**

---

## 9. Практическая Система Отбора Пар для Нашего Бота

### Universe (вселенная пар)

Стартовый список (основан на нашем предыдущем исследовании кандидатов):
```
ACTIVE_UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LTCUSDT', 'LINKUSDT',
  'DOTUSDT', 'SUIUSDT', 'NEARUSDT', 'ARBUSDT', '1000PEPEUSDT'
]
```

TON — вето (корреляция -0.49, анти-паттерн для BTC-led стратегии).

### Алгоритм ранжирования (еженедельно, в воскресенье)

```typescript
interface MomentumScore {
  symbol: string;
  score21d: number;      // Clenow score за 21 день
  score63d: number;      // Clenow score за 63 дня
  compositeScore: number; // взвешенный итог
  aboveMA50: boolean;    // absolute momentum filter
  pathQuality: number;   // % дней с движением в направлении тренда
  volumeRatio: number;   // avg volume 21d vs avg volume 90d
}

function calcMomentumScore(dailyCloses: number[]): MomentumScore {
  // 1. Clenow score для двух периодов
  const score21 = clenowScore(dailyCloses, 21);
  const score63 = clenowScore(dailyCloses, 63);

  // 2. Composite: 60% краткосрочный + 40% среднесрочный
  const composite = score21 * 0.6 + score63 * 0.4;

  // 3. Absolute momentum filter: цена выше SMA(50)?
  const sma50 = mean(dailyCloses.slice(-50));
  const aboveMA50 = dailyCloses[dailyCloses.length - 1] > sma50;

  // 4. Path quality (Frog in the Pan)
  const last21 = dailyCloses.slice(-22);
  const dailyReturns = last21.slice(1).map((p, i) => p > last21[i] ? 1 : -1);
  const trendSign = composite > 0 ? 1 : -1;
  const alignedDays = dailyReturns.filter(r => r === trendSign).length;
  const pathQuality = alignedDays / 21;

  return { score21, score63, composite, aboveMA50, pathQuality, ... };
}
```

### Фильтрация и выбор топ-N

```typescript
function selectActivePairs(
  scores: MomentumScore[],
  maxPairs: number = 6
): string[] {

  // 1. Absolute momentum filter: только активы выше SMA(50)
  const filtered = scores.filter(s => s.aboveMA50);

  // 2. Path quality filter: минимум 55% дней в направлении тренда
  const qualityFiltered = filtered.filter(s => s.pathQuality >= 0.55);

  // 3. Volume filter: нет деградации объёма
  const volumeFiltered = qualityFiltered.filter(s => s.volumeRatio >= 0.7);

  // 4. Rank by composite score
  const ranked = volumeFiltered.sort((a, b) => b.compositeScore - a.compositeScore);

  // 5. Берём топ-N
  return ranked.slice(0, maxPairs).map(s => s.symbol);
}
```

### Volatility-Adjusted Position Sizing (Clenow-style)

Вместо фиксированных 4% margin на все пары:

```typescript
function calcVolAdjustedPositionPct(
  atr20: number,          // ATR(20) дневных свечей
  price: number,
  baseRiskPct: number = 0.001,  // 10 basis points риска на пару
  maxMarginPct: number = 0.06   // кэп 6% margin
): number {
  // Vol-adjusted size в % от депозита
  const atrPct = atr20 / price;
  const rawSize = baseRiskPct / atrPct;

  // Кэп: не больше 6%, не меньше 1%
  return Math.min(Math.max(rawSize, 0.01), maxMarginPct);
}
```

Это означает: BTC (ATR ~1.5%) получает меньший размер, чем LINK (ATR ~3%).
Каждая пара вносит **одинаковое dollar risk** в портфель.

---

## 10. Sector Rotation через Momentum — Специфика Крипты

Clenow применяет sector rotation к акциям (лучший сектор → ротируем туда капитал).
В крипте аналог — **нарративная ротация**:

| Крипто-нарратив | Пары | Признак активации |
|----------------|------|-------------------|
| BTC доминация | BTC, LTC | BTC dominance растёт, altcoin season index < 25 |
| Layer 1 season | ETH, SOL, AVAX, ADA | ETH/BTC ratio растёт |
| DeFi season | LINK, UNI, AAVE | TVL метрики растут |
| Meme season | DOGE, PEPE | Социальные сигналы + объём |
| L2 season | ARB, OP | ETH gas растёт, L2 TVL растёт |

**Momentum score автоматически захватывает эти ротации** — не нужно вручную кодировать
каждый нарратив. Пары из "горячего" нарратива будут иметь высокий score.

### Проблема BTC корреляции

Почти все крипто-пары коррелированы с BTC (0.7-0.95). Это создаёт
**иллюзию диверсификации**: портфель из 8 пар ведёт себя почти как 1 пара.

Решение (из нашего предыдущего исследования):
- Correlation-adjusted diversification: не выбирать пары с корреляцией > 0.90 одновременно
- Ограничение: максимум 2 пары из одного нарратива/сектора
- BTC всегда в портфеле (anchor) + остальные ранжируем относительно него

---

## 11. Combining Momentum with SMC Strategy

Наш текущий подход — SMC + confluence score на каждой паре независимо.
Momentum layer добавляет meta-уровень: **в какие пары вообще смотреть**.

### Двухуровневая архитектура

```
УРОВЕНЬ 1 (еженедельно): Momentum Screening
  ├── Calc Clenow score для всех пар в universe
  ├── Apply absolute momentum filter (SMA50)
  ├── Apply path quality filter
  ├── Select TOP-6 by composite score
  └── Update ACTIVE_PAIRS config

УРОВЕНЬ 2 (каждые 15M): SMC Entry Signal
  ├── Run SMC confluence scoring только для ACTIVE_PAIRS
  ├── score >= 70 → signal
  └── Execute with vol-adjusted position size
```

### Логика: momentum как pre-filter

- Торгуем SMC сетапы только в тех парах, где momentum подтверждает направление
- Long сетап на паре с отрицательным momentum score → сниженный вес или skip
- Short сетап на паре с сильным бычьим momentum → только при явном структурном сломе

Это решает проблему "ложных OB/FVG в боковике" — если пара не в тренде, её нет в ACTIVE_PAIRS.

---

## 12. Rebalancing Strategy

### Когда ребалансировать

Академические исследования крипты 2025 (Da, Han et al.): еженедельный ребаланс
оптимален для крипты. Дневной — слишком много транзакций, месячный — слишком медленно.

**Рекомендация: каждое воскресенье в 00:00 UTC.**

### Что делать при ребалансе

1. Пересчитать momentum scores для всего universe
2. Определить новый топ-6
3. Если пара выпала из топ-6:
   - Не открывать новых позиций на ней
   - Существующие позиции дать закрыться по SL/TP (не принудительно закрывать)
4. Если новая пара вошла в топ-6:
   - Начать мониторинг SMC сетапов на ней
5. Логировать ребаланс в Telegram

### Hysteresis (порог переключения)

Чтобы избежать лишней ротации (пара №6 и №7 постоянно меняются местами):

```typescript
const MINIMUM_RANK_IMPROVEMENT = 2;  // пара должна стать на 2 позиции выше чтобы вытеснить текущую
const MINIMUM_SCORE_IMPROVEMENT = 0.05;  // score должен быть на 5% лучше
```

---

## 13. Caveat: Momentum Timing Bias в Крипте

### Проблема выбора дня ребаланса

Исследование Han & Kang 2024: **день недели ребаланса нетривиально влияет на результаты**.
Это называется timing luck. Решение — усреднение:

```
composite_score = avg(
  score_calculated_last_monday,
  score_calculated_last_wednesday,
  score_calculated_last_friday
)
```

Вычислять score три раза в неделю и усреднять → убирает timing bias.

### Проблема short-term reversal

Momentum работает на горизонте 1-12 месяцев. На горизонте 1-5 дней обычно reversal.
Поэтому Gray использует "12-1" (12 месяцев минус последний месяц).

Для нашего 21-day score это значит: пропустить последние 3-5 дней при расчёте.

```typescript
// Пропускаем последние 5 дней (reversal зона)
const score21 = clenowScore(dailyCloses.slice(0, -5), 21);
```

---

## 14. Итоговые Рекомендации для Реализации

### Приоритет 1 (обязательно)

1. **Momentum screening модуль** (`src/indicators/momentum/screener.ts`)
   - Clenow score с периодами 21d + 63d
   - SMA(50) absolute momentum filter
   - Path quality (% aligned days)
   - Запуск каждое воскресенье 00:00 UTC

2. **Vol-adjusted position sizing** (`src/core/risk.ts`)
   - ATR(20) дневных свечей как знаменатель
   - Диапазон: 1%-6% margin per pair
   - BTC anchor: всегда в портфеле с фиксированным 4% базой

### Приоритет 2 (желательно)

3. **Dual momentum filter**
   - Absolute: не лонговать пары ниже SMA(50) дневных
   - Relative: топ-6 из ранжированного universe

4. **Correlation brake**
   - Если 5 из 6 активных пар имеют rolling correlation > 0.90 к BTC → урезать leverage до 3x

5. **Momentum-SMC alignment gate**
   - Long сетап возможен только если momentum score > 0 (пара в uptrend)
   - Short сетап возможен только если momentum score < 0

### Параметры для бэктеста

| Параметр | Стартовое значение | Диапазон поиска |
|---------|-------------------|-----------------|
| Lookback short | 21 дней | 14-35 |
| Lookback long | 63 дней | 42-90 |
| Composite weight (short) | 0.60 | 0.50-0.70 |
| SMA filter | 50 дней | 30-100 |
| Path quality threshold | 0.55 | 0.50-0.65 |
| Max pairs | 6 | 4-8 |
| Rebalance day | Воскресенье | Любой день недели |

---

## Источники

- [Clenow Momentum — Chris Chow implementation](https://chrischow.github.io/dataandstuff/2018-11-10-how-not-to-invest-clenow-momentum/)
- [Adjusted Slope formula — QuantConnect discussion](https://www.quantconnect.com/forum/discussion/695/adjusted-slope-exponential-slope-annualized-slope-r-squuared-adjusted-slope/)
- [Quant Investing — exponential regression explainer](https://www.quant-investing.com/blog/this-easy-to-use-adjusted-slope-momentum-strategy-performed-7-times-better-than-the-market)
- [TuringTrader — Clenow Stocks on the Move backtest](https://www.turingtrader.com/portfolios/clenow-stocks-on-the-move/)
- [Quantitative Momentum Philosophy — Alpha Architect](https://alphaarchitect.com/wp-content/uploads/2021/08/The_Quantitative_Momentum_Investing_Philosophy.pdf)
- [Novel Investor — Quantitative Momentum notes](https://novelinvestor.com/notes/quantitative-momentum-by-wesley-gray-jack-vogel/)
- [Dual Momentum strategy — QuantifiedStrategies](https://www.quantifiedstrategies.com/dual-momentum-trading-strategy/)
- [Crypto momentum crashes — Springer 2025](https://link.springer.com/article/10.1007/s11408-025-00474-9)
- [Time-series vs cross-sectional crypto momentum — SSRN 2024](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565)
- [Risk-managed momentum crypto — ScienceDirect 2025](https://www.sciencedirect.com/science/article/abs/pii/S1544612325011377)
- [Frog in the Pan — Alpha Architect](https://alphaarchitect.com/frog-in-the-pan-identifying-the-highest-quality-momentum-stocks/)
- [Crypto factor investing — MDPI 2024](https://www.mdpi.com/2227-7390/12/9/1351)
