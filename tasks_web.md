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
| 6.1 | Планировщик | `cron/scheduler.ts` — node-cron с 15-минутным циклом | ✅ |
| 6.2 | Утреннее уведомление | Проверка `morning_time` каждого клиента → отправка плана тренировки | ✅ |
| 6.3 | Вечерний опрос | Проверка: тренировка существовала + не выполнена + не пропущена → отправка poll в 20:00 | ✅ |
| 6.4 | Напоминание замеров | В `measurement_day` + `measurement_time` → отправка чеклиста замеров | ✅ |
| 6.5 | Дедупликация | Флаги в Supabase: `morning_sent`, `meas_sent`, `workout_completed`, `workout_skipped`, `workout_polled` | ✅ |
| 6.6 | Автовозобновление пауз | При наступлении `resume_date` → вызов `resumePlan()` | ✅ |
| 6.7 | Напоминание возобновления | За 2 дня до `resume_date` → уведомление "приготовьтесь" | ✅ |
| 6.8 | Timezone-aware логика | Корректный расчёт времени с учётом `client.timezone` | ✅ |

---

### Фаза 7: Продвинутое

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 7.1 | Паузы | `/pause` — запуск wizard: количество → причина → дата возобновления | ✅ |
| 7.2 | Возобновление | `/resume` — ручное возобновление + выбор стратегии (skip/shift/deload/rollback) | ✅ |
| 7.3 | Переиспользование plan-adjustment | Импорт `plan-adjustment.ts` из `web/src/lib/` для логики пауз | ✅ |
| 7.4 | Каталог программ | `/programs` — список активных программ из Supabase `programs` | ✅ |
| 7.5 | Покупка программы | Выбор программы → переход на страницу оплаты (будущее) | ✅ |
| 7.6 | Свободный чат | Пересылка сообщений coach ↔ client через Supabase `messages` | ✅ |
| 7.7 | Админ-команды | `/debug_today`, `recalcSchedule`, `generateCodes` — для тренера | ✅ |

---

### Фаза 8: Переход и выключение GAS

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 8.1 | Тестирование | Полное тестирование бота на отдельном токене | ✅ |
| 8.2 | Переключение webhook | Изменение `setWebhook` URL: Cloudflare Worker → Railway | ⏭️ skipped |
| 8.3 | Мониторинг | Наблюдение за работой 24-48 часов | ⏭️ skipped |
| 8.4 | Отключение GAS | Удаление триггера `sendDueMessages` в GAS | ⏭️ skipped |
| 8.5 | Деактивация Worker | Остановка Cloudflare Worker | ⏭️ skipped |
| 8.6 | Очистка | Удаление/архив GAS бота | ⏭️ skipped |

---

