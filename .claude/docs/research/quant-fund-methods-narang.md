# Методы профессиональных квантовых фондов
## Синтез: "Inside the Black Box" (Narang) + "Finding Alphas" (Tulchinsky)

**Дата:** 2026-04-06
**Источники:** Rishi K. Narang "Inside the Black Box" (2nd ed.), Igor Tulchinsky "Finding Alphas" (2nd ed.), дополнено академическими источниками

---

## 1. Архитектура квантовой системы (по Narang)

Narang описывает квантовую торговую систему как пять взаимосвязанных модулей:

```
Alpha Model
    ↓
Risk Model  ←→  Portfolio Construction Model  ←→  Transaction Cost Model
                        ↓
                 Execution Model
                        ↓
                   Live Market
                        ↓ (feedback)
              Research & Refinement
```

Ключевой принцип: **ни один модуль не работает изолированно**. Сигнал из Alpha Model бессмысленен без Risk Model, которая ограничивает концентрацию. Portfolio Construction не может игнорировать Transaction Cost, иначе теоретически прибыльный портфель будет убыточен после комиссий.

Этот принцип прямо применим к нашему боту: confluence score (наш "alpha model") должен взаимодействовать с risk budget (5% DD per day) и учитывать реальные затраты на вход — спред и slippage лимитного ордера.

---

## 2. Alpha Models — типология торговых сигналов

### 2.1 Theory-driven vs Data-driven

**Theory-driven (дедуктивный подход):**
- Начинается с гипотезы о рыночной аномалии
- Пример: "институциональные игроки оставляют Order Blocks — следовательно, цена вернётся к ним"
- Наш SMC-подход — theory-driven: есть структурная логика за каждым индикатором

**Data-driven (индуктивный подход):**
- Начинается с данных, ищет статистические закономерности
- WorldQuant использует тысячи data-driven alphas одновременно
- Риск: overfit, нет экономического объяснения (хрупкость)

Narang рекомендует **комбинировать оба подхода**: theory дает robustness, data дает точность.

### 2.2 Шесть классов alpha-феноменов (Narang)

| Класс | Описание | Наш аналог |
|-------|----------|------------|
| **Trend** | Моментум — активы продолжают двигаться в направлении | BOS/CHoCH + EMA |
| **Reversion** | Mean reversion — возврат к среднему | FVG fill, OB touch |
| **Technical Sentiment** | Накопленные позиции участников | Liquidity sweep |
| **Value/Yield** | Фундаментальная недооценённость | Не применимо к крипто |
| **Growth** | Ускоряющаяся прибыль | Не применимо |
| **Quality** | Качество эмитента | Не применимо |

Для крипто значимы первые три класса. Наша стратегия охватывает все три — это правильная диверсификация по феноменам.

### 2.3 Многотаймфреймный подход как alpha-стек

Профессиональные фонды используют **alpha horizon** — временной горизонт, на котором сигнал валиден. Наш MTF-подход реализует эту концепцию:
- **4H** → долгосрочный контекст (bias), горизонт: дни
- **1H** → среднесрочная структура, горизонт: часы
- **15M** → entry precision, горизонт: 15–60 минут

Каждый таймфрейм — отдельный alpha-источник. Их согласованность = confluence.

---

## 3. Risk Models — управление рисками в квантовых фондах

### 3.1 Систематический vs Идиосинкратический риск

Профессиональные quant фонды разделяют:

**Систематический (Factor) риск:**
- Риск, общий для всего рынка или класса активов
- Пример: коррекция крипторынка тянет все пары вниз одновременно
- Контролируется через **portfolio-level exposure limits**

**Идиосинкратический риск:**
- Специфичный для конкретного инструмента
- Пример: листинг/делистинг, хак протокола для отдельного токена
- Контролируется через **per-asset position sizing**

### 3.2 Risk Limits

Narang описывает иерархическую систему лимитов:

