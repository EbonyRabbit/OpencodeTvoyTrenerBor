# TASKS_WEB.md — План миграции Telegram-бота на Node.js

---

## Цель

Перенести Telegram-бота с Google Apps Script (GAS) на Node.js/TypeScript, чтобы Supabase стал единственным источником правды. GAS бот продолжает работать до полного завершения миграции.

---

## Архитектура

### Текущая

```
Telegram → Cloudflare Worker → GAS (Code.gs) → Google Sheets
                                                   ✗
                                              Supabase DB
                                                   ↑
                                            Web-панель (Next.js)
```

### Целевая

```
Telegram → Railway (Node.js/grammY) → Supabase DB
                                           ↑
                                    Web-панель (Next.js)
```

---

## Стек

| Компонент | Выбор | Обоснование |
|-----------|-------|-------------|
| Bot framework | **grammY** | TypeScript-first, modern, webhook + long-polling, plugin system |
| Runtime | **Node.js 20+** | LTS, совместимость со всеми библиотеками |
| БД | **Supabase** (PostgreSQL) | Уже настроен, RLS, service-role клиент |
| Cron | **node-cron** | Внутри процесса, достаточно для 15-минутного цикла |
| Фото | **Supabase Storage** | Замена Google Drive |
| Хранение состояний | **Supabase** (таблица `bot_state`) | Единый источник правды |
| Деплой | **Railway** | Long-running process, Docker, простая настройка |
| Локализация | **i18next** | ru/en, уже есть паттерн `client.language` |

---

## Структура проекта

```
OpenCode/
├── web/                          ← существующая Next.js (без изменений)
├── bot/                          ← НОВЫЙ Telegram-бот
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── .env.local
│   ├── src/
│   │   ├── index.ts              # Точка входа (webhook/server + cron)
│   │   ├── bot.ts                # Экземпляр grammY + регистрация хендлеров
│   │   ├── config.ts             # Конфигурация (env vars, константы)
│   │   ├── lib/
│   │   │   ├── supabase-admin.ts # Service-role клиент (копия из web/)
│   │   │   ├── types.ts          # Типы БД (копия из web/src/types/)
│   │   │   └── telegram.ts       # Обёртка Telegram API (file download и т.д.)
│   │   ├── handlers/
│   │   │   ├── start.ts          # /start — приветствие, подключение по коду
│   │   │   ├── menu.ts           # /menu, /myprogram
│   │   │   ├── workout.ts        # /today, просмотр/логирование упражнений
│   │   │   ├── checkin.ts        # /checkin — 7-шаговый опрос
│   │   │   ├── measurements.ts   # Замеры тела — 14 шагов
│   │   │   ├── photos.ts         # Загрузка фото (front/side/back/composition)
│   │   │   ├── settings.ts       # /settings — настройки уведомлений
│   │   │   ├── programs.ts       # /programs — каталог программ
│   │   │   ├── pause.ts          # /pause, /resume
│   │   │   └── chat.ts           # Свободный чат (coach ↔ client)
│   │   ├── cron/
│   │   │   ├── scheduler.ts      # Планировщик (node-cron, 15-мин цикл)
│   │   │   ├── morning.ts        # Утреннее уведомление о тренировке
│   │   │   ├── evening.ts        # Вечерний опрос "тренировался?"
│   │   │   ├── measurements.ts   # Напоминание замеров в measurement_day
│   │   │   └── resume.ts         # Автовозобновление пауз + напоминания
│   │   ├── state/
│   │   │   └── machine.ts        # Машин состояний (Supabase-backed)
│   │   └── utils/
│   │       ├── i18n.ts           # Локализация (ru/en)
│   │       ├── timezone.ts       # Timezone-aware утилиты
│   │       └── dedup.ts          # Дедупликация уведомлений
│   └── .env.example
└── supabase/
    └── migrations/
        └── 20260629000000_bot_tables.sql  # НОВАЯ миграция
```

---

## Задачи по фазам

---