### Фаза 9: Улучшение UX и новые фичи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **9.1** | Миграция БД: purchase поля | Добавить в `clients`: `purchase_date TIMESTAMPTZ`, `purchased_program_id UUID REFERENCES programs(id)` | ✅ |
| **9.2** | Обновить типы | В `web/src/types/supabase.ts` добавить `purchase_date`, `purchased_program_id` в тип `clients.Row` | ✅ |
| **9.3** | Action `markPurchased` | В `web/src/app/clients/[id]/actions.ts`: валидация (нет программы → ок, есть → блок), установка `program_id`, `status: "active"`, `payment_status: "paid"`, `purchase_date: now()`, `purchased_program_id`, `access_start_date: now()`, `access_end_date: now() + duration_weeks`, генерация `connect_code` если нет `telegram_id`, уведомление клиенту в Telegram | ✅ |
| **9.4** | Модалка "Подтвердить покупку" | В `client-actions.tsx`: заменить кнопку "Отметить оплаченным" на "Подтвердить покупку", dropdown с выбором программы, валидация (если программа уже назначена → ошибка), после подтверждения → показать код подключения или уведомление | done |
| **9.5** | Обновить профиль клиента | В `client-profile.tsx`: показать `purchase_date`, `purchased_program_id` (название программы) в секции "Доступ и программа" | done |
| **9.6** | Обновить бота (минимально) | В `bot/src/handlers/menu.ts`: показать "Оплачено: {название программы}" если `purchased_program_id` | done |
| **9.7** | Fix фото из Supabase Storage | В `web/src/app/clients/[id]/_components/client-profile.tsx` и `photo-gallery.tsx`: добавить отображение фото через `storage_path` (Supabase Storage URL) если `drive_url = null` | ✅ |
| **9.8** | История замеров в боте | Новая команда `/my Measurements` или кнопка "История замеров" — показ последних 10 замеров с дельтами | ✅ |
| **9.9** | История фото в боте | Отправка последних фото (front/side/back) клиенту в чат по запросу | ✅ |
| **9.10** | История тренировок в боте | Новая команда `/mystats` — количество выполненных тренировок, пропусков, средний RPE за месяц | ✅ |
| **9.11** | UI создания клиента | Добавить форму "Добавить клиента" на `/clients` — имя, telegram_id (опционально), язык, timezone, статус оплаты | ✅ |
| **9.12** | UI редактирования клиента | Заменить заглушку "Редактировать" в `client-actions.tsx` на диалог редактирования: name, language, timezone, morning_time, measurement_time, measurement_day. Серверный экшен `updateClient` в `clients/[id]/actions.ts` с валидацией | ✅ |
| **9.13** | Исправление отключения клиента | `disableClient` должен очищать `program_id` при отключении, чтобы `markPurchased` не блокировал повторное подключение | ✅ |
| **9.14** | Кнопка смены статуса оплаты | Добавить кнопку "Снять оплату" / "Отметить оплаченным" в `client-actions.tsx` через `togglePayment`. Добавить `revalidatePath("/clients")` во все экшены для обновления списка | ✅ |

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

1. **P0**: Фазы 1-3 (инфраструктура + ядро + логирование) — бот работает ✅
2. **P1**: Фазы 4-5 (замеры + фото + чек-ины) — полный функционал ✅
3. **P2**: Фаза 6 (cron) — автоматизация ✅
4. **P3**: Фаза 7 (продвинутое) — паузы, чат, программы ✅
5. **P4**: Фаза 8 (переход) — выключение GAS
6. **P5**: Фаза 9 (улучшение UX) — покупка, фото, история, создание клиентов
   - **9.1-9.6**: Покупка программы (P0 внутри фазы)
   - **9.7**: Fix фото из Supabase Storage
   - **9.8-9.10**: История в боте
   - **9.11**: UI создания клиента

---

*Сгенерировано на основе анализа Code.gs (2344 строки), web/src/, и TASKS.md.*

---

## Фаза 10: Система тренировок на веб-платформе

### Контекст

Текущее состояние:
- Программы хранятся в Supabase (`programs.parsed_content` JSON)
- Веб-панель: read-only просмотр программ (accordion по неделям)
- Кнопка «Редактировать» → `/programs/[id]/edit` — **страницы нет**
- Публикация/назначение требуют `template_file_url` (.xlsx)
- Клиенты работают через Telegram бота
- Нет клиентского веб-портала

Цель:
- Тренер создаёт программу через промпт → AI генерирует JSON → заливает в Supabase
- Тренер проверяет и редактирует на вебе
- Клиент видит программу на вебе + Telegram
- Клиент логирует тренировки на вебе и в Telegram (общая база)

### Архитектурные решения

