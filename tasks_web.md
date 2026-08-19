# TASKS_WEB.md — План миграции Telegram-бота на Node.js

> **🔴 P0 (следующие задачи):**
> — нет активных P0 задач

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
Telegram → Render (Node.js/grammY) → Supabase DB
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
| Деплой | **Render** | Long-running process, Docker, простая настройка |
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
| 1.9 | .env.local | Настроить переменные окружения (TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COACH_CHAT_ID) | ✅ |
| 1.10 | Базовый entry point | Создать `bot/src/index.ts` — запуск grammY в режиме webhook | ✅ |
| 1.11 | Dockerfile | Создать Dockerfile для деплоя бота | ✅ |
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
| 8.2 | Переключение webhook | Изменение `setWebhook` URL: Cloudflare Worker → Render | ⏭️ skipped (фактически уже на Render, см. 12.12) |
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
CLIENT_PORTAL_URL=https://your-web-domain.com  # клиентский портал (команда /myweb)
```

---

## Деплой

### Render

1. Создать проект на Render (Web Service)
2. Подключить GitHub репозиторий
3. Настроить service из `bot/` директории (Dockerfile)
4. Добавить env vars (включая `CLIENT_PORTAL_URL`)
5. Render автоматически соберёт Dockerfile и задеплоит

### Webhook URL

```
Production: https://tvoi-trener-bot.onrender.com/webhook  (уже активен)
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
| **10.8** | Компонент ProgramEditor | Табличный редактор: accordion по неделям → дни → таблица упражнений | ✅ |
| **10.9** | Автокомплит упражнений | Поиск из `exercises` + ручной ввод, debounced | ✅ |
| **10.10** | Типы редактора | `EditableParsedContent`, `EditableWeek`, `EditableDay`, `EditableExercise` | ✅ |
| **10.11** | Обновить program-detail | Убрать алерт «Шаблон не загружен», показать тип программы | ✅ |
| **10.12** | Server action: генерация токена | `generateClientToken(clientId)` — 6-символьный токен, сохранение в `client_tokens` | ✅ |
| **10.13** | Middleware: проверка токена | Маршруты `/client/[token]/*`, проверка валидности, редирект | ✅ |
| **10.14** | Layout клиентского портала | `/client/[token]/layout.tsx` — навигация, мини-дашборд | ✅ |
| **10.15** | Главная страница клиента | `/client/[token]/page.tsx` — приветствие, текущая неделя, навигация | ✅ |
| **10.16** | Просмотр программы | `/client/[token]/program/page.tsx` — недели, дни, упражнения | ✅ |
| **10.17** | Логирование тренировки | Карточки упражнений: подходы/повторы/вес/RPE, кнопка «Завершить» | ✅ |
| **10.18** | Server action: логирование | `logWorkoutFromWeb(clientId, date, exercises[])` — запись в `workout_logs` | ✅ |
| **10.19** | Замеры тела | `/client/[token]/measurements/page.tsx` — форма + история + графики | ✅ |
| **10.20** | Фото прогресса | `/client/[token]/photos/page.tsx` — загрузка + галерея | ✅ |
| **10.21** | Чек-ин | `/client/[token]/checkin/page.tsx` — форма (wellbeing, sleep, stress, adherence) | ✅ |
| **10.22** | Кнопка «Ссылка для клиента» | В `client-profile.tsx`: генерация токена + отображение ссылки | ✅ |
| **10.23** | Бот: команда `/myweb` | Показ ссылки на клиентский портал | ✅ |

| **10.24** | **Настройки уведомлений (клиентский портал)** | `/client/[token]/settings` — клиент сам редактирует время тренировки, время замеров, день замеров, часовой пояс (как в Telegram `/settings`). Server action `updateClientSettings` в `client/[token]/actions.ts` | ✅ |
| **10.25** | **Middleware (proxy.ts → middleware.ts)** | Next.js 16 переименовал `middleware.ts` → `proxy.ts`. Файл уже называется `proxy.ts` с правильным экспортом, задача выполнена. | ✅ |

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
| `web/src/app/client/[token]/layout.tsx` | Новый + изменение (добавить "Настройки" в NAV_ITEMS) |
| `web/src/app/client/[token]/page.tsx` | Новый |
| `web/src/app/client/[token]/program/page.tsx` | Новый |
| `web/src/app/client/[token]/measurements/page.tsx` | Новый |
| `web/src/app/client/[token]/photos/page.tsx` | Новый |
| `web/src/app/client/[token]/checkin/page.tsx` | Новый |
| `web/src/app/client/[token]/actions.ts` | Изменение (+ `updateClientSettings`) |
| `web/src/app/client/[token]/settings/page.tsx` | **Новый** |
| `web/src/app/client/[token]/settings/settings-form.tsx` | **Новый** |
| `web/src/lib/program-editor-types.ts` | Новый |
| `bot/src/handlers/menu.ts` | Изменение (/myweb) |

---

## Фаза 11: Миграция фотохранилища на Cloudflare R2

### Контекст

Текущее состояние:
- Фото хранятся в Supabase Storage (`client-photos` bucket)
- Путь: `clients/{clientId}/week{N}_{date}/{type}.{ext}`
- Upload: бот (Telegram → Supabase Storage) + веб (file upload → Supabase Storage)
- Download: signed URLs через `supabase.storage.from("client-photos").createSignedUrl()`
- Legacy: `drive_url` (Google Drive) — не используется, fallback только для старых данных
- Лимиты Supabase Storage: 1 GB free, далее платно

Проблема:
- Supabase Storage free-план ограничен (1 GB)
- Progress-фото весят ~500KB-2MB каждое, ~3-4 фото/клиент/неделю
- При масштабировании (>50 клиентов) Supabase Storage станет узким местом

Цель:
- Миграция на Cloudflare R2 (10 GB бесплатно, без egress fees)
- S3-совместимый API — минимальные изменения в коде
- Сохранить текущую логику signed URLs
- Миграция существующих фото без потерь

### Архитектурные решения

| Решение | Выбор |
|---------|-------|
| Хранилище | Cloudflare R2 |
| SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| Bucket | `client-photos` (тот же name, другой провайдер) |
| Путь | `clients/{clientId}/week{N}_{date}/{type}.{ext}` (без изменений) |
| Signed URLs | `getSignedUrl()` из `@aws-sdk/s3-request-presigner` |
| Migrate script | Скрипт миграции: download from Supabase → upload to R2 |
| Env vars | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **11.1** | Установка SDK | `npm install @aws-sdk/client-s2 @aws-sdk/s3-request-presigner` в `web/` и `bot/` | ⏭️ skipped |
| **11.2** | Утилита R2-клиента | Создать `lib/r2.ts` — функция `getR2Client()` и `getR2SignedUrl(key, expiresIn)` | ⏭️ skipped |
| **11.3** | Обновить env vars | Добавить `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` в `.env.local` и `.env.example` | ⏭️ skipped |
| **11.4** | Обновить bot upload | В `bot/src/lib/photo-utils.ts`: заменить Supabase Storage upload → R2 PutObjectCommand | ⏭️ skipped |
| **11.5** | Обновить bot download | В `bot/src/lib/photo-utils.ts`: заменить `createSignedUrl()` → R2 `getSignedUrl()` | ⏭️ skipped |
| **11.6** | Обновить web upload | В `web/src/app/client/[token]/actions.ts`: заменить Supabase Storage upload → R2 PutObjectCommand | ⏭️ skipped |
| **11.7** | Обновить resolvePhotoUrls | В `web/src/lib/photos.ts`: заменить `supabase.storage.createSignedUrl()` → R2 `getSignedUrl()` | ⏭️ skipped |
| **11.8** | Обновить admin photo pages | В `web/src/app/clients/[id]/photos/page.tsx` и `_components/photo-gallery.tsx`: использовать R2 signed URLs | ⏭️ skipped |
| **11.9** | Скрипт миграции | Создать `scripts/migrate-photos.ts` — скачать все фото из Supabase Storage → загрузить в R2, обновить `storage_path` если нужно | ⏭️ skipped |
| **11.10** | Удалить Supabase Storage код | Убрать все обращения к `supabase.storage.from("client-photos")` | ⏭️ skipped |
| **11.11** | Тест загрузки | Проверить загрузку фото через бот и веб | ⏭️ skipped |
| **11.12** | Тест показа | Проверить показ фото в боте, на веб-админке, в клиентском портале | ⏭️ skipped |

### Файлы для изменения

| Файл | Действие |
|------|----------|
| `web/package.json` | Изменение (новые зависимости) |
| `bot/package.json` | Изменение (новые зависимости) |
| `web/src/lib/r2.ts` | Новый |
| `bot/src/lib/r2.ts` | Новый (копия) |
| `web/src/lib/photos.ts` | Изменение (resolvePhotoUrls → R2) |
| `web/src/app/client/[token]/actions.ts` | Изменение (uploadPhoto → R2) |
| `web/src/app/clients/[id]/photos/page.tsx` | Изменение (если нужен прямой доступ к URL) |
| `web/src/app/clients/[id]/photos/_components/photo-gallery.tsx` | Изменение (если нужен прямой доступ к URL) |
| `bot/src/lib/photo-utils.ts` | Изменение (upload + download → R2) |
| `scripts/migrate-photos.ts` | Новый |
| `.env.local` | Изменение (R2 env vars) |
| `.env.example` | Изменение (R2 env vars) |

---

## Фаза 12: Продакшен деплой

### Контекст

Все фазы (1-11) завершены. Бот и веб задеплоены:
- Бот: Node.js/grammY, Dockerfile, работает на **Render** (`tvoi-trener-bot.onrender.com`)
- Веб: Next.js 16, работает на **Vercel** (`opencode-tvoy-trener-bor.vercel.app`)
- Supabase: продакшен проект `jafxybtbbkmwngqhsoaa`, миграции применены
- Осталось: ручные тесты, ротация GitHub PAT, выключение GAS и Cloudflare Worker

### Архитектура (целевая)