### Фаза 1: Инфраструктура и базовая настройка

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 1.1 | Инициализация проекта `bot/` | Создать `bot/package.json` с зависимостями: `grammy`, `node-cron`, `@supabase/supabase-js`, `date-fns-tz`, `i18next` | ✅ |
| 1.2 | TypeScript конфиг | Создать `bot/tsconfig.json` (target: ES2022, module: NodeNext, strict) | ✅ |
| 1.3 | Конфигурация | Создать `bot/src/config.ts` — чтение env vars, экспорт объекта конфигурации | ✅ |
| 1.4 | Supabase клиент | Скопировать `supabase-admin.ts` из `web/src/lib/` в `bot/src/lib/` | ✅ |
| 1.5 | Типы БД | Скопировать `types/supabase.ts` из `web/src/types/` в `bot/src/lib/types.ts` | ✅ |
| 1.6 | Миграция БД: `bot_state` | Создать таблицу для состояний разговоров (заменяет Bot State sheet) | ✅ |
| 1.7 | Миграция БД: `bot_logs` | Создать таблицу логов бота (заменяет Bot Logs sheet) | ✅ |
| 1.8 | Миграция БД: `bot_schedule` | Создать таблицу отложенных напоминаний (заменяет Bot Schedule sheet) | ✅ |
| 1.9 | .env.local | Настроить переменные окружения (BOT_TOKEN, SUPABASE_URL, SERVICE_ROLE_KEY, COACH_CHAT_ID) | ✅ |
| 1.10 | Базовый entry point | Создать `bot/src/index.ts` — запуск grammY в режиме webhook | ✅ |
| 1.11 | Dockerfile | Создать Dockerfile для деплоя на Railway | ✅ |
| 1.12 | Тест запуска | Убедиться, что бот стартует и отвечает на `ping` | ✅ |

---

### Фаза 2: Ядро бота — команды и навигация

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 2.1 | Базовый `bot.ts` | Экземпляр `Bot`, middleware для логирования, обработка ошибок | ✅ |
| 2.2 | Поиск клиента | Функция `findClientByTelegramId(telegramId)` — запрос в Supabase `clients` | ✅ |
| 2.3 | Команда `/start` | Приветствие: активные клиенты → меню; неактивные → "подключиться по коду"; новые → "купить программу" | ✅ |
| 2.4 | Подключение по коду | Ввод 8-символьного кода → связка `telegram_id` с клиентом в Supabase | ✅ |
| 2.5 | Команда `/menu` | Адаптивный список команд на основе `status` и `payment_status` клиента | ✅ |
| 2.6 | Команда `/myprogram` | Показ текущей программы, ссылки на spreadsheet (если есть), кода подключения | ✅ |
| 2.7 | Машин состояний | Модуль `state/machine.ts`: `getState`, `setState`, `clearState` (Supabase `bot_state`) | ✅ |
| 2.8 | Роутинг callback | Обработка inline-кнопок: `today_open`, `exercise_log:*`, `exercise_skip:*`, `skip_workout`, и т.д. | ✅ |
| 2.9 | Локализация | Утилита `i18n.ts` — выбор языка на основе `client.language` | ✅ |

---

### Фаза 3: Просмотр и логирование тренировок

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 3.1 | Определение тренировки | Функция `getTodayWorkout(client)` — определение дня недели → поиск в `program_schedule` → чтение плана | ✅ |
| 3.2 | Чтение плана тренировки | Функция `getWorkoutPlan(client, scheduleWeek)` — чтение из Supabase или legacy spreadsheet | ✅ |
| 3.3 | Показ упражнения | Кнопки: "Выполнил" (логирование), "Пропустить", навигация по упражнениям | ✅ |
| 3.4 | Wizard логирования | 5 шагов: подходы → повторы → вес → RPE → комментарий | ✅ |
| 3.5 | Запись результата | INSERT в `workout_logs` (Supabase): client_id, date, week, exercise, sets, reps, weight, rpe, comment | ✅ |
| 3.6 | Пропуск тренировки | Логирование пропуска с причиной | ✅ |
| 3.7 | Отображение прогресса | Показ выполненных упражнений за сегодня | ✅ |
| 3.8 | Evening poll | Ответ "да/нет/перенести" на вечерний опрос | ✅ |

---