```
Уровень 1: Portfolio Heat (совокупный риск портфеля)
    └── Пример: суммарный риск всех позиций ≤ 2% баланса одновременно

Уровень 2: Sector/Correlation Budget
    └── Если BTC и ETH скоррелированы > 0.8, они считаются за одну позицию

Уровень 3: Per-Asset Risk Budget
    └── Максимальный убыток по любой одной позиции = 3% (наш HyroTrader SL)

Уровень 4: Daily Loss Limit
    └── 5% дневной DD = стоп всей торговли на день (HyroTrader compliance)
```

Наша система уже реализует уровни 3 и 4. Уровни 1 и 2 — важная недостающая часть при расширении на 5+ пар.

### 3.3 Drawdown-based Circuit Breakers

Профессиональные фонды не ждут "мягкого предела" — они используют каскадные стопы:
- **Yellow Zone** (50% от max DD): снижение размеров позиций на 50%
- **Orange Zone** (75% от max DD): торговля только в одну сторону (по тренду)
- **Red Zone** (90% от max DD): полная остановка до ручного подтверждения

Применительно к нашему боту с лимитом 10% max DD:
- 5% accumulated DD → позиции уменьшаются вдвое
- 7.5% DD → только лонги при бычьем рынке
- 9% DD → автостоп

---

## 4. Transaction Cost Models — скрытые затраты

### 4.1 Компоненты транзакционных издержек

Профессионалы разбивают costs на три компонента:

```
Полные транзакционные издержки =
    Комиссия брокера (фиксированная)
    + Bid-Ask спред (рыночная)
    + Market Impact (наш ордер двигает цену)
    + Opportunity Cost (не вошли вовремя)
```

Для лимитных ордеров на BTCUSDT:
- **Комиссия Bybit maker:** 0.02% (при исполнении как maker)
- **Спред BTC:** обычно < 0.01% (negligible для крупных пар)
- **Market impact:** минимален для наших размеров ($11K notional)
- **Opportunity cost:** высокий — лимит может не исполниться, цена уйдёт

### 4.2 Implementation Shortfall (Перри Кауфман)

**Implementation Shortfall** — разница между теоретической (paper) прибылью и реальной прибылью после исполнения:

```
IS = (Теоретическая цена входа) - (Фактическая цена входа)
   + (Упущенные позиции из-за неисполнения лимита)
```

Это метрика для оценки качества нашей execution. Если стратегия показывает 3% в бэктесте, но реальный IS = 0.5%, то реальная доходность ≈ 2.5%.

### 4.3 Execution алгоритмы

**TWAP (Time-Weighted Average Price):**
- Делит ордер на равные части по времени
- Независимо от объёма рынка
- Применение: низколиквидные активы, когда не хочется двигать цену

**VWAP (Volume-Weighted Average Price):**
- Исполняет пропорционально объёму рынка
- Лучшее среднее, но медленнее TWAP в пиковые часы
- Применение: институциональные ордера размером > 1% daily volume

**Implementation Shortfall алгоритмы:**
- Балансируют market impact риск vs timing риск
- Агрессивнее VWAP, быстрее исполняют
- Оптимальны при наличии сильного сигнала (decay alert)

**Для нашего бота:** TWAP/VWAP нерелевантны (позиции маленькие). Правильная стратегия — лимит на уровне OB с отменой через N свечей, если не исполнился (это и есть Implementation Shortfall thinking).

---

## 5. Portfolio Construction — объединение alpha-сигналов

### 5.1 Два подхода (Narang)

**Rule-Based Models:**
- Простые правила определяют размер позиции
- Не требуют оптимизации, устойчивы к overfitting
- Примеры правил:

```
Equal Position Weighting: каждый сигнал = одинаковый размер позиции
Equal Risk Weighting: размер = 1/volatility (normalized риск)
Alpha-Driven Weighting: размер пропорционален силе сигнала (confluence score)
Decision Tree Weighting: набор правил-условий
```

**Optimization-Based Models:**
- Mean-Variance Optimization (Markowitz) — максимизировать Sharpe
- Risk Parity — равный вклад риска от каждой позиции
- Black-Litterman — байесовское смешение prior + alpha views

