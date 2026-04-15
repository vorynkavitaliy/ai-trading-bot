# Market Microstructure: Flash Boys + Trading and Exchanges
# Применение к нашему алго-боту на Bybit

**Дата:** 2026-04-06
**Источники:** Michael Lewis "Flash Boys" (2014), Larry Harris "Trading and Exchanges: Market Microstructure for Practitioners" (2003)

---

## 1. Анатомия рынка: кто торгует и зачем

Harris классифицирует участников рынка по мотивации — это фундамент для понимания всего остального:

### Типы трейдеров по Harris

**Informed Traders (информированные)**
Торгуют на основе предсказания будущей цены. Владеют информацией, которой нет у рынка. Их ордера двигают цену в направлении "истинной стоимости". Для нас: мы должны действовать как informed trader — наш confluence score — это наше информационное преимущество.

**Uninformed Traders (ликвидностные)**
Торгуют по другим причинам: ребалансировка, хеджирование, вывод средств. Их ордера — "шум". Маркет-мейкеры зарабатывают именно на них. Для нас: важно не торговать как uninformed trader — не входить без сигнала, не торговать ради активности.

**Dealers / Market Makers**
Постоянно держат двусторонние котировки. Зарабатывают bid-ask spread. Несут inventory risk (риск накопления позиции). Для нас: понимание того, кто стоит на другой стороне сделки при входе лимитным ордером.

**HFT Arbitrageurs (Flash Boys)**
Используют скорость для арбитража между площадками. Не добавляют информации, но потребляют ликвидность. В крипто: аналоги — арбитражные боты между Bybit/Binance/OKX.

**Ключевой вывод для нашего бота:**
Мы — алгоритмический informed trader с задержкой исполнения в секунды, не миллисекунды. Наше преимущество — качество сигнала (SMC + confluence), а не скорость.

---

## 2. Механика бид-аск спреда

Harris разбирает спред на три компонента:

### Компоненты спреда

```
Bid-Ask Spread = Order Processing Cost + Inventory Holding Cost + Adverse Selection Cost
```

**Order Processing Cost** — комиссионные, операционные расходы биржи. На Bybit: частично отражён в maker/taker fees (maker 0.02%, taker 0.055%).

**Inventory Holding Cost** — риск маркет-мейкера от удержания позиции. Если MM купил у вас и рынок идёт вниз — он теряет. Компенсируется через спред.

**Adverse Selection Cost** — самый важный компонент. Когда MM видит ваш ордер на покупку, он не знает: вы informed (цена пойдёт вверх) или uninformed (случайный). Он расширяет спред, чтобы компенсировать убытки от торговли против informed traders.

### Модель Glosten-Milgrom (1985)

Ключевое уравнение для понимания:

```
Ask = E[V | Buy Order] = E[V] + λ × (Buy Signal Strength)
Bid = E[V | Sell Order] = E[V] - λ × (Sell Signal Strength)
```

Где λ (лямбда) — мера adverse selection. Чем больше доля informed traders в потоке ордеров — тем шире спред.

**Применение к нам:**
- При сильном confluence score (85+) мы действуем как informed trader → маркет-мейкеры будут держать широкий спред именно в момент нашего входа
- Лимитный ордер на OB-зоне позволяет войти как maker, не платить taker fee, и избежать adverse selection

---

## 3. Flash Boys: как HFT эксплуатирует латентность

### Механизм латентного арбитража

Кратьюяма (Brad Katsuyama) обнаружил в RBC: при попытке купить 1,500,000 акций IBM одновременно на 13 биржах, HFT-алгоритм за ~350 микросекунд:

1. Видел первый ордер на ближайшей бирже
2. Рассчитывал, что такой же ордер идёт на остальные биржи
3. Покупал акции на всех остальных биржах быстрее
4. Продавал их обратно по повышенной цене

**Суть:** HFT не предсказывает направление рынка — они предсказывают ваш следующий ордер.

### Три метода эксплуатации

**Electronic Front-Running**
HFT видит ваш лимитный ордер на одной бирже → бежит на другую → поднимает цену там. Вы покупаете дороже. Возможно только при наличии нескольких площадок и ценовых различий между ними.