### Фаза 4: Замеры тела и фото

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 4.1 | Начало замеров | Команда или кнопка → запуск 14-шагового wizard | ✅ |
| 4.2 | Wizard замеров | 14 шагов: вес → талия → живот → грудь → бёдра → ягодицы → левое бедро → правое бедро → левая рука → правая рука → % жира → мышечная масса → висцеральный жир → комментарий | ✅ |
| 4.3 | Запись замеров | INSERT в `measurements` (Supabase) | ✅ |
| 4.4 | Показ динамики | Последние 4 замера: дельта веса, талии, живота, груди, бёдер, % жира | ✅ |
| 4.5 | Загрузка фото | Приём фото от пользователя → скачивание через Telegram API → загрузка в Supabase Storage | ✅ |
| 4.6 | Метаданные фото | INSERT в `photos` (Supabase): client_id, week, type (front/side/back/composition), storage_path | ✅ |
| 4.7 | Прогресс-фото | Просмотр последних фото в боте (отправка обратно в чат) | ✅ |

---

### Фаза 5: Чек-ины

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 5.1 | Начало чек-ина | `/checkin` → запуск 7-шагового опроса | ✅ |
| 5.2 | Wizard чек-ина | 7 шагов: самочувствие(1-10) → сон(часы) → стресс(1-10) → adherence(0-100%) → пропущенные(кол-во) → жалобы(текст) → комментарий | ✅ |
| 5.3 | Запись чек-ина | INSERT в `checkins` (Supabase) | ✅ |
| 5.4 | Уведомление коучу | Отправка сводки чек-ина коучу в Telegram | ✅ |

---

### Фаза 6: Cron и напоминания

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 6.1 | Планировщик | `cron/scheduler.ts` — node-cron с 15-минутным циклом | pending |
| 6.2 | Утреннее уведомление | Проверка `morning_time` каждого клиента → отправка плана тренировки | pending |
| 6.3 | Вечерний опрос | Проверка: тренировка существовала + не выполнена + не пропущена → отправка poll в 20:00 | pending |
| 6.4 | Напоминание замеров | В `measurement_day` + `measurement_time` → отправка чеклиста замеров | pending |
| 6.5 | Дедупликация | Флаги в Supabase: `morning_sent`, `meas_sent`, `workout_completed`, `workout_skipped`, `workout_polled` | pending |
| 6.6 | Автовозобновление пауз | При наступлении `resume_date` → вызов `resumePlan()` | pending |
| 6.7 | Напоминание возобновления | За 2 дня до `resume_date` → уведомление "приготовьтесь" | pending |
| 6.8 | Timezone-aware логика | Корректный расчёт времени с учётом `client.timezone` | pending |

---

### Фаза 7: Продвинутое

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 7.1 | Паузы | `/pause` — запуск wizard: количество → причина → дата возобновления | pending |
| 7.2 | Возобновление | `/resume` — ручное возобновление + выбор стратегии (skip/shift/deload/rollback) | pending |
| 7.3 | Переиспользование plan-adjustment | Импорт `plan-adjustment.ts` из `web/src/lib/` для логики пауз | pending |
| 7.4 | Каталог программ | `/programs` — список активных программ из Supabase `programs` | pending |
| 7.5 | Покупка программы | Выбор программы → переход на страницу оплаты (будущее) | pending |
| 7.6 | Свободный чат | Пересылка сообщений coach ↔ client через Supabase `messages` | pending |
| 7.7 | Админ-команды | `/debug_today`, `recalcSchedule`, `generateCodes` — для тренера | pending |

---

### Фаза 8: Переход и выключение GAS

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 8.1 | Тестирование | Полное тестирование бота на отдельном токене | pending |
| 8.2 | Переключение webhook | Изменение `setWebhook` URL: Cloudflare Worker → Railway | pending |
| 8.3 | Мониторинг | Наблюдение за работой 24-48 часов | pending |
| 8.4 | Отключение GAS | Удаление триггера `sendDueMessages` в GAS | pending |
| 8.5 | Деактивация Worker | Остановка Cloudflare Worker | pending |
| 8.6 | Очистка | Удаление/архив GAS бота | pending |

---

## Новые таблицы Supabase

