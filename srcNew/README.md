# srcNew — изолированный слой нового бота

Это **новая, независимая** реализация инфраструктурного слоя торгового бота. Она разрабатывается
рядом с боевым `src/` и **никак не влияет** на запущенный лайв.

## Гарантии изоляции

- **Не импортирует `src/`.** Ни один файл в `srcNew/` не ссылается на боевой код. Проверяется
  grep'ом в ревью и тайпчеком отдельным `srcNew/tsconfig.json`.
- **Не входит в боевую сборку.** Корневой `tsconfig.json` имеет `rootDir: ./src` и `include: ["src/**/*"]`,
  поэтому `srcNew/` не попадает ни в `npm run build`, ни в `npm run typecheck`.
- **Не трогает живые аккаунты.** Загрузчик аккаунтов (`config/accounts.ts`) читает **только**
  `srcNew/config/accounts.json` (отдельный файл, по умолчанию отсутствует). Корневой боевой
  `accounts.json` не читается и не пишется. Файл `srcNew/config/accounts.json` уже покрыт
  `.gitignore` (правило `accounts.json`).
- **Только чтение `.env`.** Конфиги читают переменные окружения из общего `.env` (ключ CG, токен
  Telegram). Чтение env не затрагивает лайв.

## Что внутри (текущий этап)

Три клиента + общее ядро. Стратегия/исполнение **намеренно не реализованы** — это следующий этап.

```
srcNew/
  core/        env · logger · errors · retry · rate-limiter · http   (общий транспорт)
  config/      accounts (изолированный загрузчик) · clients (фабрики конфигов) · accounts.example.json
  clients/
    coinglass/ CoinglassClient — типизированный клиент CG API v4 (Standard-план)
    bybit/     BybitAccount (один ключ) + BybitMultiClient (бродкаст на N аккаунтов через Promise.all)
    telegram/  TelegramClient — бродкаст в несколько чатов, HTML
  examples/    cg-smoke · bybit-smoke (только ping) · tg-smoke
  docs/        cg-api-reference.md · cg-endpoints.json · ARCHITECTURE.md
  index.ts     barrel-экспорты
```

## Запуск (вручную оператором)

```bash
# CG: read-only smoke (нужен COINGLASS_API_KEY в .env)
npx tsx srcNew/examples/cg-smoke.ts

# Bybit: ping (нужен srcNew/config/accounts.json — скопировать из accounts.example.json)
cp srcNew/config/accounts.example.json srcNew/config/accounts.json   # затем вписать ключи
npx tsx srcNew/examples/bybit-smoke.ts

# Telegram: тестовое сообщение (нужны TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)
npx tsx srcNew/examples/tg-smoke.ts

# Тайпчек изолированного слоя
npx tsc --noEmit -p srcNew/tsconfig.json
```

## Paper-контур (форвард-тест стратегии)

Стратегия v5 (`cgSlowFade` + BTC-aware альты) валидирована бэктестами и готовится к лайву через
paper-форвард. Один тик контура:

```bash
npx tsx srcNew/live/cycle.ts                 # с Telegram-отчётами
npx tsx srcNew/live/cycle.ts --no-telegram   # тихий режим
```

- Решения принимаются на закрытии 4h-бара (+60с гэп), вход виртуальной лимиткой; исполнение
  эмулируется на закрытых минутках Bybit **тем же кодом** (`backtest/execution-sim.ts`), что и
  в бэктесте.
- Состав/риски — зеркало валидированного портфеля: BTC 1% (обе ноги) + ETH btc-trend-S 0.5% +
  SOL btc-signal 0.5% + XRP btc-signal-S 0.5%; cap-4; CD 12h после стопа / 4h после тейка
  (`live/config.ts`).
- Состояние: `srcNew/live/state/paper-state.json` (gitignored). Сброс = удалить файл.
- Расписание: оператор ставит cron на каждые 5 минут (контур сам определяет 4h-границы,
  внеплановые тики дешёвые: только мониторинг открытых ордеров).

**Миграция в лайв (следующий этап):** заменить paper-исполнение на `BybitExecutionBroker`
поверх `BybitMultiClient` (бродкаст на изолированные ключи), серверный SL при входе,
edit-never-cancel; стратегии и market-data не меняются.

## Переменные окружения

| Переменная | Назначение | Дефолт |
|---|---|---|
| `COINGLASS_API_KEY` | ключ CG API | — (обязателен для CG) |
| `COINGLASS_BASE_URL` | база CG | `https://open-api-v4.coinglass.com/api` |
| `COINGLASS_REQUESTS_PER_MINUTE` | пейсинг под план | `270` (Standard = 300) |
| `COINGLASS_TIMEOUT_MS` | таймаут запроса | `15000` |
| `TELEGRAM_BOT_TOKEN` | токен бота | — (обязателен для TG) |
| `TELEGRAM_CHAT_ID` | список chatId через запятую | — |
| `TELEGRAM_OPERATOR_CHAT_ID` | чат оператора | первый из `TELEGRAM_CHAT_ID` |
| `LOG_LEVEL` | `debug`/`info`/`warn`/`error` | `info` |