**Rebate Arbitrage**
Биржи платят rebate за maker-ордера. HFT флудит ордерами не для торговли, а для получения rebate. Создаёт иллюзию ликвидности, которая испаряется при реальном движении.

**Slow Market Arbitrage**
HFT видит цену на одной площадке раньше, чем она обновляется на другой. Торгует против вас по устаревшей котировке.

### Решение IEX: Speed Bump

IEX создали 38 миль намотанного оптоволокна → задержка 350 микросекунд для всех ордеров. HFT теряет преимущество скорости. Результат: никакого latency arbitrage.

### Применение к Bybit (крипто-специфика)

**В крипто HFT-проблема выглядит иначе:**

1. Bybit — единая площадка, нет multi-venue arbitrage проблемы Flash Boys
2. Но: арбитражные боты между Bybit, Binance, OKX работают аналогично
3. Funding rate arbitrage — аналог rebate arbitrage из Flash Boys
4. "Quote stuffing" и spoofing — реальны на крипто (фейковые стены в ордербуке)

**Что это значит для нас:**

Наш 15M таймфрейм защищает нас от HFT-проблем. Мы не торгуем на микросекундном горизонте. Latency arbitrage нам не страшен — наш сигнал формируется за минуты, а не миллисекунды.

Опасность для нас иная: **spoofing и quote stuffing перед нашим входом.** Большая "стена" ордеров в ордербуке создаёт ложный уровень поддержки/сопротивления. Когда мы приближаемся к уровню — стена испаряется.

---

## 4. Механика matching engine биржи

### Принципы Price-Time Priority (Harris)

Стандартный matching engine работает по правилам:

```
1. Price Priority: лучшая цена исполняется первой
   - Buy: выше цена = приоритет
   - Sell: ниже цена = приоритет

2. Time Priority: при одинаковой цене — раньше пришёл, раньше исполнился
   - Это создаёт очередь (queue) на каждом ценовом уровне
   - Queue position критична для частоты исполнения

3. Display Priority: показанные ордера vs скрытые (iceberg)
   - Displayed ордера получают приоритет перед hidden при той же цене
```

**Bybit matching engine:** обрабатывает до 100,000 транзакций в секунду. Использует Price-Time Priority для USDT Perpetual контрактов.

### Queue Position и Fill Rate

**Ключевое открытие Harris:**

Позиция в очереди (queue position) определяет вероятность исполнения:
- Ордер первый в очереди на лучшем уровне: очень высокая вероятность fill
- Ордер 50-й в очереди: заполняется только если пришёл большой маркет-ордер
- Ордер далеко от mid-price: высокая вероятность истечения без исполнения

**Трейдофф для нашего бота:**

```
Тесный лимит (близко к mid-price):
  + Быстрый fill
  + Лучшая цена входа
  - Высокий риск adverse selection (цена пошла против нас после fill)
  - Конкуренция с HFT за queue position

Широкий лимит (глубже в ордербуке, на OB-уровне):
  + Лучшая цена (дальше от mid = дешевле покупаем/дороже продаём)
  + Меньше HFT-конкуренции
  + SMC-логика: именно на OB мы хотим войти
  - Ниже вероятность fill
  - Риск "пропустить" движение
```

Для SMC-стратегии: наш лимит ВСЕГДА на OB-зоне, не у текущей цены. Это правильно с точки зрения микроструктуры — мы намеренно ждём ретест.

---

## 5. Информационная асимметрия и VPIN

### VPIN (Volume-Synchronized Probability of Informed Trading)

Easley и O'Hara разработали VPIN — метрику для оценки доли informed order flow:

```
VPIN = |Buy Volume - Sell Volume| / Total Volume

Значения:
  VPIN < 0.25: нормальный рынок, низкая информационная асимметрия
  VPIN 0.25-0.50: умеренная асимметрия, повышенная волатильность
  VPIN > 0.50: высокая асимметрия, высокий риск flash crash
```

**Исторически:** VPIN резко вырос за 20 минут до Flash Crash 6 мая 2010 года.

**Для нашего бота:**