```sql
-- Состояние разговоров (заменяет Bot State sheet)
CREATE TABLE bot_state (
  telegram_id   BIGINT PRIMARY KEY,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  action        TEXT,
  step          TEXT,
  data          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_bot_state
  BEFORE UPDATE ON bot_state
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Логи бота (заменяет Bot Logs sheet)
CREATE TABLE bot_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT,
  telegram_id BIGINT,
  action      TEXT NOT NULL,
  status      TEXT DEFAULT 'ok',
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_logs_created_at ON bot_logs(created_at DESC);
CREATE INDEX idx_bot_logs_client_id ON bot_logs(client_id);

-- Отложенные напоминания (заменяет Bot Schedule sheet)
CREATE TABLE bot_schedule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- 'measurement_reminder', 'resume_reminder'
  scheduled   TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'done'
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_schedule_scheduled ON bot_schedule(scheduled) WHERE status = 'pending';
CREATE INDEX idx_bot_schedule_client ON bot_schedule(client_id);

-- Дедупликация уведомлений (заменяет Script Properties флаги)
CREATE TABLE bot_dedup (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,  -- 'morning_{client_id}_{date}'
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_dedup_key ON bot_dedup(key);
CREATE INDEX idx_bot_dedup_expires ON bot_dedup(expires_at);

-- RLS
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access to authenticated" ON bot_state FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_logs FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_schedule FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_dedup FOR ALL TO authenticated USING (true);

-- GRANT
GRANT ALL ON bot_state TO service_role;
GRANT ALL ON bot_logs TO service_role;
GRANT ALL ON bot_schedule TO service_role;
GRANT ALL ON bot_dedup TO service_role;
```

---

## Миграция данных ( GAS → Supabase )

| GAS хранение | Supabase таблица | Статус |
|-------------|-----------------|--------|
| `Bot Clients` sheet | `clients` | ✅ Таблица уже есть |
| `Bot State` sheet | `bot_state` | 🔨 Создать (Фаза 1) |
| `Bot Schedule` sheet | `bot_schedule` | 🔨 Создать (Фаза 1) |
| `Bot Logs` sheet | `bot_logs` | 🔨 Создать (Фаза 1) |
| Script Properties (флаги) | `bot_dedup` | 🔨 Создать (Фаза 1) |
| `Bot Programs` sheet | `programs` | ✅ Таблица уже есть |
| `Exercise Results Raw` sheet | `workout_logs` | ✅ Таблица уже есть |
| `Check-ins` sheet | `checkins` | ✅ Таблица уже есть |
| `Прогресс тела` sheet | `measurements` | ✅ Таблица уже есть |
| `Photo Uploads` + Google Drive | `photos` + Supabase Storage | ✅ `photos` уже есть |
| Per-client spreadsheets (W1-W12) | Программы в `programs.parsed_content` | ✅ Данные уже в Supabase |

---

## Переиспользуемый код из web/

| Файл | Путь в web/ | Действие |
|------|-------------|----------|
| `supabase-admin.ts` | `web/src/lib/supabase-admin.ts` | Скопировать (12 строк) |
| `types/supabase.ts` | `web/src/types/supabase.ts` | Скопировать (283 строки) |
| `plan-adjustment.ts` | `web/src/lib/plan-adjustment.ts` | Импортировать напрямую |
| `program-utils.ts` | `web/src/lib/program-utils.ts` | Импортировать напрямую |
| `clients.ts` | `web/src/lib/clients.ts` | Импортировать типы |

---

## Переменные окружения

```bash
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...  # Secret token для проверки вебхуков

# Supabase
SUPABASE_URL=http://127.0.0.1:54321  # или production URL
SUPABASE_SERVICE_ROLE_KEY=...

# Coach
COACH_CHAT_ID=...  # Telegram ID тренера для уведомлений

# App
NODE_ENV=development
PORT=3001
WEBHOOK_PATH=/webhook
```

---

## Деплой

### Railway

1. Создать проект на Railway
2. Подключить GitHub репозиторий
3. Настроить service из `bot/` директории
4. Добавить env vars
5. Railway автоматически соберёт Dockerfile и задеплоит

### Webhook URL

```
Production: https://your-bot.up.railway.app/webhook
Dev:        ngrok http 3001  (для тестирования локально)
```

---

## Приоритеты

1. **P0**: Фазы 1-3 (инфраструктура + ядро + логирование) — бот работает
2. **P1**: Фазы 4-5 (замеры + фото + чек-ины) — полный функционал
3. **P2**: Фаза 6 (cron) — автоматизация
4. **P3**: Фаза 7 (продвинутое) — паузы, чат, программы
5. **P4**: Фаза 8 (переход) — выключение GAS

---

*Сгенерировано на основе анализа Code.gs (2344 строки), web/src/, и TASKS.md.*