**Практический вывод:** Наранг рекомендует Rule-Based для начала. Оптимизация добавляет стоимость (computational) и риск overfitting. При небольшом числе сигналов (наши 8 индикаторов) rule-based с alpha-driven weighting — правильный выбор.

### 5.2 Fundamental Law of Active Management (Grinold)

Ключевая формула квантового инвестирования:

```
IR = IC × √Breadth

Где:
  IR = Information Ratio (доходность / tracking error)
  IC = Information Coefficient (корреляция прогноза с реальностью)
  Breadth = количество независимых прогнозов в год
```

**Пример применения:**
- Стратегия с IC = 0.05 (скромный навык) и Breadth = 1000 сигналов/год
- IR = 0.05 × √1000 = 0.05 × 31.6 = **1.58** — excellent

- Стратегия с IC = 0.20 (высокий навык) и Breadth = 25 сигналов/год
- IR = 0.20 × √25 = 0.20 × 5 = **1.00** — good, но хуже первого

**Вывод для нашего бота:** Расширение на 5-8 пар увеличивает Breadth. Если BTCUSDT даёт 50 сделок/год, то 8 пар → 400 сигналов/год. При том же IC — IR вырастает в 2.83 раза. Именно поэтому multi-pair расширение — математически обоснованный путь к улучшению системы.

### 5.3 Корреляция между alpha-сигналами

Ключевой практический момент: эффективный Breadth < номинального Breadth при коррелированных сигналах.

```
Effective Breadth = N / (1 + (N-1) × ρ̄)

Где ρ̄ = средняя попарная корреляция между сигналами
```

При ρ̄ = 0.5 и 8 парах:
```
Effective Breadth = 8 / (1 + 7 × 0.5) = 8 / 4.5 = 1.78 (!)
```

Это критически важно: **8 скоррелированных пар почти не лучше 2 независимых**. Именно поэтому в нашем research по pair candidates мы исключили TON (корреляция -0.49 с BTC была аномалией) и настаиваем на выборе пар с разными бета-профилями.

### 5.4 Alpha Weighting Methods

**Equal Weighting (EW):**
```
weight_i = 1/N
```
Простейший подход. Устойчив к overfitting. Исследования показывают: EW часто превосходит более сложные методы out-of-sample (потому что сложные методы overfitting in-sample).

**Volatility-Weighted (IVP — Inverse Volatility Parity):**
```
weight_i = (1/σ_i) / Σ(1/σ_j)
```
Каждый актив вносит равный вклад риска. Применительно к нашим парам: SOL (ATR 0.65%) получит меньший вес, чем BTC (ATR 0.20%) при равном размере позиции. Это правильно — наш подход 4% per pair с меньшим leverage для волатильных пар реализует именно это.

**Signal-Strength Weighted:**
```
weight_i = confluence_score_i / Σ(confluence_score_j)
```
Более крупная позиция при более сильном сигнале. Реализуемо в нашей системе: сигнал с score 85 заслуживает немного большего размера, чем score 71.

---

## 6. Finding Alphas — методология поиска сигналов (Tulchinsky/WorldQuant)

### 6.1 Что такое Alpha (по WorldQuant)

В WorldQuant alpha — это **математическое выражение, которое маппит данные в вектор позиций**:

```
alpha_t = f(data_t-1, data_t-2, ...) → {weight_i for each instrument i}
```

Каждая alpha — маленькая, часто слабая. Но WorldQuant оперирует **тысячами** таких alphas одновременно.

### 6.2 Метрики качества alpha (WorldQuant fitness formula)

```
Fitness = sqrt(|Returns| / max(Turnover, 0.125)) × Sharpe

Требования для production:
  Turnover: 1% < T < 70%  (слишком низкий = нет сигнала, слишком высокий = costs kill profit)
  Fitness > 1.0
  Sharpe > 1.5 out-of-sample
```

Аналог для нашего бота:
- **Sharpe** — основная метрика качества
- **Win Rate × Risk:Reward** — наш аналог Returns/Turnover
- **DD** — ограничение снизу (HyroTrader compliance)