Order flow imbalance (OFI) — близкий к VPIN показатель — имеет near-linear связь с краткосрочными изменениями цены. Если OFI сильно положительный (много buy агрессии) → цена с высокой вероятностью пойдёт вверх в ближайшие секунды/минуты.

Практическое применение:
- Сильный OFI в направлении нашего сигнала → подтверждение входа
- OFI против нашего сигнала → можно подождать или пропустить

### Order Book Imbalance как сигнал

Академические исследования 2024-2025 показывают: дисбаланс ордербука на лучшем bid/ask предсказывает следующий сдвиг mid-price с высокой точностью на коротких горизонтах.

```
OBI = (Bid Volume @ Best) / (Bid Volume @ Best + Ask Volume @ Best)

OBI > 0.65: давление вверх, цена скорее вырастет
OBI < 0.35: давление вниз, цена скорее упадёт
OBI 0.35-0.65: нейтрально
```

Этот сигнал работает на горизонте секунд-минут. На нашем 15M горизонте менее значим, но полезен для fine-tuning точки входа.

---

## 6. Dark Pools и скрытая ликвидность

### Механика Dark Pools (Harris + Flash Boys)

Dark pools — внебиржевые площадки где крупные институциональные сделки исполняются анонимно по mid-price. Возникли как защита от HFT front-running.

**Проблема для рынка в целом:**
- ~40% торгового объёма в акциях проходит в "темноте"
- Публичные котировки не отражают полное давление покупок/продаж
- Цена discovery замедляется

**В крипто-аналоге:**

Реальных dark pools для BTC фьючерсов нет. Но есть аналоги:
1. **OTC-desk сделки** — крупные сделки между whale-кошельками напрямую
2. **Iceberg ордера** — видимая часть маленькая, скрытая — большая
3. **Block trades** — на CME Bitcoin Futures существуют block trade механизмы

**Что это значит для наших OB-зон:**

Крупные ордера в OB-зонах могут быть частично скрыты. Если мы видим OB с сильным импульсом, но относительно маленькими объёмами — возможно, реальный размер позиции институционала больше видимого.

---

## 7. Типы ордеров и стратегическое применение

### Классификация ордеров по Harris

**Market Order (маркет)**
- Немедленное исполнение по лучшей доступной цене
- Платишь taker fee (Bybit: 0.055%)
- Гарантия исполнения, но цена неизвестна
- Price impact: твой ордер двигает рынок против тебя (особенно при большом объёме)
- **Применение в нашем боте:** ТОЛЬКО для принудительного закрытия ("Стоп" команда в Telegram или SL-violation)

**Limit Order (лимит)**
- Исполнение только при достижении цены
- Платишь maker fee (Bybit: 0.02%) при PostOnly
- Риск non-fill (ордер может не исполниться)
- Нет price impact если ждёшь в ордербуке
- **Применение:** ВСЕ наши входы — только лимитные, на OB-зонах

**PostOnly Limit Order**
- Гарантирует статус maker — отклоняется если исполнится как taker
- Полностью избегает taker fee
- Bybit поддерживает: `timeInForce: "PostOnly"`
- **Рекомендация:** использовать PostOnly для входных ордеров. При быстром движении цены ордер отменится, а не заполнится по рынку — это защита от слипаджа.

**GTC vs IOC vs FOK**

```
GTC (Good-Till-Cancelled):
  Ордер стоит до исполнения или ручной отмены
  Применение: наши входные ордера — ставим и ждём ретест OB

IOC (Immediate-Or-Cancel):
  Исполняет что может немедленно, остаток отменяет
  Применение: Bybit конвертирует маркет-ордера в IOC лимиты (защита от слипаджа)

FOK (Fill-Or-Kill):
  Всё или ничего немедленно
  Применение: нам не нужен, слишком агрессивный
```

**Stop-Loss ордера:**

На Bybit Stop Loss для позиции ставится через TP/SL механизм (не через conditional order). Это КРИТИЧНО для HyroTrader compliance — SL должен быть server-side.

```
SL исполняется как market order при достижении trigger price
→ Может дать slip на 0.1-0.3% при volatility spike
→ Учитывать это в расчёте SL-дистанции
```

**Iceberg ордера:**