```
Telegram → Render (Node.js/grammY) → Supabase DB (PostgreSQL)
                                            ↑
                                     Vercel (Next.js)
```

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **12.1** | Создать Supabase проект | Зарегистрироваться на supabase.com, создать проект, получить URL и service_role key | ✅ |
| **12.2** | Заполнить env vars (бот) | В `bot/.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `COACH_CHAT_ID`, `CLIENT_PORTAL_URL` — реальные значения | ✅ (CLIENT_PORTAL_URL — только локально, см. 12.7) |
| **12.3** | Заполнить env vars (веб) | В `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — реальные значения | ✅ |
| **12.4** | Запустить миграции | Применить все миграции из `supabase/migrations/` (13 файлов) на продакшен через Supabase CLI `db push` | ✅ |
| **12.5** | Исправить middleware | Next.js 16 использует `proxy.ts` (не `middleware.ts`). Файл уже корректный. | ⏭️ not needed |
| **12.6** | Деплой бота | Бот развёрнут на **Render** (не Railway): `tvoi-trener-bot.onrender.com`, `/health` → 200 | ✅ |
| **12.7** | Env vars бота | Переменные из 12.2 заданы на Render (webhook работает, бот жив). `CLIENT_PORTAL_URL` добавлен на Render в рамках 12.19 (вместе с `PAYMENT_BASE_URL`). Верификация 06.08.2026: `/health` → 200, webhook `https://tvoi-trener-bot.onrender.com/webhook` (pending=0), продакшен `client_tokens` генерируются и используются (`last_used_at` 05.08.2026), портал `https://opencode-tvoy-trener-bor.vercel.app` → 200. Для видимости отсутствия env на проде добавлен startup-warning `bot/src/startup-warnings.ts` (+7 тестов, 205/205 unit ✅). | ✅ |
| **12.8** | Проверить деплой бота | `GET /health` → `{"ok":true}`; webhook принимает апдейты (`pending_update_count: 0`) | ✅ |
| **12.9** | Создать Vercel проект | Веб развёрнут: `https://opencode-tvoy-trener-bor.vercel.app` (root directory = `web/`) | ✅ |
| **12.10** | Настроить Vercel env vars | Переменные из 12.3 заданы (страницы рендерятся, база отвечает) | ✅ |
| **12.11** | Проверить деплой веба | `/` → 200, `/login` → 200, `/clients/...` → 307 (редирект на auth), клиентский портал `/client/[token]` → 200 | ✅ |
| **12.12** | Переключить webhook | `setWebhook` = `https://tvoi-trener-bot.onrender.com/webhook`, secret token задан | ✅ |
| **12.19** | Витрина программ + заявки на покупку | Бот: кнопка «📚 Смотреть программы» в `/start`, каталог шаблонов (active=true, client_id IS NULL), кнопка «Купить» → `/buy/{id}?tg={telegramId}`. Веб: публичная страница `/buy/[id]` (формы, валидация, rate-limit 5/мин, dedup 120с), заявка в `bot_logs` (action=`purchase_request`), уведомление коучу в Telegram. Commit `e329e4f`, ревью 9.5/10. Деплой: на Render `CLIENT_PORTAL_URL`+`PAYMENT_BASE_URL`, на Vercel `TELEGRAM_BOT_TOKEN`+`COACH_CHAT_ID` — добавлены, e2e-тест заявки ✅ (логика `b9b19d54…`, уведомление коучу пришло) | ✅ (код) |
| **12.20** | Фиксы после продакшен-теста | Роутинг `message:text` (state-флоу → игнор неизвестных `/команд` → coach → free-text), команда `/settings` → портал, DB-дедупликация заявок через `bot_dedup` (мульти-инстанс, окно 15 мин), мультивыбор тренировочных дней (7 дней, ✅/⚪️, plural ru). Commit `a33a384`, ревью 9.5/10 | ✅ |
| **12.21** | Фокус тренировки + дни клиента + запрос программы | «Фокус» на уровне дня в редакторе программ (показ в `/today` и превью; убран фейковый `Фокус: неделя N` из лейбла недели). Отображение реальных тренировочных дней клиента в `/today`, `/myprogram` и веб-вкладке «Тренировка» (были имена дней из программы). Запрос программы: уведомление коучу с контактом клиента (@username/ссылка), логирование `program_request`/`coach_notification_failed` в `bot_logs`. Commits `7a62e7f`, `23cfb4a`, `2a65ba5`. Ревью 9.0→фиксы lang/таймзоны. Проверено в продакшене ✅ | ✅ |
| **12.13** | Тест бота в продакшене | ✅ Полностью (07.08.2026). Webhook `https://tvoi-trener-bot.onrender.com/webhook` (pending_update_count=0, allowed_updates message+callback_query). Команды проверены end-to-end через прод-вебхук: `/start`, `/menu`, `/myweb`, `/today`, `/mystats`, `/checkin` → HTTP 200; `/myweb` переиспользует существующий `client_tokens` (новых нет); `/checkin` корректно создаёт state `checkin/wellbeing` (тестовый state сразу очищен). Уведомления в проде: утро (08:00 МСК) — `cron:morning_notification` `sent 1 notification(s)` + dedup `morning:*` (07.08), замеры — `cron:measurement_reminder` (06.08) + запись в `measurements` клиентом. Дублей от legacy нет | ✅ |
| **12.14** | Тест веба в продакшене | ✅ Полностью (07.08.2026). `/` `/login` `/dashboard` — 200; защищённые `/dashboard` `/clients` `/programs` → 307 на `/login`. Портал `/client/[token]`, `/history`, `/measurements` → 200, показывают данные из общей базы: «Медленный бег», «Норм», RPE; замеры — комментарий «Готово», вес 85, талия 80, %жира 11. Дублей в `workout_logs`/`measurements` нет. Админ-доступ подтверждён: Auth-аккаунт `admin@tvoitrener.ru` (email подтверждён, вход 30.07.2026), профиль `profiles.role=coach` (допускается наравне с admin) | ✅ |
| **12.15** | Тест end-to-end | ✅ Полностью (07.08.2026). Один источник правды (Supabase): бот (Telegram) → запись тренировки и замеров → видно в `/history` и `/measurements` клиентского портала (SSR) и в админке. Крёстная проверка: по 1 строке в `workout_logs`/`measurements`, дублей нет | ✅ |
| **12.16** | Ротировать GitHub PAT | ✅ Полностью: новый fine-grained PAT создан (Contents: read/write), сохранён в osxkeychain, push работает без PAT в URL; remote без токена (`git remote set-URL`); старый PAT отозван — API даёт 401; новые коммиты пушатся без ввода кредов. (Коммит `c6869a9` — фикс measurement day, 07.08.2026) | ✅ |
| **12.17** | Отключить GAS | ✅ (07.08.2026): триггер `sendDueMessages` удалён в Google Apps Script; Web App развёртывание заархивировано (URL `/exec` неактивен, развёртывание сохранено для отката). Legacy-дублей не было на 06.08–07.08 | ✅ |
| **12.18** | Остановить Worker | ✅ (07.08.2026): Cloudflare Worker деактивирован/маршрут не отвечает (субдомены не резолвятся), Telegram webhook уже напрямую на Render, pending=0 | ✅ |

---

## Фаза 13: Корректный подсчёт тренировок + История как таблица плана

### Контекст

Проблемы:
- Счётчик «выполненных тренировок» нигде не соответствует плану:
  - портал «Текущая неделя» (`page.tsx`) считал **строки** `workout_logs`
    (по одной на упражнение) → «8 тренировок» из 8 упражнений;
  - `adherence.ts` считал уникальные даты с любым логом (частичная и
    пропущенная тренировка засчитывались);
  - бот `/mystats` — день с ≥1 логом ≠ выполненная тренировка, псевдо-строки
    (`[EVENING_*]`) считались реальными.
- «История тренировок» (`client/[token]/history`) — строки = дни, в ячейках
  только вес + подходы×повторы (нет RPE, комментария, даты).

Решение:
- `day_order` в `workout_logs` — точная привязка лога к дню плана
  (пишется ботом при логировании + бэкфилл старых данных).
- Единый алгоритм подсчёта (веб и бот): тренировка выполнена, если в
  запланированную дату залогированы **все** упражнения дня
  (`weekday → training_days → day_order → план`).
- История = таблица как в плане: строки = упражнения, столбцы = все недели,
  в ячейке вес, подходы×повторы, RPE, комментарий, дата; пропуск помечается.

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **13.1** | Миграция: `day_order` | `ALTER TABLE workout_logs ADD COLUMN day_order INTEGER;` — применена к production через Management API | ✅ |
| **13.2** | Бэкфилл `day_order` | `bot/scripts/backfill-workout-day-order.ts`: `isoWeekday(date)` → `training_days` → `day_order`; для `[SKIP]` ещё `week` по дате; idempotent — выполнен (6 обновлено, 2 пропущено) | ✅ |
| **13.3** | Бот: запись `day_order` | `workout-utils.ts` (`TodayWorkout.day_order`, экспорт `getIsoWeekday`/`dayOrderForDate`/`matchDayByOrder`/`isPseudoName`); `wizard.ts` → insert; skip → `week`+`day_order`; evening-poll → `day_order` | ✅ |
| **13.4** | Бот: `/mystats` по плану | `my-stats.ts`: completed = полное покрытие плана, skipped отдельно, псевдо-строки исключены | ✅ |
| **13.5** | Веб: `adherence.ts` | `calculateAdherence(+trainingDays, лог +exercise)`; частичные/пропуски не считаются; fallback по `day_order`; реген `src/types/supabase.ts` (+`day_order`), фикс `ClientWithProgram` под строгий select-парсинг | ✅ |
| **13.6** | Портал: «Текущая неделя» | `client/[token]/page.tsx`: +`exercise` в select, замена inline-счётчика строк на план-подсчёт через `adherence.weeks` | ✅ |
| **13.7** | Дашборд тренера | `clients/[id]/workouts/page.tsx`: +`training_days` у клиента, +`exercise` в select логов | ✅ |
| **13.8** | История: таблица как план | `client/[token]/history/page.tsx` + `history-grid.tsx`: строки = упражнения (секции по дням), столбцы = недели, ячейка = вес/подходы×повторы/RPE/коммент/дата; бейдж «⏭ пропуск» (legacy-скипы: дата → неделя/день); матчинг по `day_order`, иначе по имени | ✅ |
| **13.9** | Тесты бота | vitest: `getIsoWeekday`, `dayOrderForDate`, `matchDayByOrder`, `isPseudoName` (+ существующие) — 154/154 ✅ | ✅ |
| **13.10** | Верификация + gate | bot `tsc` ✅ + vitest (160) ✅; web `tsc` ✅ + vitest (15) ✅ + `next build` ✅; код-ревью 4 раунда (7.6 → 8.7 → 9.3 → **9.5**); TASKS.md; коммит+push (Render/Vercel); бэкфилл после деплоя | ✅ |