### 6.3 Information Coefficient (IC) — измерение силы сигнала

**IC** = корреляция между сигналом (прогнозом) и фактическим результатом:

```
IC = corr(signal_t, return_t+1)

Интерпретация:
  IC > 0.10 → очень сильный сигнал (редкость)
  IC 0.05–0.10 → хороший сигнал
  IC 0.02–0.05 → слабый, но используемый в ансамблях
  IC < 0.02 → шум
```

**IC Decay** — как IC падает при увеличении горизонта:

```
IC_lag_k = IC_0 × λ^k

Где λ = decay rate (0.5–0.9 типично)
```

Если lambda низкий (0.5), сигнал "протухает" быстро. Нужно торговать агрессивно.
Если lambda высокий (0.9), сигнал долгоиграющий — можно использовать более широкие SL.

### 6.4 Alpha Decay применительно к SMC

**Order Blocks:** Медленный decay (λ ≈ 0.8–0.9). OB остаётся актуальным часами/днями.
**FVG:** Быстрый decay (λ ≈ 0.5–0.6). FVG заполняется в течение нескольких свечей.
**BOS/CHoCH:** Средний decay (λ ≈ 0.6–0.7). Структура держится несколько часов.
**RSI:** Быстрый decay (λ ≈ 0.4–0.5). Oversold сигнал актуален только моментально.

**Практический вывод:** Наш 15M таймфрейм + лимитные ордера со сроком 3-5 свечей правильно соответствуют decay ключевых SMC сигналов.

### 6.5 Triple Axis Plan (Tulchinsky)

Tulchinsky предлагает три оси для систематического поиска alphas:

```
Ось 1: DATA — какие данные используем?
  Price/Volume → базовый уровень (наш)
  Order Flow → уровень 2
  Alternative Data → профессиональный уровень

Ось 2: UNIVERSE — какие инструменты?
  Single pair → base case
  Correlated pairs → multi-pair
  Cross-asset → advanced

Ось 3: HORIZON — какой горизонт удержания?
  Intraday (< 1 day) → наш 15M
  Swing (days) → 4H/Daily
  Position (weeks) → долгосрочно
```

Наш бот занимает позицию: Price/Volume data + Multi-pair universe + Intraday horizon. Это консистентно и правильно как стартовая точка.

---

## 7. Alpha Research Process — как профессионалы исследуют стратегии

### 7.1 Итерационный цикл (Tulchinsky)

```
1. ИДЕЯ
   Наблюдение рыночного феномена
   (OB создаётся при импульсе → цена возвращается)
        ↓
2. ФОРМАЛИЗАЦИЯ
   Математическое определение сигнала
   (Если last_bearish_candle before impulse > 1.5× ATR → OB zone)
        ↓
3. СИМУЛЯЦИЯ (IN-SAMPLE)
   Бэктест на обучающих данных
   (12 месяцев исторических данных)
        ↓
4. СТАТИСТИЧЕСКАЯ ВАЛИДАЦИЯ
   IC, Sharpe, WR, PF
   Устойчива ли статистика?
        ↓
5. OUT-OF-SAMPLE ТЕСТ
   Независимый период (не видевший при оптимизации)
   OOS Sharpe должен быть > 0.7 × IS Sharpe
        ↓
6. WALK-FORWARD
   Rolling windows: train 12m → test 3m → advance 3m → repeat
   Стабильность IC по окнам?
        ↓
7. ПРОИЗВОДСТВО
   Paper trading → Live с минимальным капиталом → Full deployment
```

### 7.2 Bias Prevention (анти-overfitting правила)

Профессионалы соблюдают строгие правила:

**Правило 1: Минимум 3 независимых источника подтверждения**
Идея, которая работает только на определённом временном периоде или только на одном активе — не idea, а артефакт данных.

**Правило 2: Economic Rationale**
Если нет логического объяснения ПОЧЕМУ сигнал работает — это overfitting. Нельзя говорить "RSI(13) лучше RSI(14) потому что данные так говорят".