Harris описывает iceberg как инструмент сокрытия реального размера позиции. HFT-алгоритмы умеют обнаруживать iceberg паттерны (повторное появление одного и того же объёма). В крипто менее распространены, но Bybit поддерживает.

---

## 8. Price Discovery и формирование справедливой цены

### Механизм Price Discovery (Harris)

Цена определяется как пересечение спроса и предложения в реальном времени. Ключевые факторы:

1. **Informed Order Flow** — ордера от трейдеров с информацией двигают цену к "истинной стоимости"
2. **Market Maker Updates** — MM непрерывно пересматривают котировки на основе order flow
3. **Arbitrage** — выравнивает цены между площадками

**Для наших SMC-зон:**

Order Blocks — это именно зоны, где институциональные informed traders накапливали позиции. Возврат цены к OB — это price discovery к зоне истинного баланса спроса/предложения.

Это не магия — это market microstructure: институционал не смог поглотить весь supply/demand за один раз, вернулся за остатком.

### Funding Rate как сигнал дисбаланса

В USDT Perpetual Bybit funding rate отражает разницу между perpetual price и spot price:

```
Funding Rate > 0: perpеtual торгуется с премией к спот
  → Лонгисты платят шортистам каждые 8 часов
  → Рынок "перегрет" в лонг, повышенный риск для лонгов

Funding Rate < 0: perpetual с дисконтом
  → Шортисты платят лонгистам
  → Рынок "перегрет" в шорт

Экстремальные значения (>0.1% или <-0.1%) → не торговать
(наша стратегия уже это учитывает — фильтр в strategy.md)
```

Funding rate — прокси для VPIN в перпах. Высокий funding = высокая доля informed (направленных) позиций.

---

## 9. Market Making механика — чему учиться

### Как маркет-мейкер профитирует

Harris подробно разбирает MM-экономику:

```
MM profitability = Spread Revenue - Adverse Selection Losses - Inventory Costs

За 1 round-trip:
  Доход = Bid-Ask Spread / 2 (с каждой стороны)
  Потери = убыток от сделок с informed traders
  
Равновесие: spread достаточно широкий, чтобы доходы > потерь
```

**Ключевой урок: MM знает, что часть его контрагентов информированы, и закладывает это в цену.**

### Применение к нашей лимитной стратегии

Когда мы ставим лимитный ордер на OB-уровне, мы по сути **конкурируем за позицию с MM**. Наш ордер стоит раньше, чем MM успевает переоценить уровень.

Почему OB работает? Потому что:
1. MM установил котировки до импульсного движения
2. Импульс съел liquidity выше/ниже
3. Цена возвращается к зоне накопления
4. Наш ордер там ждёт — мы "ловим" ретест как maker, а не taker

---

## 10. Transaction Cost Analysis (TCA) для нашего бота

### Полная модель транзакционных издержек

```
Total Cost per Trade = Exchange Fees + Market Impact + Opportunity Cost + Slippage

Exchange Fees:
  Entry (maker): 0.02% × notional
  Exit (maker):  0.02% × notional
  SL (taker):    0.055% × notional
  Total round-trip (entry+TP maker, SL taker): ~0.095%

Market Impact:
  Лимитный ордер в очереди: ~0% (мы добавляем ликвидность, не берём)
  Маркет ордер: зависит от объёма vs книга заявок

Opportunity Cost:
  Non-fill риск: если ордер не заполнился, а цена ушла
  Количественно: WR × (avg profit) × non-fill rate

Slippage on SL:
  Market execution при volatility spike: 0.1-0.3% слипа
  На $11,250 notional: $11.25 - $33.75 дополнительный убыток при SL
```

### TCA в числах для нашей позиции ($10K account)

```
Notional: $11,250 (22.5% × $10K × 5x leverage)
Margin: $2,250

Per-trade costs:
  Entry fee (maker, PostOnly): $11,250 × 0.02% = $2.25
  Exit fee (TP maker):         $11,250 × 0.02% = $2.25
  SL fee (taker):              $11,250 × 0.055% = $6.19

Scenario A: TP hit
  Total fees: $2.25 + $2.25 = $4.50
  As % of margin: 0.20%
  At 1.5R TP: profit ~$100-150, fees = 3-4.5% of profit (acceptable)

Scenario B: SL hit
  Total fees: $2.25 + $6.19 = $8.44
  SL loss (3% of $10K): $300
  Fees add: 2.8% to SL loss (significant but unavoidable)

Вывод: постоянное использование PostOnly для входа критично — экономим 0.035% × notional = $3.94 per trade vs taker entry
```