| Решение | Выбор |
|---------|-------|
| Хранение | Supabase как единый источник правды |
| Публикация | Без .xlsx, по `parsed_content` |
| Программы | Шаблоны + персональные — всё в `programs` |
| Редактор | Табличный, 3 уровня: Неделя → День → Упражнение |
| Клиентский портал | `/client/[token]`, магическая ссылка |
| Логирование (веб) | Карточки упражнений, детальное (подходы/повторы/вес/RPE) |
| Синхронизация | Общая база Supabase, Telegram ↔ Веб |
| База упражнений | Автокомплит + ручной ввод |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **10.1** | Миграция БД: тип программы | `ALTER TABLE programs ADD COLUMN type TEXT DEFAULT 'template'` + `client_id UUID REFERENCES clients(id)` + индексы | ✅ |
| **10.2** | Миграция БД: токены клиентов | Таблица `client_tokens` (client_id, token, expires_at) | ✅ |
| **10.3** | Обновить типы Supabase | Добавить `type`, `client_id` в `programs.Row` | ✅ |
| **10.4** | Разблокировка публикации | `toggleProgramStatus`: убрать requirement `template_file_url`, проверять `parsed_content` | ✅ |
| **10.5** | Разблокировка назначения | `assignToClient`: убрать requirement `template_file_url` | ✅ |
| **10.6** | Страница редактора | `/programs/[id]/edit` — server component, загрузка программы | ✅ |
| **10.7** | Server action: сохранение | `updateProgramContent(programId, content)` — валидация + запись в Supabase | ✅ |
| **10.8** | Компонент ProgramEditor | Табличный редактор: accordion по неделям → дни → таблица упражнений | pending |
| **10.9** | Автокомплит упражнений | Поиск из `exercises` + ручной ввод, debounced | pending |
| **10.10** | Типы редактора | `EditableParsedContent`, `EditableWeek`, `EditableDay`, `EditableExercise` | pending |
| **10.11** | Обновить program-detail | Убрать алерт «Шаблон не загружен», показать тип программы | pending |
| **10.12** | Server action: генерация токена | `generateClientToken(clientId)` — 6-символьный токен, сохранение в `client_tokens` | pending |
| **10.13** | Middleware: проверка токена | Маршруты `/client/[token]/*`, проверка валидности, редирект | pending |
| **10.14** | Layout клиентского портала | `/client/[token]/layout.tsx` — навигация, мини-дашборд | pending |
| **10.15** | Главная страница клиента | `/client/[token]/page.tsx` — приветствие, текущая неделя, навигация | pending |
| **10.16** | Просмотр программы | `/client/[token]/program/page.tsx` — недели, дни, упражнения | pending |
| **10.17** | Логирование тренировки | Карточки упражнений: подходы/повторы/вес/RPE, кнопка «Завершить» | pending |
| **10.18** | Server action: логирование | `logWorkoutFromWeb(clientId, date, exercises[])` — запись в `workout_logs` | pending |
| **10.19** | Замеры тела | `/client/[token]/measurements/page.tsx` — форма + история + графики | pending |
| **10.20** | Фото прогресса | `/client/[token]/photos/page.tsx` — загрузка + галерея | pending |
| **10.21** | Чек-ин | `/client/[token]/checkin/page.tsx` — форма (wellbeing, sleep, stress, adherence) | pending |
| **10.22** | Кнопка «Ссылка для клиента» | В `client-profile.tsx`: генерация токена + отображение ссылки | pending |
| **10.23** | Бот: команда `/myweb` | Показ ссылки на клиентский портал | pending |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/..._add_program_type.sql` | Новый |
| `supabase/migrations/..._create_client_tokens.sql` | Новый |
| `web/src/types/supabase.ts` | Изменение (type, client_id) |
| `web/src/app/programs/[id]/actions.ts` | Изменение (убрать .xlsx check) |
| `web/src/app/programs/[id]/edit/page.tsx` | Новый |
| `web/src/app/programs/[id]/edit/actions.ts` | Новый |
| `web/src/app/programs/[id]/edit/_components/program-editor.tsx` | Новый |
| `web/src/app/programs/[id]/edit/_components/exercise-autocomplete.tsx` | Новый |
| `web/src/app/programs/[id]/_components/program-detail.tsx` | Изменение |
| `web/src/app/clients/[id]/actions.ts` | Изменение (generateClientToken) |
| `web/src/app/clients/[id]/_components/client-profile.tsx` | Изменение (кнопка ссылки) |
| `web/src/middleware.ts` | Изменение (client routes) |
| `web/src/app/client/[token]/layout.tsx` | Новый |
| `web/src/app/client/[token]/page.tsx` | Новый |
| `web/src/app/client/[token]/program/page.tsx` | Новый |
| `web/src/app/client/[token]/measurements/page.tsx` | Новый |
| `web/src/app/client/[token]/photos/page.tsx` | Новый |
| `web/src/app/client/[token]/checkin/page.tsx` | Новый |
| `web/src/lib/program-editor-types.ts` | Новый |
| `bot/src/handlers/menu.ts` | Изменение (/myweb) |