**Правило 3: Out-of-Sample Degradation Check**
```
Acceptable degradation: OOS_Sharpe ≥ 0.7 × IS_Sharpe
Red flag: OOS_Sharpe < 0.5 × IS_Sharpe → overfit
Fatal: OOS_Sharpe ≤ 0 → data mining artifact
```

**Правило 4: Parameter Sensitivity**
Если стратегия работает только при точных параметрах (OB_ATR_multiplier = 1.53, а не 1.50 или 1.55), это признак overfitting. Хорошая стратегия стабильна в диапазоне параметров.

**Правило 5: Combinatorial Purged Cross-Validation (CPCV)**
Современный gold standard. Устраняет lookahead bias при walk-forward тестировании. Существенно выше по надёжности чем простой train/test split.

---

## 8. Data — что используют профессионалы

### 8.1 Иерархия данных

```
Уровень 1 (базовый, все используют):
  OHLCV — Open, High, Low, Close, Volume
  Order Book — bid/ask глубина
  Trade Tape — история сделок

Уровень 2 (продвинутый):
  Open Interest (фьючерсы)
  Funding Rate (perpetuals)
  Liquidations data
  Options IV/skew

Уровень 3 (альтернативные данные):
  On-chain метрики (BTC: miner flows, exchange flows)
  Social sentiment (Twitter, Reddit)
  Корреляции с TradFi (S&P 500, DXY, Gold)
  Fear & Greed Index

Уровень 4 (институциональный):
  Credit card transactions
  Satellite imagery
  Geolocation data
  Patent filings
```

Наш бот сейчас на Уровне 1. Funding rate (Уровень 2) уже в фильтрах стратегии — это правильный шаг к Уровню 2.

### 8.2 Data Quality — критическая проблема

Tulchinsky подчёркивает: **garbage in, garbage out**. Качество alpha не может превысить качество данных.

Критические проблемы:
- **Survivorship bias:** Бэктесты на парах, которые существуют сегодня, не учитывают делистинги
- **Lookahead bias:** Использование данных, недоступных в момент принятия решения
- **Point-in-time data:** Ревизии данных (особенно фундаментальных) искажают бэктесты
- **Overfitting to data errors:** Система обучается на артефактах данных

---

## 9. Technology Infrastructure

### 9.1 Уровни скорости

```
HFT (High Frequency Trading):
  Латентность: 100–500 наносекунд
  Инфраструктура: FPGA, colocation, dark fiber
  Конкурировать нельзя — это другой вид спорта

Mid-Frequency (наш класс):
  Латентность: 10–100 миллисекунд
  Инфраструктура: VPS рядом с биржей, WebSocket
  Конкурентоспособно — исполнение на 15M сигналах

Low-Frequency/Position:
  Латентность: секунды–минуты
  Инфраструктура: любая
  Менее конкурентно — больше alpha decay
```

**Для нашего 15M бота:** латентность WebSocket + Redis + расчёта = приемлема. Критичность: SL должен выставляться в течение 5 минут (HyroTrader) — это абсолютно достижимо при любом разумном VPS.

### 9.2 Infrastructure Stack квантового фонда

```
Market Data: Exchange WebSocket → Tick Store (Redis/Kafka)
                                        ↓
Signal Engine: Indicators → Score → Signal Bus (Redis pub/sub)
                                        ↓
Risk Manager: Pre-trade checks → Order Manager
                                        ↓
Execution: Smart Router → Exchange API
                                        ↓
Position Monitor: WebSocket private → PnL Engine → Alerts
```

Наша архитектура следует этой модели: WS public → Redis → Analyzer → Risk → Executor → WS private.

---

## 10. Комбинирование слабых alpha-сигналов в сильный портфель

### 10.1 Ансамблевый подход

Ключевой инсайт WorldQuant: **10 слабых независимых сигналов лучше одного сильного**.

```
Портфель из N некоррелированных сигналов:
  Sharpe_portfolio = Sharpe_single × √N

Пример:
  Каждый сигнал имеет Sharpe = 0.5 (слабый)
  10 некоррелированных сигналов → Sharpe ≈ 0.5 × √10 = 1.58
```