---

## 11. Оптимальное размещение лимитных ордеров

### Теория из Harris + академические исследования

**Принцип экономии на spread:**

Informed trader с временно ограниченной информацией должен выбрать:
- Market order: немедленное исполнение, но платит спред
- Limit order: ждёт, но получает спред вместо его оплаты

Трейдофф формализован как:
```
Expected Value(Limit) = P(fill) × (Spread/2 + Alpha) - P(adverse move) × Loss
Expected Value(Market) = Alpha - Spread/2

Limit лучше когда: P(fill) × Spread/2 > P(adverse move) × Loss
```

Где Alpha = информационное преимущество (наш confluence score).

**Вывод:** Чем выше наш confidence в сигнале (выше score), тем больше смысл ждать исполнения лимита, а не брать рынком.

### Оптимальная дистанция лимита от mid-price

Исследование "Optimal trade execution in cryptocurrency markets" (Digital Finance, 2024):

Для BTC perpetual optimal limit placement:

```
Слишком близко к mid (< 0.05%):
  - Высокая конкуренция с MM и HFT
  - Риск fill при adverse selection момент
  - Часто исполняется как taker (если цена двигается быстро)

Оптимальный диапазон (0.1% - 0.5% от mid):
  - Maker status почти гарантирован
  - Достаточный буфер от случайных движений
  - Хорошая вероятность fill при ретесте OB

Слишком далеко (> 1.0%):
  - Очень низкая вероятность fill (нужно глубокое движение)
  - Большой OB-уровень оправдывает, малый — нет
```

**Для нашей SMC-стратегии:**

Мы размещаем ордер на mid-point OB зоны или в верхней трети для лонгов:

```
Bullish OB:
  OB.high - OB.low = 0.3-0.8% (типично для BTCUSDT на 15M)
  
  Вход: OB.high - 20-30% от OB range
  Логика: 
    - Не на самом high (риск false fill при касании)
    - Не на low (рискуем не наполниться)
    - Mid-upper часть: баланс fill rate и price quality
  
  Пример:
    BTC price = $95,000
    OB.high = $94,800, OB.low = $94,400
    OB range = $400 = 0.42%
    Entry = $94,800 - $80 = $94,720
    Distance from current price = 0.30%
```

### Адаптивный размер лимита по ATR

Из Harris: оптимальная дистанция лимита должна учитывать волатильность:

```
Base offset = ATR(14) × OB_depth_factor

Low volatility (ATR/price < 0.15%):
  OB зоны мельче, ретесты чаще → входить ближе к OB.high
  offset_from_high = OB_range × 0.15

Normal volatility (ATR/price 0.15-0.30%):
  Стандартный вход
  offset_from_high = OB_range × 0.25

High volatility (ATR/price > 0.30%):
  Deeper OB, retests overshooting → входить ниже mid OB
  offset_from_high = OB_range × 0.40
  (Учитываем что цена может "проколоть" зону перед разворотом)
```

---

## 12. Защита от Front-Running и Spoofing

### Spoofing в ордербуке

Flash Boys описывает, как HFT создаёт фиктивные стены ордеров, которые исчезают при приближении реального ордера. В крипто это распространённая практика:

**Признаки spoofing:**
1. Очень большой ордер появляется в книге (>5x средний размер)
2. Стоит несколько секунд-минут
3. Исчезает при приближении цены (не исполняется)
4. Создаёт ложное ощущение поддержки/сопротивления

**Последствия для нашего бота:**
- OB-зона может казаться подтверждённой большим объёмом в ордербуке
- В реальности это spoofed liquidity
- При входе лимитом цена "провалится" мимо нашего ордера

**Защита:**