### Осознанные решения (задокументировано после ревью)

- **Точный матчинг имён** (I6): тренировка считается выполненной только при
  совпадении ВСЕХ имён плана после `trim().toLowerCase()`. Опечатка клиента
  или «Жим лежа» vs «Жим лёжа» не засчитается — это компромисс в пользу
  строгого учёта; нормализация (схлопывание пробелов, ё→е) — на будущее.
- **Частичная тренировка не отображается в /mystats** (M1): день с частью
  логов не попадает ни в «выполнено», ни в «пропущено». В вебе такой день
  виден как «не выполнено» (снижает %). Третий бакет «частично» — на будущее.
- **Разная семантика путей подсчёта**: date-путь (с `training_days`) требует
  все упражнения на точную плановую дату; order-путь (fallback) допускает
  набор по `day_order` с любой даты недели + подмешивание логов плановой даты.
  Fallback-путь — для legacy-клиентов без `training_days`.
- **Неизвестный `day_name`** (напр. англ. «Monday») не даёт future-фильтр
  в order-пути: день всегда считается наступившим. Программы хранятся
  на русском, поэтому в проде не проявляется.
- **Скип-бейдж в истории**: при двух скипах на один день/неделю побеждает
  первый (по дате), причина последнего отбрасывается.
- **Асимметрия бот/веб при двойном логировании** (P3.4): если тренировка
  залогирована и на плановой дате (legacy, без `day_order`), и повторно с
  `day_order` в другой день, веб засчитает день один раз, а `/mystats`
  может дать два «выполнено» (счёт по датам). Принято, клампинг — на будущее.