Это математическое обоснование нашего confluence scoring: мы не ищем один "идеальный" сигнал — мы комбинируем 8 умеренных сигналов.

### 10.2 Correlation Management в ансамбле

Проблема: большинство alpha-сигналов для одного инструмента скоррелированы между собой.

**Decorrelation techniques:**

1. **Orthogonalization:** Вычесть из сигнала A ту часть, которая объясняется сигналом B
2. **PCA decomposition:** Выделить независимые principal components
3. **Regime-conditional weighting:** В разных режимах рынка разные сигналы доминируют

Применительно к нашему confluence scorer:
- BOS и EMA оба измеряют тренд — частичная корреляция
- OB и FVG часто возникают вместе — сильная корреляция
- Liquidity sweep и Premium/Discount — слабая корреляция

**Практическое решение:** Группировать скоррелированные сигналы в "кластеры" и ограничить максимальный вклад кластера:

```
Cluster 1 (Trend): BOS/CHoCH + EMA → максимум 30 pts из 100
Cluster 2 (Price Action): OB + FVG → максимум 40 pts из 100
Cluster 3 (Market Context): Liquidity + P/D Zone → максимум 25 pts из 100
Cluster 4 (Momentum): RSI + Volume → максимум 10 pts из 100
```

### 10.3 Multi-Pair как Alpha Diversification

Расширение на несколько пар — это не просто "больше сделок". Это **диверсификация по alpha-источникам**:

```
Пара       | Alpha-феномен          | Режим работы
-----------|------------------------|---------------------------
BTCUSDT    | Trend, Institution     | Мало сделок, высокий WR
ETHUSDT    | Trend + FVG fills      | Средняя частота
SOLUSDT    | Liquidity sweeps       | Высокая частота, высокий DD
LINKUSDT   | Value reversion        | Независимый от BTC режим
```

Если BTC в консолидации (мало сигналов), SOL или LINK могут генерировать сигналы. Это и есть увеличение Breadth в формуле Grinold.

### 10.4 Dynamic Alpha Weighting (Adaptive Approach)

Профессиональные фонды не используют статические веса — они адаптируют в зависимости от:

1. **Regime detection:** В тренде больше вес BOS/EMA, в рейндже больше вес OB/FVG
2. **Recency weighting:** Последние IC периода сигнала получают больший вес
3. **Volatility scaling:** В высоковолатильных режимах все веса масштабируются вниз

Для нашей реализации минимальная версия:
```typescript
// Regime-dependent weights
if (marketRegime === 'TRENDING') {
  weights.bosChoch *= 1.3;
  weights.ema *= 1.3;
  weights.orderBlock *= 0.8;
} else if (marketRegime === 'RANGING') {
  weights.orderBlock *= 1.3;
  weights.fvg *= 1.3;
  weights.bosChoch *= 0.7;
}
```

---

## 11. Alpha Decay — почему стратегии перестают работать

### 11.1 Причины alpha decay

**Market Crowding:**
Когда много участников обнаруживает одну аномалию — её прибыльность снижается. SMC стал популярен среди ретейл-трейдеров → некоторые классические OB паттерны стали менее надёжны.

**Regime Changes:**
Рыночная микроструктура меняется. Стратегия, идеально откалиброванная на bull run 2021, неприменима к медвежьему рынку 2022.

**Technology Improvements:**
Институциональные игроки улучшают execution → арбитражные возможности живут меньше.

**Regulatory Changes:**
Новые правила меняют поведение участников рынка.

### 11.2 Измерение alpha decay

```
Rolling IC: вычислять IC на скользящих 3-месячных окнах

Если IC падает от 0.08 → 0.03 за год → сигнал деградирует
Action: пересмотреть параметры или заменить сигнал

Если IC стабилен 0.05–0.06 на протяжении 2+ лет → robust signal
```

**Практическое правило:** Регулярный re-calibration (каждые 3–6 месяцев walk-forward) — обязательная практика профессиональных фондов. Не переоптимизация, а проверка: не началась ли деградация IC.