```
1. Игнорируем ордерную книгу при оценке OB
   → Наш OB основан на исторических свечных данных, не на текущей книге
   → HFT не может "исказить" исторические свечи (это реальные сделки)

2. ATR-фильтр волатильности
   → При аномальном spike ATR > 3% не торгуем
   → Spoofer часто активен в периоды аномальной активности

3. Funding rate фильтр (>0.1%)
   → Высокий funding = directional pressure = повышенная HFT-активность

4. Volume confirmation на импульс OB
   → OB должен быть создан реальным объёмом (> 1.5x avg volume)
   → Спуфер не делает реальных сделок
```

### Quote Fade — исчезновение ликвидности

Вторая проблема из Flash Boys: при попытке исполнить большой ордер ликвидность "убегает". HFT видит твой ордер и отменяет свои котировки.

**Для нас это не критично:** наш ордер маленький ($11,250 notional vs daily BTC volume $1B+). Мы не двигаем рынок. Quote fade — проблема institutional traders, не нашего размера.

---

## 13. Specific Bybit Microstructure: что важно знать

### Matching Engine характеристики

- **Скорость:** 100,000 транзакций/секунду
- **Задержка REST API:** ~50-200ms при нормальной нагрузке
- **WebSocket updates:** order book updates каждые 100ms
- **Price-Time Priority:** стандартный FIFO на каждом ценовом уровне

### Bybit-специфичные типы ордеров

**PostOnly:**
```typescript
{
  orderType: "Limit",
  timeInForce: "PostOnly",
  // Если заполнится как taker — автоматически отклоняется
  // Гарантирует maker fee: 0.02% вместо 0.055%
}
```

**Reduce-Only:**
```typescript
{
  reduceOnly: true,
  // Только закрывает позицию, не открывает новую
  // Использовать для TP и SL ордеров
}
```

**TP/SL через позицию (не отдельный ордер):**
```typescript
// Предпочтительный метод для SL — HyroTrader compliant
{
  stopLoss: "94200",      // trigger price
  slTriggerBy: "LastPrice",  // или MarkPrice
}
```

### Маркет-ордера на Bybit = IOC лимиты

Bybit конвертирует market orders в IOC limit orders с ценовым protect-ом:
- Buy market: лимит = текущий ask + slippage protection (обычно 3%)
- Sell market: лимит = текущий bid - slippage protection

Это важно для SL: при сильном волатильном движении market SL может не исполниться по желаемой цене, если цена улетела за пределы protect-range.

**Рекомендация:**
- Для SL использовать `slTriggerBy: "MarkPrice"` — Mark Price более стабильна, меньше манипуляций через wick-и
- Last Price SL уязвим к wick manipulation

### Funding Rate и оптимальные окна входа

Funding собирается каждые 8 часов (00:00, 08:00, 16:00 UTC).

**Micro-structure паттерн:**
```
За 10-30 минут до funding payment:
  - Трейдеры закрывают позиции, чтобы не платить funding
  - Аномальный объём и volatile движения
  - Наши лимитные ордера могут исполниться "случайно"
  - Избегать выставления ордеров в этот период

После funding payment:
  - Рынок стабилизируется
  - OB-ретесты более чистые
  - Лучшее время для наших входов
```

### Retail Price Improvement (RPI) ордера на Bybit

Bybit ввёл в конце 2025 года RPI ордера, которые обеспечивают улучшенную цену для розничных трейдеров. Составляют >50% глубины ордербука для BTC/ETH.

Практически это означает: ликвидность на Bybit стала более "retail-friendly", спреды уже, что выгодно нашей лимитной стратегии.

---

## 14. Сводные рекомендации для реализации

### Оптимизация лимитного ордера (Приоритет 1)

```typescript
// Оптимальный вход по SMC OB
const calculateEntryPrice = (ob: OrderBlock, atr: number, price: number): number => {
  const obRange = ob.high - ob.low;
  const atrPct = atr / price;
  
  let depthFactor: number;
  if (atrPct < 0.0015) depthFactor = 0.15;      // низкая волатильность
  else if (atrPct < 0.003) depthFactor = 0.25;   // нормальная
  else depthFactor = 0.40;                         // высокая
  
  // Для bullish OB: входим ниже high
  return ob.high - obRange * depthFactor;
};

// Всегда PostOnly для maker fee
const orderParams = {
  orderType: "Limit",
  timeInForce: "PostOnly",
  price: calculateEntryPrice(ob, atr, currentPrice),
  qty: positionQty,
  reduceOnly: false,
};
```