- **Дублирование `plannedDateForDay`** (P3.6): приватная копия в
  `web/src/lib/adherence.ts` + экспорт из `bot/src/lib/workout-utils.ts`;
  вынесение в общий пакет отложено, реализации синхронизированы.

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260804000000_add_workout_logs_day_order.sql` | Новый |
| `bot/scripts/backfill-workout-day-order.ts` | Новый |
| `bot/src/lib/workout-utils.ts` | Изменение (day_order, matchDayForDate, isPseudoName) |
| `bot/src/handlers/wizard.ts` | Изменение (WizardData.day_order, insert) |
| `bot/src/handlers/callbacks.ts` | Изменение (skip: week+day_order) |
| `bot/src/handlers/evening-poll.ts` | Изменение (day_order) |
| `bot/src/handlers/my-stats.ts` | Изменение (план-подсчёт) |
| `web/src/lib/adherence.ts` | Изменение (план-подсчёт) |
| `web/src/app/client/[token]/page.tsx` | Изменение (current-week фикс) |
| `web/src/app/clients/[id]/workouts/page.tsx` | Изменение (training_days, exercise) |
| `web/src/app/client/[token]/history/page.tsx` | Изменение (таблица как план) |
| `web/src/app/client/[token]/history/history-grid.tsx` | Изменение (полные данные в ячейках) |

---

## Фаза 14 — Счётчик «Тренировок» в блоке «Статистика» тренера

### Проблема

В `clients/[id]` блок «Статистика» показывал «Тренировок» = сырое количество
строк `workout_logs` (8 упражнений одного дня = «8 тренировок» вместо 2).

### Решение

- Серверный RPC `count_client_workout_days(client_id)` — подсчёт по правилам
  Фазы 13 (полное покрытие упражнений планового дня), а не строк логов.
- `SECURITY INVOKER`, пустой `search_path`, `authenticated`/`service_role`.
- timezone клиента валидируется через `pg_timezone_names` (fallback Moscow);
  JSON-разбор программы защищён от legacy/malformed структур.
- При ошибке RPC UI показывает `—` (не ложный ноль); ошибка логируется.
- `web/src/lib/workout-stats.ts` (`resolveWorkoutCount`) + 3 теста;
  `adherence.ts`: псевдо-упражнения `[...` исключаются и из плана (+ тест).
- Индекс `(client_id, date)`.

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **14.1** | RPC + миграция | `20260804010000_count_client_workout_days.sql` — применена к production через Management API | ✅ |
| **14.2** | Веб-интеграция | `page.tsx` → `rpc`, `resolveWorkoutCount`, `—` при ошибке, тип в `supabase.ts` | ✅ |
| **14.3** | Тесты | `workout-stats.test.ts` (3), `adherence.test.ts` (16: псевдо-упражнение в плане) — 19/19 | ✅ |
| **14.4** | Верификация + gate | web `tsc` ✅ + vitest (19) ✅ + `next build` ✅; ревью 2 раунда (8.7 → 9.3 → **9.8**); production RPC проверен: 8 строк → **2** тренировочных дня | ✅ |
| **14.5** | Деплой | коммит + push (Vercel) | ✅ |

### Файлы

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260804010000_count_client_workout_days.sql` | Новый |
| `web/src/lib/workout-stats.ts` + `.test.ts` | Новые |
| `web/src/app/clients/[id]/page.tsx` | Изменение (RPC вместо count) |
| `web/src/app/clients/[id]/_components/client-profile.tsx` | Изменение (`—` при ошибке) |
| `web/src/types/supabase.ts` | Изменение (тип RPC) |

---

## Фаза 15: Суперсеты, AMRAP/круговые и кардио (бег)

### Контекст

Текущее состояние:
- Одна строка = одно упражнение: `sets/reps/weight/rpe`
- Нет композитных упражнений (суперсеты показываются отдельными карточками в боте)
- Для бега/кардио нет полей пульса и темпа (только вес/RPE)
- `workout_logs`: нет колонок rounds/distance/duration/pace/heart_rate

Цель:
- Суперсеты отображаются в боте как ОДНО упражнение (выполняются подряд)
- AMRAP/круговые: «20 минут, максимум раундов (присед 20×60кг, берпи ×10, бег 500м)»
- Кардио-упражнения: вместо веса/RPE — дистанция/время/темп/пульс

### Архитектурные решения

| Решение | Выбор |
|---------|-------|
| Модель | `ParsedExercise.type`: strength (default) / cardio / superset / circuit |
| Композиты | Родитель `children?: ParsedExercise[]` (вложенные группы, A1/A2) |
| Логирование суперсета | По строке на каждого ребёнка (реальные имена → прошлый раз/история/объём) |
| Логирование круга | Одна строка: `exercise = имя круга`, `rounds`, `duration_sec` |
| Логирование кардио | Одна строка: `distance_km`, `duration_sec`, `pace`, `heart_rate` |
| Units vs leaves | Units — показ/навигация (композит = 1 карточка); Leaves — завершённость/аналитика (`flattenLoggableExercises`) |
| Хранилище метрик | Числовые + темп текстом (для аналитики) |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **15.1** | Типы `ParsedExercise` (web) | `type` + `children` + `duration/rounds/distance/pace/heart_rate` в `web/src/lib/program-utils.ts`, рекурсивная валидация, `flattenLoggableExercises`, `isComposite` | ✅ |
| **15.2** | Типы `ParsedExercise` (bot) | Зеркальные изменения в `bot/src/lib/program-utils.ts` | ✅ |
| **15.3** | Тесты валидации (web) | vitest: суперсет/круг/кардио valid + invalid + flatten | ✅ |
| **15.4** | Миграция `workout_logs` | `rounds INTEGER`, `distance_km NUMERIC(6,2)`, `duration_sec INTEGER`, `heart_rate NUMERIC(3,1)`, `pace TEXT` | ✅ |
| **15.5** | Обновить типы Supabase | `web/src/types/supabase.ts`: новые колонки в `workout_logs.Row` | ✅ |
| **15.6** | RPC `count_client_workout_days` | Раскрывать `children` суперсетов в плановых упражнениях | ✅ |
| **15.7** | Редактор: тип строки | Дропдаун «Тип» (Сила/Кардио/Суперсет/Круг) в `program-editor.tsx` | ✅ |
| **15.8** | Редактор: дети | `ADD_CHILD/UPDATE_CHILD/DELETE_CHILD` в reducer, вложенные строки A1/A2 | ✅ |
| **15.9** | Редактор: кардио-колонки | Дистанция/Время/Темп/Пульс вместо Подходы/Вес/RPE | ✅ |
| **15.10** | Редактор: валидация | Композит ≥2 детей, все с именами | ✅ |
| **15.11** | Бот: рендер композитов | Суперсет/круг/кардио в `workout-utils.ts`, навигация по units, «прошлый раз» по leaves | ✅ |
| **15.12** | Бот: завершённость | `isTodayWorkoutCompleted` по leaves | ✅ |
| **15.13** | Бот: wizard по типу | Кардио/суперсет/круг шаги в `wizard.ts`, вставка новых полей | ✅ |
| **15.14** | Бот: валидаторы | `parseRounds`, `parseDurationSec`, `parseDistanceKm`, `parsePace`, `parseHeartRate` | ✅ |
| **15.15** | Бот: i18n | ru/en ключи для кардио/суперсета/круга | ✅ |
| **15.16** | Бот: `/mystats` | Плановые имена через leaves | ✅ |
| **15.17** | Портал: форма тренировки | `workout-form.tsx` по типу, `actions.ts` (logWorkoutFromWeb) новые поля | ✅ |
| **15.18** | Портал: завершённость | `workout/page.tsx` через `flattenLoggableExercises` | ✅ |
| **15.19** | История | `history/page.tsx` + `history-grid.tsx`: раунды/темп/пульс, матчинг детей суперсета | ✅ |
| **15.20** | Превью программы | `program-week-preview.tsx`: вложенные дети + кардио-колонки | ✅ |
| **15.21** | Верификация + gate | bot tsc + vitest; web tsc + vitest + next build; ревью ≥9.5; обновить TASKS.md | ✅ (фиксы по ревью 8.2→9.5: precision heart_rate + follow-up миграция, N+1 batch previous logs, cardio-дети в визарде, web-валидация, i18n метрик) |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260805000000_add_workout_logs_metrics.sql` | Новый |
| `supabase/migrations/20260804010000_count_client_workout_days.sql` | Изменение (flatten детей) |
| `web/src/lib/program-utils.ts` | Изменение (типы, валидация, flatten, getCellValue) |
| `bot/src/lib/program-utils.ts` | Изменение (зеркально) |
| `web/src/types/supabase.ts` | Изменение (колонки workout_logs) |
| `web/src/app/programs/[id]/edit/_components/program-editor.tsx` | Изменение |
| `web/src/app/programs/[id]/_components/program-week-preview.tsx` | Изменение |
| `bot/src/lib/workout-utils.ts` | Изменение |
| `bot/src/lib/wizard-validators.ts` | Изменение |
| `bot/src/handlers/wizard.ts` | Изменение |
| `bot/src/handlers/my-stats.ts` | Изменение |
| `bot/src/i18n/index.ts` | Изменение |
| `web/src/app/client/[token]/workout/workout-form.tsx` | Изменение |
| `web/src/app/client/[token]/workout/page.tsx` | Изменение |
| `web/src/app/client/[token]/actions.ts` | Изменение |
| `web/src/app/client/[token]/history/page.tsx` | Изменение |
| `web/src/app/client/[token]/history/history-grid.tsx` | Изменение |
| `web/src/lib/adherence.ts` + `.test.ts` | Изменение (псевдо-упражнения в плане) |

---

## Фаза 16: Месячные замеры + еженедельный чек-ин

### Контекст

Сейчас напоминание замеров привязано к дню недели (`measurement_day`, ISO 1-7)
и уходит **каждую неделю**. Чек-ин — только ручной (`/checkin`), авто-напоминаний
и настроек чек-ина у клиента нет.

Цель:
- Замеры — **раз в месяц**: напоминание в выбранное **число месяца** (1-31)
  в заданное время.
- После напоминания клиент может **перенести замеры на другой день**
  (дефер по конкретному числу), и клиент сам меняет день/время в настройках.
- Чек-ин — **еженедельно** по конфигурируемым `checkin_day`/`checkin_time`, флоу
  стартует сразу (без кнопки «Начать»).

### Осознанные решения

| Решение | Выбор |
|---------|-------|
| Семантика `measurement_day` | меняется: ISO-день недели (1-7) → **число месяца** (1-31) |
| Дефолты миграции | `measurement_day=1`, `measurement_time='08:00'` — всем клиентам с заданным днём; **новым** клиентам так же по умолчанию |
| Проверка месяца | Напоминание не уходит, если `measurements` уже есть за **текущий месяц** клиента |
| Defer | Кнопка «⏭ Перенести на другой день» → выбор **числа** (1-31) → `measurement_defer_date` = ближайшее наступление числа (если день прошёл в этому месяце → следующий месяц); после отправки перенесённого напоминания крон чистит поле |
| Dedup | Месячный: `measurement:{clientId}:YYYY-MM` (TTL ~45 дней) |
| Чек-ин дефолт | `checkin_day=7` (Вс), `checkin_time='10:00'` всем активным; клиент меняет в настройках |
| Анти-дубль чек-ина | Пропуск, если чек-ин уже есть за последние 7 дней; dedup `checkin:{clientId}:{неделя}` |
| Автостарт чек-ина | Крон шлёт первый вопрос и `setState(checkin/wellbeing)` сразу (общий хелпер с `/checkin`) |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **16.1** | Миграция БД | `20260807000000_add_checkin_and_measurement_defer.sql`: `checkin_day INTEGER`, `checkin_time TIME`, `measurement_defer_date DATE`; обновить дефолты существующих (`measurement_day=1`, `measurement_time='08:00'`; активные `checkin_day=7`, `checkin_time='10:00'`) | ✅ |
| **16.2** | Типы бота | `bot/src/lib/types.ts`: новые колонки в `clients.Row/Insert/Update` | ✅ |
| **16.3** | Типы веба | `web/src/types/supabase.ts`: новые колонки в `clients` | ✅ |
| **16.4** | Константы веба | `web/src/lib/clients.ts`: `MEASUREMENT_DAY_OPTIONS` → 1-31 («1-е»…«31-е»), `CHECKIN_DAY_OPTIONS` (дни недели) | ✅ |
| **16.5** | Хелпер числа месяца | `bot/src/lib/workout-utils.ts`: `getTodayDayOfMonth(tz)` (i18n-формат day) + unit-тест `workout-utils.test.ts` | ✅ |
| **16.6** | Бот: месячное напоминание | `cron/measurement-reminder.ts`: срабатывание по числу месяца (или `measurement_defer_date=сегодня`), автоskip при замерах за месяц, daily dedup, tz-aware | ✅ |
| **16.7** | Бот: кнопка переноса | `cron/measurement-reminder.ts` + `handlers/callbacks.ts`: кнопка «Перенести на другой день», эдитор выбора числа (1-31), колбэки `measurements_defer`/`measurements_defer_set:{n}`, запись `measurement_defer_date`, подтверждение, крон очищает поле после отправки | ✅ |
| **16.8** | Бот: крон чек-ина | Новый `cron/checkin-reminder.ts` (+ регистр в `scheduler.ts`, guard `*/15 * * * *`): день+время, пропуск при чек-ине за 7 дней, лог `cron:checkin_reminder` | ✅ |
| **16.9** | Бот: общий старт чек-ина | `handlers/checkin.ts`: вынести хелпер старта (первый вопрос + setState) для `/checkin` и крона | ✅ |
| **16.10** | Бот: настройки | `handlers/settings.ts`: панель «День замера» (число месяца), «Время замера», «Чек-ин — день», «Чек-ин — время»; эдиторы и `settings_measure_day` (1-31), `settings_checkin_day` (Пн-Вс), `settings_checkin_time`; валидация | ✅ |
| **16.11** | Бот: i18n | `i18n/index.ts` ru/en: `measure.reminder.monthly`, `measure.defer_button`, `measure.defer_choose`, `measure.deferred`, `settings.checkin_*`, переформулировка `settings.measure_day` | ✅ |
| **16.12** | Веб-портал | `client/[token]/settings/*` + `actions.ts`: `measurement_day` 1-31, поля `checkin_day`/`checkin_time`, валидация, типы | ✅ |
| **16.13** | Админка | `clients/[id]/_components/client-actions.tsx` + `actions.ts` + `page.tsx` + `client-profile.tsx`: день замеров 1-31, поля чек-ина в edit-форме и профиле | ✅ |
| **16.14** | Верификация + gate | bot tsc + vitest (223/223); web tsc + vitest (34/34) + next build; ревью `@code-reviewer` 9.9 ≥9.5; TASKS.md; коммит+push | ✅ |
| **16.15** | E2E прод | Миграция применена (колонки+дефолты ✅). Бэкфилл: единственный активный клиент получил `checkin_day=7/10:00`, `measurement_day=1` ✅. Vercel: новый код развёрнут (поля чек-ина в HTML портала ✅). GitHub-статус: Railway-failure pre-existing (бот жив на Render, `/health` 200). Естес. срабатывание кронов заблокировано guards (check-in 06.08 в 7-дн окне → авто-чек-ин ~13.08; замеры 04–06.08 → след. 01.09). E2E-тест юзером: временно удалены данные клиента, крон `cron:measurement_reminder`/`cron:checkin_reminder` отправили напоминания ✅, defer-флоу в Telegram (перенос на 09.08) подтверждён в БД `measurement_defer_date=2026-08-09` ✅ | ✅ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260807000000_add_checkin_and_measurement_defer.sql` | Новый |
| `bot/src/lib/types.ts` | Изменение (clients + checkin/day/time, defer_date) |
| `bot/src/lib/workout-utils.ts` + `.test.ts` | Изменение (+ `getTodayDayOfMonth`) |
| `bot/src/cron/measurement-reminder.ts` | Изменение (месяц + defer) |
| `bot/src/cron/checkin-reminder.ts` | Новый |
| `bot/src/cron/scheduler.ts` | Изменение (регистрация checkin_reminder) |
| `bot/src/handlers/checkin.ts` | Изменение (общий хелпер старта) |
| `bot/src/handlers/settings.ts` | Изменение (сетки/валидации, чек-ин) |
| `bot/src/handlers/callbacks.ts` | Изменение (defer-колбэки) |
| `bot/src/i18n/index.ts` | Изменение (ru/en) |
| `web/src/types/supabase.ts` | Изменение (clients) |
| `web/src/lib/clients.ts` | Изменение (day-опции) |
| `web/src/app/client/[token]/settings/settings-form.tsx` | Изменение |
| `web/src/app/client/[token]/settings/page.tsx` | Изменение (select колонок) |
| `web/src/app/client/[token]/actions.ts` | Изменение (updateClientSettings) |
| `web/src/app/clients/[id]/_components/client-actions.tsx` | Изменение |
| `web/src/app/clients/[id]/_components/client-profile.tsx` | Изменение (MEASUREMENT_DAY_LABELS 1-31, чек-ин) |
| `web/src/app/clients/[id]/actions.ts` | Изменение (валидация 1-31 + чек-ин) |
| `web/src/app/clients/[id]/page.tsx` | Изменение (select checkin_*) |

## Фаза 17: Перенос тренировки на другой день недели

### Контекст

Кнопка «Перенести» в вечернем опросе («Тренировка сегодня была?») сейчас только
пишет маркер `[EVENING_POSTPONE]` в `workout_logs` и отвечает «перенесём на
следующий день» — **тренировка никуда не переносится**, следующий день по
расписанию остаётся без изменений, пропущенная тренировка просто теряется.

Цель — реальный перенос в пределах **текущей недели**:
- Клиент жмёт «Перенести» → видит дни недели (вт–вс до конца недели),
  занятые дни помечены, перенос возможен только на свободный день.
- Отдельная опция «Изменить всё расписание недели» — перевыбор всех
  тренировочных дней недели заново (мультивыбор пн–вс).
- В день, с которого тренировка перенесена, тренировка не показывается
  (и вечерний опрос не приходит).
- Перенос на следующую неделю не имеет смысла (там уже другой микроцикл).

### Осознанные решения

| Решение | Выбор |
|---------|-------|
| Хранение | Колонка `program_schedule.training_days INTEGER[] NULL` — оверрайд списка дней **только для недели**; `NULL` = глобальные `clients.training_days` |
| Перенос пн→вт | Изменение списка недели `[1,3,5] → [2,3,5]`; `day_order` дня плана определяется позицией в эффективном списке (`matchDayForToday` уже так работает) |
| Занятость дней | Обычные `training_days` недели + дни, куда уже сделаны переносы (в списке недели) |
| Ограничение | Только дни **после сегодня и до `end_date`** текущей недели |
| Опция «Изменить расписание недели» | Перевыбор всех дней заново (тоглы пн–вс, кол-во = число тренировок недели); переиспользуем редактор из `training-days.ts`, но пишем в `program_schedule.training_days` |
| Вечерний опрос в перенесённый день | Не отправляется автоматически: `getTodayWorkout` по новой маске не найдёт тренировку в этот день |
| Авто-показ в новом дне | Утреннее напоминание/`/today`/`/my-program` подхватывают перенесённую тренировку автоматически через `getTodayWorkout` |
| Веб-портал | `web/src/app/client/[token]/workout/page.tsx` и `client/[token]/page.tsx` (adherence) получают недельный оверрайд, чтобы показывать ту же картину |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **17.1** | Миграция БД | `supabase/migrations/20260809..._add_program_schedule_training_days.sql`: `ALTER TABLE program_schedule ADD COLUMN IF NOT EXISTS training_days INTEGER[] NULL` | ✅ |
| **17.2** | Типы бота | `bot/src/lib/types.ts`: `training_days` в `ProgramScheduleRow/Insert/Update` (клиенты, схема program_schedule) | ✅ |
| **17.3** | Типы веба | `web/src/types/supabase.ts`: `training_days` в `program_schedule.Row/Insert/Update` | ✅ |
| **17.4** | Бот: эффективная маска недели | `bot/src/lib/postpone-utils.ts`: `getEffectiveTrainingDays(client, weekRow)` → `weekRow.training_days ?? client.training_days`; общий `getCurrentWeekRow` в `workout-utils.ts` + использование в `getTodayWorkout` | ✅ |
| **17.5** | Бот: флоу переноса | `evening-poll.ts` + `callbacks.ts`: «Перенести» → свободные дни недели (✅/⛔, `postpone_taken` alert) → перенос через `replaceTrainingDay` (позиционный) + `[EVENING_POSTPONE]` лог; race-guard (свежий ре-фетч + «сегодня ещё занят» + дата цели > сегодня, `weekdayDateInWeek`) | ✅ |
| **17.6** | Бот: перевыбор недели | «📅 Изменить все дни недели» → готовый редактор `startTrainingDaysSetup(weekOverride)`; сохранение в неделю БЕЗ сортировки (`finalizeSchedule`, позиционная семантика) | ✅ |
| **17.7** | Бот: i18n | `i18n/index.ts` ru/en: все `postpone_*` ключи; `postpone_editor_open`; мёртвый `response_postpone` удалён | ✅ |
| **17.8** | Веб-портал | `client/[token]/workout/page.tsx` (weekTrainingDays), `page.tsx` (селект `training_days`), `adherence.ts` (оверрайд недели); общий `web/src/lib/week-days.ts` (anchor-aware датирование) + history page | ✅ |
| **17.9** | Тесты | Бот 276: `postpone-utils` (21), `finalizeSchedule`, mid-week `weekdayDateInWeek`+`plannedDateForDay`, adherence оверрайд; Web 58: `week-days`, adherence mid-week window | ✅ |
| **17.10** | Верификация + gate | bot/web tsc + vitest + next build; ревью `@code-reviewer` 9.6/10 (4 раунда: 8.8 → 8.6 → 8.4 → 9.0 → 9.4 → 9.6); коммиты 606a66b…f00fdfb, все запушены | ✅ |
| **17.11** | E2E прод | Миграция применена через Management API (direct DB недоступен) ✅; перенос в Telegram на проде подтверждён: `program_schedule` неделя 2 `training_days=[3]` (после теста снято) ✅; вечерний опрос в старый день не приходит (день убран из effective days → `getTodayWorkout` null, код-проверено); найден и исправлен баг: веб игнорировал недельный оверрайд (select без `training_days` в `/clients/[id]/workouts` + history) ✅ | ✅ |
| **17.12** | Фича: перенос из утреннего уведомления + ревью-цикл | `morning.ts` — кнопка «🔁 Перенести» (`morning_postpone`); общий пикер `openPostponePicker(source)` для morning/evening, source в callback_data (`postpone_move:{iso}:{source}`), фолбэк legacy `""` → evening; маркеры `[MORNING_POSTPONE]`/`[EVENING_POSTPONE]`; `hasCompletion` исключает `[MORNING_*]`. Ревью `@code-reviewer` 4 раунда (8.0 → 8.5 → 9.3 → 9.6): M1-фолбэк занятых дней из `day_name` для клиентов без `training_days` (`getOccupiedDaysForWeek`, lenient `weekdayIsoFromName`, сорт по day_order); константы маркеров в `log-markers.ts`; `hasCompletionLogs/hasSkipLog` вынесены; web lenient-матчинг в `day-names.ts` (+ `plannedDateForDay` фикс в my-stats); тесты: бот 298 (16 новых flow), web 61 (3 day-names); коммиты 0d7063f, 58c081b — запушены | ✅ |
| **17.13** | Веб тренера: «Следующая тренировка» | `/clients/[id]` — `InfoRow` в секции «Доступ и программа» после «Статус программы»: «Сегодня»/«Завтра»/«Чт, 13.08» + условная подсветка. Данные: добавить `training_days` в селект клиента и расписания (page.tsx), запрос логов текущей недели | ✅ |
| **17.14** | Главная клиента: «Следующая тренировка» | `/client/[token]` — кликабельная `Card` между приветствием и «Текущая неделя», ссылка на `/program`: «Следующая тренировка: Четверг, 13 августа», при совпадении с сегодня — «Сегодня» + подсветка | ✅ |
| **17.15** | Утилита next-workout + тесты | `web/src/lib/next-workout.ts`: `getNextWorkoutDay({ schedule, clientTrainingDays, parsed, workoutLogs, today })` → `{ date, iso, weekNumber, isToday } | null`; эффективные дни `week.training_days ?? client.training_days`, позиционный fallback по `day_name`/`day_order`; «сегодня» = тренировочный день без завершённых реальных логов; переход через границу недели. Тест `next-workout.test.ts` (сегодня, завершён сегодня, оверрайд, fallback, граница недели, пустой schedule); vitest + tsc в `web/`. Ревью 8.5 → 9.0: общие хелперы `collectDayOrderLogs`/`isDayCompletedByOrder` в adherence.ts, TZ-безопасный «Завтра», полный fetch логов | ✅ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/…_add_week_training_days.sql` | Новый |
| `bot/src/lib/types.ts` | Изменение (program_schedule.training_days) |
| `bot/src/lib/workout-utils.ts` + `.test.ts` | Изменение (getEffectiveTrainingDays, use in getTodayWorkout) |
| `bot/src/handlers/evening-poll.ts` | Изменение (флоу переноса вместо ответа-заглушки) |
| `bot/src/handlers/callbacks.ts` | Изменение (колбэки переноса + перевыбора) |
| `bot/src/handlers/training-days.ts` | Изменение (переиспользование редактора для недели) |
| `bot/src/i18n/index.ts` | Изменение (ru/en) |
| `bot/src/state/machine.ts` | Изменение (при необходимости новые шаги флоу) |
| `web/src/types/supabase.ts` | Изменение (program_schedule) |
| `web/src/app/client/[token]/workout/page.tsx` | Изменение (недельная маска) |
| `web/src/app/client/[token]/page.tsx` | Изменение (adherence с недельной маской) |
| `web/src/lib/adherence.ts` (при необходимости) | Изменение (недельный оверрайд) |

---

## Фаза 18: Отображение круговой — состав упражнений, время убрано

### Контекст

Круговая тренировка логируется как одна строка `exercise = имя круга` + `rounds` + `duration_sec`.
При отображении показывается только «Круговая» + сколько раундов + сколько минут — **без состава**,
хотя в программе у круговой есть `children` (упражнения, которые тренер указал при создании).

Цель:
- В боте (план дня и карточка упражнения) и в истории тренировок показывать **состав круговой**:
  названия упражнений с количеством повторов/подходов и весом снаряда, если указаны в программе.
- Время выполнения круговой **убрать полностью**: не спрашивать у клиента и не сохранять
  (бот-визард и веб-форма), не показывать в отображении, истории и предпросмотре программы
  (включая старые записи с `duration_sec`).

### Осознанные решения

| Решение | Выбор |
|---------|-------|
| Отображение состава | Дети круговой (`children`) показываются как в суперсетах: «A1. Берпи — 3×15 · 20 кг» |
| Логирование | Останется одна строка на круг (`rounds` + комментарий); дети логируются вместе с кругом |
| Время круговой | `duration_sec` больше не спрашивается и не пишется для `type=circuit`; для старых записей время скрывается везде, где `rounds != null` |
| История | Состав круговой — под названием круга в левой колонке таблицы (повторы/подходы и вес из плана) |
| Предпросмотр программы | Для круговой в метриках остаётся только «Раунды», «Время» убирается (кардио не трогаем) |

### Известные ограничения

- Круг с кардио-детьми: в боте такой ребёнок рендерится с кардио-деталями, в веб-истории — голым именем (рендер детей в истории учитывает только sets/reps/weight). Редкий кейс, принят осознанно.
- Состав круга в истории берётся из плана первой встреченной недели (дедуп строк по имени); при смене состава круга между неделями в истории может остаться состав первой недели. Для снятия ограничения стоит хранить состав круга в самой записи лога (JSON-колонка).

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **18.1** | Бот: рендер круговой с детьми | `bot/src/lib/workout-utils.ts` — ветка `circuit` в `formatExercise()` и `formatSingleExercise()` (заголовок `circuit_label`, дети список «A1. Название — 3×15 · 20 кг», цель «Цель: N раунд(а/ов)», отдых/заметки) | ✅ |
| **18.2** | Бот: планируемые детали | `formatPlannedDetail()` — для круговой только раунды; `formatPreviousLog()` — при `rounds != null` время не показывать (старые записи тоже) | ✅ |
| **18.3** | Бот: wizard без времени | `bot/src/handlers/wizard.ts` — `CIRCUIT_STEPS = ["rounds", "comment"]`, сводка без «Время», вставка `duration_sec: null` | ✅ |
| **18.4** | Бот: i18n | `bot/src/i18n/index.ts` — удалить неиспользуемые `planned_duration_prefix`, `planned_rounds`, `exercise_weight`, `exercise_rpe` (ru/en) | ✅ |
| **18.5** | Бот: тесты | `bot/src/lib/__tests__/workout-utils.test.ts` — тест круговой: дети с деталями, нет «за 20 мин»; кейс `formatSingleExercise` для круга; скрытие времени у старых circuit-логов, сохранение у cardio; «Прошлый раз» родителя круга; плюрализация цели | ✅ |
| **18.6** | История: состав круговой | `web/src/app/client/[token]/history/page.tsx` — `HistoryRow.children` из `ex.children` + буквы композита; `history-grid.tsx` — вывод «A1. Берпи — 3×15 · 20 кг» под названием круга | ✅ |
| **18.7** | История: без времени | `history-format.ts` — `formatMetrics()`: при `rounds != null` время не показывается (включая старые записи) | ✅ |
| **18.8** | Веб-форма: без времени | `web/src/app/client/[token]/workout/workout-form.tsx` — убрать поле «Время» и валидацию для круговой; `actions.ts` — серверная проверка: `duration_sec !== null` для `circuit` отклоняется | ✅ |
| **18.9** | Превью программы | `web/src/app/programs/[id]/_components/program-week-preview.tsx` — для круговой метрика «Время» убрана, остаётся «Раунды»; колонка «Время» для круга рендерит «—»; `program-editor.tsx` — у круга нет поля «Время», автоимя без duration | ✅ |
| **18.10** | Верификация + gate | bot `npm run test:unit` (304 ✓) + `npm run build` ✓; web tsc ✓ + vitest (84 ✓) + next build ✓; ревью `@code-reviewer` 9.6/10 (гейт ≥9.5 пройден) | ✅ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `bot/src/lib/workout-utils.ts` | Изменение (circuit-ветка, formatPlannedDetail с separator, formatPlannedWeight, pluralizeRounds, collectLoggableNames, formatPreviousLog скрытие времени) |
| `bot/src/lib/__tests__/workout-utils.test.ts` | Изменение (тесты круговой) |
| `bot/src/handlers/wizard.ts` | Изменение (CIRCUIT_STEPS без duration) |
| `bot/src/handlers/callbacks.ts` | Изменение (collectLoggableNames для прошлых логов детей круга) |
| `bot/src/i18n/index.ts` | Изменение (удаление мёртвых ключей, circuit_goal без вшитых единиц) |
| `web/src/app/client/[token]/history/page.tsx` | Изменение (HistoryRow.children + compositeLetter) |
| `web/src/app/client/[token]/history/history-grid.tsx` | Изменение (рендер детей с буквами) |
| `web/src/lib/history-format.ts` | Новый (форматтеры истории, вынесены из grid) |
| `web/src/lib/history-format.test.ts` | Новый (тесты formatMetrics/formatPlannedChild) |
| `web/src/app/client/[token]/workout/workout-form.tsx` | Изменение (без поля «Время» для круга) |
| `web/src/app/client/[token]/actions.ts` | Изменение (валидация: rounds обязателен, duration_sec отклоняется) |
| `web/src/app/programs/[id]/_components/program-week-preview.tsx` | Изменение (без «Время» для круга) |
| `web/src/app/programs/[id]/edit/_components/program-editor.tsx` | Изменение (без поля «Время» и без duration в автоимени круга) |

## Фаза 19: Счётчик тренировок = дни реальных тренировок + индикатор «Выполнена сегодня»

### Контекст

Счётчики «выполненных тренировок» (главная клиента, «Дисциплина», статистика тренера, профиль
клиента у тренера) считали день выполненным только если **все** плановые упражнения залогированы
именно в плановую дату. Тренировка «не по плану» (в другой день недели) не засчитывалась вообще,
что расходилось с реальной картиной.

Цель:
- «Выполнено» = число дней, когда клиент реально тренировался: в логе есть хотя бы одно реальное
  упражнение (любая дата, включая дни не по плану). Псевдо-записи (`[SKIP]`, `[EVENING_*]`) не считаются.
- На главной клиента в окошке «Следующая тренировка» — индикатор «✅ Выполнена сегодня», если
  сегодня есть реальные записи.

### Осознанные решения

| Решение | Выбор |
|---------|-------|
| Семантика «Выполнено» | День засчитывается, если есть ≥1 реальная запись (частичная тренировка и офф-план день тоже). «Ожидалось» = плановые тренировочные дни недели |
| Индикатор «Выполнена сегодня» | Любые реальные записи сегодня; если сегодня есть плановая тренировка, но она не завершена — показывается подсказка «Завершите сегодняшнюю тренировку» |
| Формулировки | «X тренировок (плановых: Y)» — чтобы счётчик не выглядел багом, когда выполнено больше плана (офф-план дни) |
| RPC | Единая логика: `count_client_workout_days` считает DISTINCT дни с реальными записями до `today` по timezone клиента |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **19.1** | Веб: `adherence.ts` | `completed` в `countWeekByDates`/`countWeekByDayOrder` = `countTrainedDays` (дни недели до today с ≥1 реальным упражнением); экспорт `isRealExercise` | ✅ |
| **19.2** | Веб: `next-workout.ts` | Новый хелпер `hasTrainedOnDate(workoutLogs, date)` — есть ли реальные записи за дату | ✅ |
| **19.3** | Портал: индикатор «Выполнена сегодня» | `client/[token]/page.tsx`: `trainedToday`, рендер ✅ + «Следующая: …» / «Завершите сегодняшнюю тренировку»; формулировки счётчиков «X (плановых: Y)» | ✅ |
| **19.4** | Миграция RPC | `20260813000000_count_trained_workout_days.sql`: `count_client_workout_days` = DISTINCT даты реальных записей ≤ today (timezone клиента), псевдо-записи исключены | ✅ |
| **19.5** | Тесты | `adherence.test.ts` (офф-план день, псевдо-только дни, частичная тренировка, дни после today, distinct-дни); `next-workout.test.ts` (`hasTrainedOnDate`) | ✅ |
| **19.6** | Верификация + gate | web tsc ✓ + vitest (99 ✓); bot vitest (329 ✓); ревью `@code-reviewer` 8.5 → 9.0 → **9.5/10** (гейт ≥9.5 пройден) | ✅ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `web/src/lib/adherence.ts` | Изменение (countTrainedDays, экспорт isRealExercise) |
| `web/src/lib/next-workout.ts` | Изменение (hasTrainedOnDate) |
| `web/src/app/client/[token]/page.tsx` | Изменение (trainedToday, формулировки) |
| `web/src/lib/adherence.test.ts` | Изменение (тесты под новую семантику) |
| `web/src/lib/__tests__/next-workout.test.ts` | Изменение (тесты hasTrainedOnDate) |
| `supabase/migrations/20260813000000_count_trained_workout_days.sql` | Новый (заменяет логику RPC из 20260804010000) |

## Фаза 20: Библиотека упражнений (описание, техника, особенности, видео)

### Контекст

Таблица `exercises` существует, но пуста и используется только как автокомплит в редакторе программ.
Программы хранят упражнения как свободное имя (`ParsedExercise.name`), логи пишут имя текстом — связи с
`exercises.id` нет. Клиенту нужна библиотека: описание, техника выполнения, особенности, видео-инструкция —
доступная в боте во время тренировки и на клиентском портале.

Цель:
- Расширить `exercises` контентом (ru/en): описание, техника, особенности (буллеты), YouTube-видео, алиасы.
- Связывание с программами — по нормализованному имени + алиасам (без правки контента программ и логов).
- Бот `/today`: под карточкой упражнения компактная кнопка «Техника и видео» → отдельное сообщение
  (техника + особенности + ссылка). Команда `/exercise <название>` — поиск по имени/алиасам.
- Клиентский портал: под упражнением раскрывающаяся карточка: техника + особенности + встроенный YouTube-плеер.
- Веб-панель: CRUD-страница `/exercises` + подсказка в редакторе программ при совпадении с библиотекой.

### Осознанные решения

| Решение | Выбор |
|---------|-------|
| Хостинг видео | Только YouTube-ссылки (`video_url`); на портале — iframe, в боте — ссылка |
| Связывание | `name_key` (нормализация: lowercase, без пунктуации/пробелов) + `aliases TEXT[]`; матч в рантайме (JS-мап), без SQL-функций |
| Поверхности | Бот (/today-кнопка, /exercise) + веб (CRUD, подсказка в редакторе) + портал (карточки) |
| Бот: формат | Компактная кнопка → отдельное сообщение (не раздувать карточку /today); у суперсетов — кнопка на суперсет целиком |
| Портал: формат | Раскрывающаяся карточка: текст техники + буллеты особенностей + YouTube iframe |
| Языки | RU + EN (description_ru/en, technique_ru/en, features_ru/en) |
| Резолвер | Дубликат `exercise-library.ts` в `web/src/lib/` и `bot/src/lib/` (keep-in-sync, как program-utils) |
| Наполнение | Сид: топ-15 движений текущих программ с реальными публичными ссылками (Buff Dudes / Фитнес Преп) + полный ru/en текст (AI-черновик, тренер правит в CRUD); остальные — текст + плейсхолдер video_url |
| Существующие поля | `muscle_group, equipment, difficulty, contraindications` сохраняются без изменений |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **20.1** | Миграция БД + типы | `20260815000000_exercise_library.sql`: ALTER `exercises` — `name_key TEXT UNIQUE NOT NULL`, `aliases TEXT[] DEFAULT '{}'`, `description_ru TEXT`, `description_en TEXT`, `technique_ru TEXT`, `technique_en TEXT`, `features_ru TEXT[]`, `features_en TEXT[]`, `video_url TEXT`; бэкап `name_key` из существующих `name` при миграции. Обновить `web/src/types/supabase.ts`, `bot/src/lib/types.ts` | ✅ |
| **20.2** | Резолвер библиотеки | `web/src/lib/exercise-library.ts` + `bot/src/lib/exercise-library.ts` (синк-комментарий): `normalizeExerciseName`, `buildExerciseLibraryMap(rows)`, `findLibraryEntry(map, programName)`, `formatExerciseInfo(ex, lang) → { text, videoUrl }` (техника буллетами + особенности + ссылка), `collectLibraryKeys(exercises)` | ✅ |
| **20.3** | Сид библиотеки | `bot/scripts/seed-exercise-library.ts` — идемпотентный upsert по `name_key`: топ-15 движений программ (Гипертрофия FB, домашняя, HYROX) с реальными ссылками + ~35 с плейсхолдером; ru/en текст, алиасы (варианты/дети суперсетов) | ✅ |
| **20.4** | Бот: кнопка в /today | `workout-utils.ts`: `formatWorkoutMessage` грузит карту библиотеки (1 запрос), передаёт в `formatExercise` (опц. параметр, дефолт без данных); строка кнопки + колбэк `exercise_info:<key>` | ✅ |
| **20.5** | Бот: callback и сообщение | `callbacks.ts`: обработчик `exercise_info` — отдельное сообщение (техника + особенности + 📺 ссылка); суперсет/циркут — техника детей внутри | ✅ |
| **20.6** | Бот: команда /exercise | Новый обработчик (поиск по имени/алиасам, `exercise_lib` не найдено → подсказка), регистрация команды в `bot.ts` и меню | ✅ |
| **20.7** | Бот i18n | `bot/src/i18n/index.ts` ru/en: `workout.exercise_info_button`, секция `exercise_lib.*` (заголовки техники/особенностей/видео, not_found) | ✅ |
| **20.8** | Веб: CRUD-страница | `web/src/app/exercises/page.tsx` (список + карточка) + `_components/exercise-form.tsx` (имя, алиасы, описание/техника/особенности ru/en, оборудование, сложность, группа мышц, contraindications, video_url) | ✅ |
| **20.9** | Веб: server actions | `web/src/app/exercises/actions.ts`: валидация, вычисление `name_key`, guard admin/coach, revalidate | ✅ |
| **20.10** | Веб: подсказка в редакторе | `program-editor.tsx` (рядом с autocomplete): при матче с библиотекой — коллапс «В библиотеке: ⇢ техника · 📺 видео» | ✅ |
| **20.11** | Портал: карточки | `client/[token]/workout/page.tsx` (server: карта библиотеки) + `workout-form.tsx`: раскрывающаяся карточка под упражнением — техника + особенности + YouTube iframe (хелпер извлечения video ID из ссылки) | ✅ |
| **20.12** | Тесты | Резолвер: `normalizeExerciseName` (регистр/пунктуация), матч по алиасам/детям суперсетов, `formatExerciseInfo` ru/en; бот: кнопка при матче, callback шлёт сообщение, карточка без данных не ломается, `/exercise` найден/не найден; веб: CRUD-валидация, guard, рендер карточки портала | ✅ |
| **20.13** | Верификация + gate | tsc ✓, vitest web ✓, vitest bot ✓, eslint ✓; ревью `@code-reviewer` — гейт ≥9.5; отметка фазы в TASKS.md | ✅ |
| **20.14** | Покрытие программ | Сид расширен 51 → 84 записи: все имена упражнений H/T/X покрыты (name/алиасы); заглушки «Бег», «Жим гантелей стоя», «Казак-приседания», «Тяга горилла», «Молотки» и др.; `check-exercise-coverage.ts` (collection child/ex/machine/inline); миграция применена к проду (`supabase db push`), сид в прод (84 записи), чистка «переехавших» алиасов; name_key заморожен при updateExercise (CRUD-переименование не ломает матчинг программ); ревью 9.5/10 | ✅ |
| **20.15** | Фикс 500 на /exercises | Next.js 16 запрещает передавать функции через server→client границу: баг-фикс — `onDone` в `exercise-form.tsx` стал опциональным (`onDone?: () => void`), из `page.tsx:100` убран (`revalidatePath` в actions уже обновляет страницу). Коммит `e3b02b7`, продиагностировано curl-сессией (500 на проде), проверено: tsc ✓, vitest 169/169 ✓, HTTP 200 на проде; ревью `@code-reviewer` 9.5/10 | ✅ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260815000000_exercise_library.sql` | Новый (ALTER exercises) |
| `web/src/types/supabase.ts` | Изменение (типы exercises) |
| `bot/src/lib/types.ts` | Изменение (типы exercises) |
| `web/src/lib/exercise-library.ts` | Новый (резолвер) |
| `bot/src/lib/exercise-library.ts` | Новый (резолвер, keep-in-sync) |
| `bot/scripts/seed-exercise-library.ts` | Новый (сид) |
| `bot/src/lib/workout-utils.ts` | Изменение (карта библиотеки, кнопка в карточке) |
| `bot/src/handlers/callbacks.ts` | Изменение (exercise_info callback) |
| `bot/src/handlers/exercise.ts` | Новый (команда /exercise) |
| `bot/src/bot.ts` | Изменение (регистрация /exercise) |
| `bot/src/handlers/menu.ts` | Изменение (строка меню /exercise) |
| `bot/src/i18n/index.ts` | Изменение (exercise_lib ru/en, кнопка) |
| `web/src/app/exercises/page.tsx` | Новый (CRUD-список) |
| `web/src/app/exercises/_components/exercise-form.tsx` | Новый (карточка/форма) |
| `web/src/app/exercises/actions.ts` | Новый (server actions) |
| `web/src/app/programs/[id]/edit/_components/program-editor.tsx` | Изменение (подсказка библиотеки) |
| `web/src/app/client/[token]/workout/page.tsx` | Изменение (карта библиотеки server-side) |
| `web/src/app/client/[token]/workout/workout-form.tsx` | Изменение (карточки с техникой + видео) |
| `web/src/lib/__tests__/exercise-library.test.ts` | Новый (тесты резолвера) |
| `bot/src/lib/__tests__/exercise-library.test.ts` | Новый (тесты резолвера) |
| `bot/src/handlers/__tests__/exercise.test.ts` | Новый (тесты /exercise) |
| `bot/src/handlers/__tests__/workout-info-button.test.ts` | Новый (кнопка + callback) |
| `web/src/app/exercises/__tests__/actions.test.ts` | Новый (тесты CRUD) |

---

## Фаза 21: Продамус — онлайн-оплата программ (разовая, доступ на срок программы)

> **Флоу:** `/programs` → «Купить» у программы (цена обязательна) → согласие на обработку данных **до оплаты** (кнопка `consent_purchase:<request_id>`) → ссылка на payform (`do=pay&products[0][name]=<программа>&products[0][price]=<цена>&products[0][quantity]=1&order_id=<UUID заявки>`) → webhook (`Sign` = HMAC-SHA256) → создание/переактивация профиля + назначение выбранной программы на `duration_weeks` (напр. 10 нед.) + инструкции. Тренер получает «Заявка на покупку» и «Оплата подтверждена» (имя/фамилия из Telegram, @ник, TG ID, программа, цена).
>
> **Автоистечение:** доступ автоматически прекращается по `access_end_date` (бот + портал), за 5 дней — напоминание клиенту. Повторная покупка той же программы — новая заявка/оплата → новое окно доступа.
>
> **«Связаться с тренером»:** заявка на индивидуальное ведение/кураторство (sub_type='individ') из бота и со страниц каталога — уведомление тренеру со всеми данными клиента.

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **21.1** | Миграция БД + типы | `20260816000000_prodamus_payments.sql`: таблица `purchase_requests` (id UUID PK, program_id UUID FK NULL, client_id UUID FK NULL, name TEXT, contact TEXT, telegram_id BIGINT NULL, first_name TEXT NULL, last_name TEXT NULL, status TEXT NOT NULL DEFAULT 'pending' (pending/paid/cancelled), order_id TEXT UNIQUE NULL, amount NUMERIC NULL, sub_type TEXT NOT NULL ('program'/'individ'), consent_given BOOL NOT NULL DEFAULT false, consent_at TIMESTAMPTZ, consent_version TEXT, created_at, updated_at) + индексы по status, telegram_id, order_id. Обновить `web/src/types/supabase.ts` + `bot/src/lib/types.ts` | ✅ (миграция +12 колонок: `amount NUMERIC(10,2)` + `CHECK (amount IS NULL OR amount > 0)`, `paid_at TIMESTAMPTZ`; FKs `ON DELETE SET NULL`; RLS: чтение только `profiles.role IN ('admin','coach')`, `REVOKE ALL FROM anon`, `REVOKE DML FROM authenticated`, GRANT SELECT authenticated + ALL service_role; типы web (Insert: name/contact/sub_type обязательны, status/consent_given опциональны) + bot (dedicated Insert по паттерну exercises); tsc web+bot ✓, vitest web 169 ✓, bot 367 ✓; ревью 2 раунда 8.5 → fix'ы (anon REVOKE, staff-политика, paid_at, bot Insert) → **10/10**) |
| **21.2** | lib/prodamus.ts | `buildPaymentUrl({ payformUrl, orderId, amount, productName, customerPhone, urlSuccess, urlReturn })` — `do=pay&products[0][name]=...&products[0][price]=...&products[0][quantity]=1&order_id=...&customer_phone=...&urlSuccess=...` (развёрнутая ссылка, SYS-код не нужен); `verifyProdamusSignature(rawBody, signHeader, secretKey)` — значения к строкам, рекурсивная сортировка ключей, экранирование `/`, SHA-256, `crypto.timingSafeEqual`; `parseProdamusOrder` (order_id, sum, payment_status, products). Тесты на официальный пример payload докахов Продамуса | ✅ (HMAC-SHA256 по офиц. алгоритму docs.prodamus.ru; golden-фикстура докахов `ec3d935e…` совпадает байт-в-байт; поддержка multipart/form-data (FormData) + urlencoded; хардненинг pre-auth парсера по ревью: prototype pollution закрыта (BLOCKED_HEADS + Object.hasOwn), OOM-кап индексов ≤1000, глубина ≤32, last-wins для конфликтующих ключей, verify никогда не бросает; 27/27 тестов, tsc+eslint ✓; ревью 2 раунда 6.5 → fix'ы → **9.5/10**) |
| **21.3** | Бот: покупка программы | `bot/src/handlers/purchase.ts`: в `/programs` кнопка «Купить» (только у программ с `price > 0`) → INSERT `purchase_requests` (sub_type='program', status pending, данные из `ctx.from.first_name/last_name/username/id`) → текст политики + кнопка `consent_purchase:<request_id>` **до оплаты**; у клиентов с `client_consent_given` шаг согласия пропускается → после приёма: consent в заявке + `buildPaymentUrl` + кнопка «Оплатить» (url); уведомление тренеру «Заявка на покупку» (имя + фамилия, @ник, TG ID, программа, цена); i18n ru/en, регистрация в `bot.ts` и меню | ✅ (3 коммита: `830c0bb` feat-флоу, `22b8647` хардненинг раунда 1 (статус-гварды, order_id=id, amount-снапшот, уникальный pending-индекс `20260817000000`, антиспам 3, PRODAMUS_PAYFORM_BASE_URL, buildBuyUrl удалён), `51fcd14`+`0c7b6d7` раунды 2-3 (ссылка строго из снапшота amount, финальная ре-верификация consent, assertNoPriorPayment fail-closed на всех 3 путях выдачи ссылки (owned/paid/error), retry при cancelled-winner, consent-текст цитирует снапшот); бот 408/17 ✓ tsc ✓; ревью 4 раунда 7.5+8.0 → 9.0+9.0 → 9.0+9.2 → **9.5/10 + 9.6/10** ✅) |
| **21.4** | Бот: кнопка «Связаться с тренером» | `purchase.ts` + меню (новые и активные клиенты): callback `coach_request` → согласие (если нет, `consent_purchase`-механика) → INSERT `purchase_requests` (sub_type='individ', данные из Telegram) → тренеру «Хочу индивидуальное ведение/кураторство» (имя, фамилия, @ник, TG ID, ссылка t.me) → клиенту «Тренер скоро свяжется с вами»; i18n ru/en | ✅ (2 коммита: `5e77ed9` feat (согласие ДО вставки: кнопка = согласие, согласие записывается атомарно при INSERT; дедуп пре-чтение + 23505 с единичным retry; частичный unique-индекс `20260818000000_purchase_unique_pending_individ`; кнопки в /programs (вкл. пустой каталог), меню активного клиента, /start для новых; pre-guard в bot.ts; бот 427/19) + `0d4ba76`+`3fe82a8` хардненинг (try/catch-контейнер submitIndividRequest, fail-closed dedup, ClientLookupResult-union, версия политики: standing-consent только при совпадении PRIVACY_POLICY_VERSION, иначе свежий шаг; bot_logs не бросает); бот 433/19 ✓ tsc ✓; ревью 2 раунда 9.4 → **9.6/10 + 9.6/10** ✅) |
| **21.5** | Веб: заявка на страницах каталога | На `/buy/[id]` блок «Хотите индивидуальное ведение?» (текст + кнопка заявки): server action `createCoachRequest` в `web/src/app/buy/[id]/actions.ts` — реюз валидации, rate-limit и дедупликации `createPurchaseRequest` (имя, контакт, обязательный чекбокс согласия с /privacy из `lib/consent.ts`) → INSERT sub_type='individ' → уведомление тренеру | ⬜ |
| **21.6** | Автоактивация | `web/src/lib/activate-purchase.ts`: вынос логики `markPurchased` (actions.ts) без проверки сессии — найти клиента по telegram_id, иначе создать (name из first_name+last_name, consent переносится в `client_consent_given/at/version`); если статус `access_expired`/`inactive` → переактивация (status active, заново `program_id`, `access_start_date=now`, `access_end_date=now+duration_weeks`); назначение через существующие `resetPlanAssignments` + `generateSchedule` + `deliverProgramInstructions`; клиенту «оплачено + инструкции», тренеру «Оплата подтверждена» (все данные клиента + программа + сумма). `markPurchased` и webhook вызывают её | ⬜ |
| **21.7** | Вебхук | `web/src/app/api/webhooks/prodamus/route.ts` (runtime nodejs): POST, проверка `Sign` + секретный ключ → иначе 400; `payment_status=success` → активация по order_id (21.6), идемпотентность (заявка уже paid → 200); `order_canceled`/`order_denied` → status cancelled + уведомление тренеру | ⬜ |
| **21.8** | Блок «Оплаты» в панели | `client-profile.tsx`: список `purchase_requests` клиента (тип — программа/индивидуальное, программа, сумма, статус, дата) | ⬜ |
| **21.9** | Кнопка тренера | `client-actions.tsx`: «Ссылка на оплату» — выбор программы → `buildPaymentUrl` (с `customer_phone` клиента, если есть) → копирование и/или отправка клиенту в Telegram (кнопка «Оплатить программу») | ⬜ |
| **21.10** | Автоистечение доступа | Бот: в `baseGuard` (guards.ts) у активных клиентов проверка `access_end_date < now` → сообщение `access_expired` (i18n есть) + ленивое проставление `status='access_expired'`; портал: серверный guard по `access_end_date` в `client/[token]/layout.tsx` → страница `/client/expired` (существует); панель: фильтр «Доступ истёк» уже работает | ⬜ |
| **21.11** | Напоминание за 5 дней | `bot/src/cron/access-expiry.ts` (по образцу `measurement-reminder.ts`): ежедневный cron — активные клиенты с `access_end_date` в диапазоне [now+5д, now+5д+24ч], без записи в `notification_log` (type='access_expiring') → «Доступ заканчивается {дата}. Продлите программу в боте» + запись в `notification_log` (дедупликация — 1 раз); регистрация в `cron/scheduler.ts`; i18n ru/en | ⬜ |
| **21.12** | Env + README | `web/env.example`: `PRODAMUS_PAYFORM_BASE_URL`, `PRODAMUS_SECRET_KEY`; инструкция настройки кабинета Продамуса (платёжная страница, urlNotification → `/api/webhooks/prodamus`, секретный ключ страницы, тестовая оплата тестовой картой) | ⬜ |
| **21.13** | Тесты | prodamus.test.ts (подпись по офиц. payload, buildPaymentUrl, parse); webhook: валидная/битая подпись → 400, не POST, дубликат (идемпотентность), success, canceled; activate-purchase: клиент найден/создан, access_expired → переактивация, consent перенесён, без tg_id → connect_code; бот: покупка (согласие → ссылка), coach_request, автоблок по дате, i18n ru/en; cron: 5-дневное уведомление шлётся 1 раз (дедуп); веб: createCoachRequest (валидация, consent обязателен, дедупликация) | ⬜ |
| **21.14** | Верификация + gate | tsc web+bot ✓, vitest web ✓, vitest bot ✓, eslint ✓; ревью `@code-reviewer` — гейт ≥9.5; отметка задач в этом файле | ⬜ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260816000000_prodamus_payments.sql` | Новый (purchase_requests) |
| `web/src/types/supabase.ts` | Изменение (purchase_requests) |
| `bot/src/lib/types.ts` | Изменение (purchase_requests) |
| `web/src/lib/prodamus.ts` | Новый (URL, подпись, парсер) |
| `web/src/lib/__tests__/prodamus.test.ts` | Новый (тесты) |
| `web/src/lib/activate-purchase.ts` | Новый (автоактивация) |
| `web/src/lib/__tests__/activate-purchase.test.ts` | Новый (тесты) |
| `web/src/app/api/webhooks/prodamus/route.ts` | Новый (вебхук) |
| `web/src/app/api/webhooks/prodamus/__tests__/route.test.ts` | Новый (тесты) |
| `bot/src/handlers/purchase.ts` | Новый (покупка + coach_request) |
| `bot/src/handlers/menu.ts` | Изменение (кнопки покупки и тренера) |
| `bot/src/handlers/programs.ts` | Изменение (кнопка «Купить» с ценой) |
| `bot/src/bot.ts` | Изменение (регистрация callback'ов) |
| `bot/src/i18n/index.ts` | Изменение (purchase.*, coach_request.* ru/en) |
| `bot/src/handlers/__tests__/purchase.test.ts` | Новый (тесты) |
| `bot/src/handlers/guards.ts` | Изменение (автоистечение) |
| `bot/src/cron/access-expiry.ts` | Новый (напоминание за 5 дней) |
| `bot/src/cron/scheduler.ts` | Изменение (регистрация cron) |
| `bot/src/cron/__tests__/access-expiry.test.ts` | Новый (тесты) |
| `web/src/app/buy/[id]/page.tsx` | Изменение (блок индивидуального ведения) |
| `web/src/app/buy/[id]/buy-form.tsx` | Изменение (блок + чекбокс согласия) |
| `web/src/app/buy/[id]/actions.ts` | Изменение (createCoachRequest) |
| `web/src/app/(coach)/clients/[id]/_components/client-profile.tsx` | Изменение (блок «Оплаты») |
| `web/src/app/(coach)/clients/[id]/_components/client-actions.tsx` | Изменение (кнопка ссылки на оплату) |
| `web/src/app/(coach)/clients/[id]/actions.ts` | Изменение (markPurchased → activate-purchase) |
| `web/src/app/client/[token]/layout.tsx` | Изменение (guard по дате) |
| `web/env.example` | Изменение (PRODAMUS_*) |