---

## 12. Применимость к нашему боту — практические выводы

### 12.1 Что уже реализовано правильно

| Принцип Narang/Tulchinsky | Наша реализация |
|---------------------------|-----------------|
| Theory-driven alphas | SMC имеет структурное обоснование |
| Multiple signal sources | 8 индикаторов в confluence |
| MTF analysis | 4H bias → 1H structure → 15M entry |
| Risk hierarchy | HyroTrader compliance + per-pair sizing |
| Limit orders | Никогда market entry |
| Transaction cost awareness | Lim orders = maker fees (0.02%) |

### 12.2 Что нужно добавить (по приоритетам)

**Приоритет 1 — Portfolio Heat:**
Максимальный совокупный риск всех открытых позиций. При расширении на 5+ пар критично.

**Приоритет 2 — Correlation Tracking:**
Динамическая матрица корреляций открытых пар. Не открывать BTC Long + ETH Long одновременно без корреляционного дисконта.

**Приоритет 3 — Rolling IC Monitoring:**
Отслеживать, не деградирует ли IC каждого индикатора. Ранняя система предупреждения об alpha decay.

**Приоритет 4 — Regime Detection:**
Классификация рыночного режима (trending/ranging/volatile) и адаптация весов confluence accordingly.

**Приоритет 5 — Walk-Forward Re-calibration:**
Расписание: каждые 3 месяца прогонять walk-forward. Если OOS_Sharpe < 0.7 × IS_Sharpe — пересмотр параметров.

### 12.3 Ключевые числа для валидации

По стандартам профессиональных фондов, для стратегии с нашим profile (15M, limit orders, multi-pair):

```
Минимальный IC для использования сигнала:     0.03
Целевой IC для ключевых сигналов (OB, BOS):   0.05–0.10
Допустимая деградация IS→OOS:                 ≤ 30%
Минимальный Sharpe для production:            1.0
Целевой Sharpe:                               1.5+
Max Breadth utilization (8 пар × 50 сигн):   400 сигналов/год
Ожидаемый IR при IC=0.05, N=400:             ~1.0
```

---

## Источники

- [Inside the Black Box — Wiley Online Books](https://onlinelibrary.wiley.com/doi/book/10.1002/9781118267738)
- [Inside the Black Box Chapter Summary — Bookey](https://www.bookey.app/book/inside-the-black-box-by-rishi-k-narang)
- [Reading the Markets: Narang review](https://readingthemarkets.blogspot.com/2013/04/narang-inside-black-box-2d-ed.html)
- [Finding Alphas — Wiley Online Books](https://onlinelibrary.wiley.com/doi/book/10.1002/9781119571278)
- [101 Formulaic Alphas — arxiv.org](https://arxiv.org/pdf/1601.00991)
- [Grinold Fundamental Law — Blank Capital Research](https://blankcapitalresearch.com/learn/grinold-fundamental-law-active-management)
- [Information Coefficient — PyQuant News](https://www.pyquantnews.com/the-pyquant-newsletter/information-coefficient-measure-your-alpha)
- [Alpha Decay — Maven Securities](https://www.mavensecurities.com/alpha-decay-what-does-it-look-like-and-what-does-it-mean-for-systematic-traders/)
- [Multi-period portfolio optimization with alpha decay — arxiv.org](https://optimization-online.org/wp-content/uploads/2015/02/4785.pdf)
- [Walk-Forward Optimization — QuantInsti](https://blog.quantinsti.com/walk-forward-optimization-introduction/)
- [Implementation Shortfall algorithms — Signal Pilot](https://education.signalpilot.io/curriculum/advanced/70-execution-algorithms-twap-vwap.html)
- [Alternative Data Market 2024 — TenderAlpha](https://www.tenderalpha.com/blog/post/quantitative-analysis/alternative-data-market-overview-new-figures-as-of-2024)
- [WorldQuant Alpha Fitness — Scribd](https://www.scribd.com/document/860128209/WorldQuant)
