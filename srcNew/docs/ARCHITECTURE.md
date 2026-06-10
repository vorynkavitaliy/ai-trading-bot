# srcNew — архитектура слоя клиентов

Статус: **этап 1** — инфраструктура (три клиента + ядро). Стратегия и исполнение вне scope.

## Принципы

- **Изоляция от лайва** (см. `../README.md` → «Гарантии изоляции»).
- **SOLID / KISS / DRY**, по умолчанию без комментариев (контракт `.claude/TEAM.md §4`).
- **Dependency Inversion**: клиенты получают конфиг через конструктор, а не читают env в точке
  использования. Фабрики `config/clients.ts` собирают конфиг из env на границе.
- **Никаких новых зависимостей**: используются только уже установленные `bybit-api`, `telegraf`,
  `dotenv` и встроенный `fetch` (Node).

## Слои

```
            ┌─────────────────────────────────────────────┐
 examples/  │ cg-smoke · bybit-smoke · tg-smoke (CLI)      │
            └───────────────┬─────────────────────────────┘
                            ▼
            ┌─────────────────────────────────────────────┐
 clients/   │ CoinglassClient   BybitMultiClient   TelegramClient │
            └───────┬───────────────┬──────────────────┬───┘
                    ▼               ▼                  ▼
            ┌─────────────────────────────────────────────┐
 config/    │ clients.ts (фабрики)        accounts.ts (loader) │
            └───────────────┬─────────────────────────────┘
                            ▼
            ┌─────────────────────────────────────────────┐
 core/      │ http · rate-limiter · retry · errors · env · logger │
            └─────────────────────────────────────────────┘
```

## Ядро (`core/`)

| Модуль | Ответственность |
|---|---|
| `env.ts` | Загрузка `.env` (идемпотентно), `requireEnv/optionalEnv/intEnv/listEnv`. |
| `errors.ts` | Типизированные ошибки: `ConfigError`, `HttpError`, `RateLimitError`, `TimeoutError`, `ApiError`. |
| `logger.ts` | Структурный JSON-логгер, уровень из `LOG_LEVEL`, scoped-инстансы. |
| `retry.ts` | `RetryPolicy` + `ExponentialBackoff` (предикат `isRetryable` инъецируется) + `withRetry`. |
| `rate-limiter.ts` | Пейсер по минимальному интервалу; `RateLimiter.perMinute(n)` под план CG. |
| `http.ts` | `HttpClient` поверх `fetch`: query-параметры, таймаут (`AbortController`), retry, rate-limit, нормализация ошибок. |

`HttpClient` — общий транспорт; используется CG-клиентом. Bybit идёт через SDK `bybit-api`
(собственный HTTP + подпись), Telegram — через `telegraf`.

## CoinglassClient

- База `https://open-api-v4.coinglass.com/api`, заголовок `CG-API-KEY`.
- Конверт ответа `{ code, msg, data }`; success-код `'0'` (а также `0` / `'00000'`). Любой иной код →
  `ApiError`.
- Rate-limit: `RateLimiter.perMinute(270)` — план **Standard** даёт 300 req/min, держим запас.
- Retry: на `429` / таймаут / сетевые сбои / сообщения rate-limit.
- `request<T>(path, params)` — generic-доступ к любому эндпоинту. Поверх него — типизированные
  доменные методы (см. `cg-api-reference.md` и `cg-endpoints.json`), сгруппированные по доменам
  (futures OI, funding, long/short, liquidation, orderbook, indicators, spot и т.д.). Методы покрывают
  то, что доступно на Standard; недоступные на плане эндпоинты в типизированный API не выносятся,
  но достижимы через `request<T>` при апгрейде плана.

## Bybit: мульти-аккаунт через Promise.all

- `BybitAccount` — обёртка над одним `RestClientV5` (один ключ). Read + write методы, каждый с retry и
  проверкой `retCode === 0` (иначе `ApiError`). Типы параметров выводятся прямо из SDK
  (`Parameters<RestClientV5['submitOrder']>[0]` и т.п.) — обёртки типобезопасны к версии SDK.
- `BybitMultiClient` — держит N аккаунтов. Ядро — `broadcast(op)`: запускает `op` на **всех**
  аккаунтах конкурентно через `Promise.all`, каждый результат изолирован (`AccountResult` с
  `ok/value/error`) — сбой одного ключа не валит остальные. Готовые бродкасты: `pingAll`,
  `equities`, `placeOrderAll`, `cancelAllOrdersAll`, `setLeverageAll`.
- Это повторяет боевой инвариант («сделки транслируются на каждый суб-ключ через Promise.all»), но
  на **изолированном** наборе ключей.

## TelegramClient

- `telegraf`, `parse_mode: 'HTML'`, экранирование по умолчанию (`escapeHtml`), бродкаст по списку
  `chatIds` (одна неудача не валит остальные), `sendToOperator` для оператора.

## Обработка ошибок

- Валидация на границах (ответы биржи/CG, конфиг-файлы). Внутренние чистые функции типам доверяют.
- Никаких «тихих» catch и маскирующих фолбэков на отсутствующих полях API.

## Что дальше (следующие этапы, НЕ в этом scope)

- Доменные модели (свечи, позиции, сигналы), фичестор, стратегия, бэктест-движок, исполнение,
  риск-гард — поверх этих клиентов.