### SL через Mark Price (Приоритет 1)

```typescript
// Использовать Mark Price для защиты от wick manipulation
const slParams = {
  stopLoss: slPrice.toString(),
  slTriggerBy: "MarkPrice",  // не LastPrice
};
```

### Избегать trading перед funding (Приоритет 2)

```typescript
const isFundingWindow = (now: Date): boolean => {
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  // 10 минут до и после funding payment (0, 8, 16 UTC)
  const fundingHours = [0, 8, 16];
  return fundingHours.some(h => 
    (hours === h && minutes >= 50) ||  // 10 мин до
    (hours === (h + 1) % 24 && minutes < 10)  // 10 мин после
  );
};
```

### Volume confirmation OB (Приоритет 2)

```
OB volume requirement: 
  impulsive move forming OB: volume > 1.5x avg_volume_20
  → Защита от spoofed OB levels (реальный volume не подделать в истории)
```

### Order Book Imbalance как дополнительный фильтр (Приоритет 3)

```
При высоком confluence score (80+) — опционально проверить OBI:
  OBI направлен В пользу нашего сигнала → входить
  OBI сильно ПРОТИВ сигнала → подождать 1-2 минуты или skip

Это fine-tune, не основной сигнал. Не добавлять в confluence score напрямую.
```

---

## 15. Итоговая матрица микроструктурных правил

| Проблема | Источник | Решение для нашего бота |
|----------|----------|------------------------|
| HFT latency arbitrage | Flash Boys | Не актуально на 15M TF |
| Spoofing / quote fade | Flash Boys | OB из истории свечей, не ордербука |
| Adverse selection | Harris | PostOnly entry, ждём ретест OB |
| Queue position | Harris | GTC на OB = первые пришли в зону |
| Spread cost | Harris | Maker entry (PostOnly) = 0.02% vs 0.055% |
| SL slippage | Bybit mechanics | MarkPrice trigger, не LastPrice |
| Funding manipulation | Bybit specific | Фильтр funding rate >0.1%, избегать ±10 min |
| Price impact | TCA | Малый размер ($11K) = нулевой impact |
| Non-fill risk | Harris | ATR-адаптивное размещение лимита |
| Inventory overshoot | Harris | Буфер ниже OB.high с учётом ATR |

---

**Источники:**
- [Flash Boys Summary — ETNA Trading](https://www.etnasoft.com/flash-boys-in-a-nutshell/)
- [Flash Boys — Wikipedia](https://en.wikipedia.org/wiki/Flash_Boys)
- [Trading and Exchanges — Larry Harris (OUP)](https://global.oup.com/academic/product/trading-and-exchanges-9780195144703)
- [Limit Order Strategic Placement with Adverse Selection Risk — arXiv](https://arxiv.org/pdf/1610.00261)
- [Optimal trade execution in cryptocurrency markets — Digital Finance, Springer 2024](https://link.springer.com/article/10.1007/s42521-023-00103-y)
- [Order Book Liquidity on Crypto Exchanges — MDPI 2025](https://www.mdpi.com/1911-8074/18/3/124)
- [Bybit Maker/Taker Fee Structure](https://www.bybit.com/en/help-center/article/Trading-Fee-Structure)
- [Bybit USDT Perpetual Order Cost](https://www.bybit.com/en/help-center/article/Order-Cost-USDT-Contract)
- [Price Impact of Order Book Imbalance — Towards Data Science](https://towardsdatascience.com/price-impact-of-order-book-imbalance-in-cryptocurrency-markets-bf39695246f6/)
- [Glosten & Harris 1988 Spread Decomposition — Buffalo](https://www.acsu.buffalo.edu/~keechung/MGF743/Readings/B3%20Glosten%20and%20Harris,%201988%20JFE.pdf)
- [Flow Toxicity and Liquidity — Easley et al., NYU Stern](https://www.stern.nyu.edu/sites/default/files/assets/documents/con_035928.pdf)
- [Bybit Introduction to Funding Rate](https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate)
